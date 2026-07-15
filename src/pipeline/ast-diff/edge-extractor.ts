import fs from 'node:fs';
import path from 'node:path';
import type Parser from 'web-tree-sitter';
import type { ParsedSource } from './parser.js';
import type { CodeUnitCandidate } from './unit-extractor.js';

export type EdgeType = 'imports' | 'calls' | 'renders';

export interface EdgeCandidate {
  fromUnitName: string;
  toFilePath: string;
  toUnitName: string;
  edgeType: EdgeType;
}

interface ImportedName {
  localName: string;
  resolvedFilePath: string;
}

const RESOLVE_CANDIDATE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  `${path.sep}index.ts`,
  `${path.sep}index.tsx`,
  `${path.sep}index.js`,
  `${path.sep}index.jsx`,
];

const JS_LIKE_SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

/** 상대경로 import만 워크스페이스 파일로 해석한다 (MVP — 외부 패키지/tsconfig paths는 스킵). */
function resolveImportPath(fromFilePath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const basePath = path.resolve(path.dirname(fromFilePath), specifier);

  // TS NodeNext/ESM 스타일은 relative import에 .js를 쓰지만 실제 소스는 .ts인 경우가 흔하다
  // (예: `from './foo.js'`인데 실제 파일은 foo.ts — 이 저장소 자체가 이 스타일을 쓴다).
  // 확장자를 뗀 버전도 후보에 추가하지 않으면 그런 import는 전부 미해석으로 스킵돼버린다.
  const candidateBases = [basePath];
  const jsLikeExt = JS_LIKE_SOURCE_EXTENSIONS.find((ext) => basePath.endsWith(ext));
  if (jsLikeExt) candidateBases.push(basePath.slice(0, -jsLikeExt.length));

  for (const base of candidateBases) {
    for (const suffix of RESOLVE_CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // 다음 후보 시도
      }
    }
  }
  return null;
}

function stripQuotes(text: string): string {
  return text.slice(1, -1);
}

function collectImportedNames(root: Parser.SyntaxNode, filePath: string): ImportedName[] {
  const names: ImportedName[] = [];

  for (const stmt of root.namedChildren) {
    if (!stmt || stmt.type !== 'import_statement') continue;

    const sourceNode = stmt.childForFieldName('source');
    if (!sourceNode) continue;
    const resolved = resolveImportPath(filePath, stripQuotes(sourceNode.text));
    if (!resolved) continue; // 외부 패키지/미해석 — MVP에서 스킵 (SPEC 4.2)

    const clause = stmt.namedChildren.find((c) => c?.type === 'import_clause');
    if (!clause) continue;

    for (const child of clause.namedChildren) {
      if (!child) continue;
      if (child.type === 'identifier') {
        names.push({ localName: child.text, resolvedFilePath: resolved });
      } else if (child.type === 'namespace_import') {
        const id = child.namedChildren.find((c) => c?.type === 'identifier');
        if (id) names.push({ localName: id.text, resolvedFilePath: resolved });
      } else if (child.type === 'named_imports') {
        for (const spec of child.namedChildren) {
          if (!spec || spec.type !== 'import_specifier') continue;
          const alias = spec.childForFieldName('alias');
          const name = spec.childForFieldName('name');
          const localName = (alias ?? name)?.text;
          if (localName) names.push({ localName, resolvedFilePath: resolved });
        }
      }
    }
  }

  return names;
}

function walk(node: Parser.SyntaxNode, visit: (node: Parser.SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walk(child, visit);
  }
}

function collectCalleeNames(unitNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  walk(unitNode, (node) => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn && fn.type === 'identifier') names.add(fn.text);
    }
  });
  return names;
}

function collectJsxTagNames(unitNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  walk(unitNode, (node) => {
    if (node.type === 'jsx_opening_element' || node.type === 'jsx_self_closing_element') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && nameNode.type === 'identifier') names.add(nameNode.text);
    }
  });
  return names;
}

function collectAllIdentifierNames(unitNode: Parser.SyntaxNode): Set<string> {
  const names = new Set<string>();
  walk(unitNode, (node) => {
    if (node.type === 'identifier') names.add(node.text);
  });
  return names;
}

/**
 * 파일의 "현재 상태"(after) 기준으로 imports/calls/renders 후보를 추출한다 (SPEC 4.2).
 * - 같은 파일 내 유닛 간 호출/렌더도 포함(파일 경계 없이 이름으로 해석).
 * - import는 상대경로만 워크스페이스 파일로 해석, 외부 패키지는 스킵.
 * - 이름 기반 매칭이라 스코프/섀도잉은 구분하지 못함(알려진 한계, MVP).
 * - `obj.method()`처럼 멤버 표현식으로 부르는 호출은 대상을 특정할 수 없어 스킵.
 */
function extractJsFamilyEdges(parsed: ParsedSource, filePath: string, units: CodeUnitCandidate[]): EdgeCandidate[] {
  const importedNames = collectImportedNames(parsed.tree.rootNode, filePath);
  const sameFileUnitNames = new Set(units.map((u) => u.unitName));
  const edges: EdgeCandidate[] = [];

  for (const unit of units) {
    const calleeNames = collectCalleeNames(unit.node);
    const jsxNames = collectJsxTagNames(unit.node);
    const allNames = collectAllIdentifierNames(unit.node);

    for (const name of allNames) {
      if (name === unit.unitName) continue; // 재귀 호출은 그래프 노이즈라 제외

      let toFilePath: string | null = null;
      if (sameFileUnitNames.has(name)) {
        toFilePath = filePath;
      } else {
        const imported = importedNames.find((i) => i.localName === name);
        if (imported) toFilePath = imported.resolvedFilePath;
      }
      if (!toFilePath) continue; // 미해석 — 스킵

      const edgeType: EdgeType = jsxNames.has(name) ? 'renders' : calleeNames.has(name) ? 'calls' : 'imports';
      edges.push({ fromUnitName: unit.unitName, toFilePath, toUnitName: name, edgeType });
    }
  }

  return edges;
}

// ── Python ──────────────────────────────────────────────────────────────
// ctags 경로와 달리 진짜 AST가 있으므로 (1) 별칭/와일드카드 임포트, (2) 같은 파일 내
// 함수·메서드 호출, (3) `import calculator; calculator.add()`처럼 모듈 전체를 임포트해
// 속성으로 호출하는 패턴까지 해석할 수 있다 — ctags-extractor.ts는 정의 태깅만 하고
// 참조/호출 해석 기능이 없어서 이 세 가지가 전부 불가능했다.

function findModuleFile(candidateBase: string, ext: string): string | null {
  for (const candidate of [`${candidateBase}${ext}`, path.join(candidateBase, `__init__${ext}`)]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 다음 후보
    }
  }
  return null;
}

/** dotted 경로(`pkg.util` 또는 `calculator`)를 같은 디렉토리 → 워크스페이스 루트 순으로 찾는다. */
function resolveDottedPath(fromFilePath: string, workspaceRoot: string, dottedSegments: string[]): string | null {
  const ext = path.extname(fromFilePath);
  const candidateBases = [
    path.join(path.dirname(fromFilePath), ...dottedSegments),
    path.join(workspaceRoot, ...dottedSegments),
  ];
  for (const base of candidateBases) {
    const found = findModuleFile(base, ext);
    if (found) return found;
  }
  return null;
}

interface PythonImports {
  /** `import x`, `import x as y`, `from . import y` — 이름이 모듈 자체를 가리킴(속성 호출 대상). */
  modules: Map<string, string>;
  /** `from x import y`, `from x import y as z` — 이름이 심볼(함수/클래스) 자체를 가리킴. */
  symbols: Map<string, { resolvedFilePath: string; symbolName: string }>;
}

function collectPythonImports(root: Parser.SyntaxNode, filePath: string, workspaceRoot: string): PythonImports {
  const modules = new Map<string, string>();
  const symbols = new Map<string, { resolvedFilePath: string; symbolName: string }>();

  for (const stmt of root.namedChildren) {
    if (!stmt) continue;

    if (stmt.type === 'import_statement') {
      for (const nameNode of stmt.childrenForFieldName('name')) {
        if (nameNode.type === 'dotted_name') {
          const segments = nameNode.text.split('.');
          const resolved = resolveDottedPath(filePath, workspaceRoot, segments);
          if (resolved) modules.set(segments[0], resolved); // `import a.b.c` → 바인딩되는 이름은 `a`
        } else if (nameNode.type === 'aliased_import') {
          const original = nameNode.childForFieldName('name');
          const alias = nameNode.childForFieldName('alias');
          if (!original || !alias) continue;
          const resolved = resolveDottedPath(filePath, workspaceRoot, original.text.split('.'));
          if (resolved) modules.set(alias.text, resolved);
        }
      }
      continue;
    }

    if (stmt.type !== 'import_from_statement') continue;
    const moduleNameNode = stmt.childForFieldName('module_name');
    if (!moduleNameNode) continue;

    // module_name이 relative_import면 점(.) 개수만큼 디렉토리를 거슬러 올라간 뒤, 남은
    // dotted_name(있으면)을 그 기준으로 붙인다. 남은 게 없으면(`from . import x`) x 자체가
    // 그 디렉토리의 서브모듈이라는 뜻이라 아래에서 이름마다 따로 해석한다.
    let resolvedModuleDir: string | null = null; // `from . import x`용: x를 찾을 디렉토리
    let resolvedModuleFile: string | null = null; // `from .mod import x`용: x가 속한 파일

    if (moduleNameNode.type === 'relative_import') {
      const prefix = moduleNameNode.namedChildren.find((c) => c?.type === 'import_prefix');
      const dotted = moduleNameNode.namedChildren.find((c) => c?.type === 'dotted_name');
      const level = prefix?.text.length ?? 1;
      let baseDir = path.dirname(filePath);
      for (let i = 1; i < level; i++) baseDir = path.dirname(baseDir);

      if (dotted) {
        resolvedModuleFile = findModuleFile(path.join(baseDir, ...dotted.text.split('.')), path.extname(filePath));
      } else {
        resolvedModuleDir = baseDir;
      }
    } else if (moduleNameNode.type === 'dotted_name') {
      resolvedModuleFile = resolveDottedPath(filePath, workspaceRoot, moduleNameNode.text.split('.'));
    }

    const wildcard = stmt.namedChildren.some((c) => c?.type === 'wildcard_import');
    if (wildcard) continue; // `from x import *` — 심볼 이름을 알 수 없어 미해석(알려진 한계)

    for (const nameNode of stmt.childrenForFieldName('name')) {
      let localName: string;
      let originalName: string;
      if (nameNode.type === 'aliased_import') {
        const original = nameNode.childForFieldName('name');
        const alias = nameNode.childForFieldName('alias');
        if (!original || !alias) continue;
        originalName = original.text;
        localName = alias.text;
      } else {
        originalName = nameNode.text;
        localName = originalName;
      }

      if (resolvedModuleFile) {
        symbols.set(localName, { resolvedFilePath: resolvedModuleFile, symbolName: originalName });
      } else if (resolvedModuleDir) {
        // `from . import helpers` — helpers는 심볼이 아니라 서브모듈(파일) 자체를 가리킨다.
        const ext = path.extname(filePath);
        const resolved = findModuleFile(path.join(resolvedModuleDir, originalName), ext);
        if (resolved) modules.set(localName, resolved);
      }
    }
  }

  return { modules, symbols };
}

interface AttributeCall {
  object: string;
  attribute: string;
}

function collectPythonCalls(unitNode: Parser.SyntaxNode): { directCallNames: Set<string>; attributeCalls: AttributeCall[] } {
  const directCallNames = new Set<string>();
  const attributeCalls: AttributeCall[] = [];
  walk(unitNode, (node) => {
    if (node.type !== 'call') return;
    const fn = node.childForFieldName('function');
    if (!fn) return;
    if (fn.type === 'identifier') {
      directCallNames.add(fn.text);
    } else if (fn.type === 'attribute') {
      const object = fn.childForFieldName('object');
      const attribute = fn.childForFieldName('attribute');
      if (object?.type === 'identifier' && attribute) {
        attributeCalls.push({ object: object.text, attribute: attribute.text });
      }
    }
  });
  return { directCallNames, attributeCalls };
}

/**
 * Python은 진짜 AST가 있어 ctags 경로보다 훨씬 정확한 엣지를 뽑을 수 있다:
 * - import: 상대/절대/별칭(as) 전부 해석 (와일드카드만 알려진 한계로 스킵).
 * - calls: 같은 파일 내 호출, 임포트한 심볼 직접 호출, `모듈.함수()` 형태의 모듈 속성 호출,
 *   `self.method()`로 부르는 같은 클래스 메서드 호출까지 포함.
 */
function extractPythonEdges(
  parsed: ParsedSource,
  filePath: string,
  units: CodeUnitCandidate[],
  workspaceRoot: string
): EdgeCandidate[] {
  const { modules, symbols } = collectPythonImports(parsed.tree.rootNode, filePath, workspaceRoot);
  const sameFileUnitNames = new Set(units.map((u) => u.unitName));
  const edges: EdgeCandidate[] = [];

  for (const unit of units) {
    const bareUnitName = unit.unitName.includes('.') ? unit.unitName.split('.').slice(1).join('.') : unit.unitName;
    const enclosingClassName = unit.unitName.includes('.') ? unit.unitName.split('.')[0] : null;
    const { directCallNames, attributeCalls } = collectPythonCalls(unit.node);
    const allNames = collectAllIdentifierNames(unit.node);

    for (const name of allNames) {
      if (name === bareUnitName) continue; // 재귀 호출은 그래프 노이즈라 제외

      let toFilePath: string | null = null;
      let toUnitName: string | null = null;
      if (sameFileUnitNames.has(name)) {
        toFilePath = filePath;
        toUnitName = name;
      } else {
        const symbol = symbols.get(name);
        if (symbol) {
          toFilePath = symbol.resolvedFilePath;
          toUnitName = symbol.symbolName;
        }
      }
      if (!toFilePath || !toUnitName) continue; // 미해석 — 스킵

      const edgeType: EdgeType = directCallNames.has(name) ? 'calls' : 'imports';
      edges.push({ fromUnitName: unit.unitName, toFilePath, toUnitName, edgeType });
    }

    for (const { object, attribute } of attributeCalls) {
      if (object === 'self' || object === 'cls') {
        // 같은 클래스의 다른 메서드를 self.method()/cls.method()로 부르는 경우.
        if (!enclosingClassName) continue;
        const target = `${enclosingClassName}.${attribute}`;
        if (target === unit.unitName) continue; // 자기 자신 재귀 호출은 제외
        if (sameFileUnitNames.has(target)) {
          edges.push({ fromUnitName: unit.unitName, toFilePath: filePath, toUnitName: target, edgeType: 'calls' });
        }
        continue;
      }
      const moduleFilePath = modules.get(object);
      if (moduleFilePath) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: moduleFilePath, toUnitName: attribute, edgeType: 'calls' });
      }
    }
  }

  return edges;
}

// ── Go ──────────────────────────────────────────────────────────────────
// Go 패키지는 파일이 아니라 디렉토리 단위다 — import 경로 하나가 "파일 하나"로 안 떨어지고
// 그 디렉토리 안 여러 .go 파일 중 하나로 떨어진다. 어느 파일인지는 tree-sitter로 후보
// 파일을 전부 다시 파싱하는 대신 가벼운 텍스트 스캔(최상위 `func Name(` 존재 여부)으로
// 근사한다 — ctags가 원래 하던 수준의 근사치지만 이 두 곳(패키지 셀렉터 호출, 같은 패키지
// 내 다른 파일의 미한정 호출) 모두에 재사용된다.
function findTopLevelFuncFile(dir: string, symbolName: string, excludeFile?: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const pattern = new RegExp(`^func\\s+${symbolName}\\s*\\(`, 'm');
  for (const entry of entries) {
    if (!entry.endsWith('.go')) continue;
    const candidate = path.join(dir, entry);
    if (candidate === excludeFile) continue;
    let content: string;
    try {
      content = fs.readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
    if (pattern.test(content)) return candidate;
  }
  return null;
}

function findGoModule(workspaceRoot: string): string | null {
  try {
    const content = fs.readFileSync(path.join(workspaceRoot, 'go.mod'), 'utf8');
    return content.match(/^module\s+(\S+)/m)?.[1] ?? null;
  } catch {
    return null; // go.mod가 없으면(혹은 모듈명을 못 찾으면) 내부 임포트를 전혀 못 푼다
  }
}

function collectImportSpecs(importDecl: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const specs: Parser.SyntaxNode[] = [];
  for (const child of importDecl.namedChildren) {
    if (!child) continue;
    if (child.type === 'import_spec') specs.push(child);
    else if (child.type === 'import_spec_list') {
      for (const inner of child.namedChildren) {
        if (inner?.type === 'import_spec') specs.push(inner);
      }
    }
  }
  return specs;
}

/** localName → 그 패키지가 사는 디렉토리(파일 하나가 아니다 — 위 설명 참조). */
function collectGoImports(root: Parser.SyntaxNode, workspaceRoot: string): Map<string, string> {
  const packages = new Map<string, string>();
  const moduleName = findGoModule(workspaceRoot);
  if (!moduleName) return packages;

  for (const stmt of root.namedChildren) {
    if (!stmt || stmt.type !== 'import_declaration') continue;

    for (const spec of collectImportSpecs(stmt)) {
      const pathNode = spec.childForFieldName('path');
      if (!pathNode) continue;
      const importPath = stripQuotes(pathNode.text);

      let localName: string;
      const nameNode = spec.childForFieldName('name');
      if (nameNode) {
        if (nameNode.type === 'blank_identifier') continue; // `_ "pkg"` — 부작용 전용, 참조 불가
        localName = nameNode.text;
      } else {
        const segments = importPath.split('/');
        localName = segments[segments.length - 1]; // 관례상 마지막 세그먼트(실제 package 선언과 다를 수 있음 — 알려진 한계)
      }

      if (importPath !== moduleName && !importPath.startsWith(`${moduleName}/`)) continue; // 외부/표준 라이브러리 — 스킵
      const relSubpath = importPath === moduleName ? '' : importPath.slice(moduleName.length + 1);
      packages.set(localName, relSubpath ? path.join(workspaceRoot, relSubpath) : workspaceRoot);
    }
  }

  return packages;
}

interface GoSelectorCall {
  object: string;
  attribute: string;
}

function collectGoCalls(unitNode: Parser.SyntaxNode): { directCallNames: Set<string>; selectorCalls: GoSelectorCall[] } {
  const directCallNames = new Set<string>();
  const selectorCalls: GoSelectorCall[] = [];
  walk(unitNode, (node) => {
    if (node.type !== 'call_expression') return;
    const fn = node.childForFieldName('function');
    if (!fn) return;
    if (fn.type === 'identifier') {
      directCallNames.add(fn.text);
    } else if (fn.type === 'selector_expression') {
      const operand = fn.childForFieldName('operand');
      const field = fn.childForFieldName('field');
      if (operand?.type === 'identifier' && field) {
        selectorCalls.push({ object: operand.text, attribute: field.text });
      }
    }
  });
  return { directCallNames, selectorCalls };
}

// 메서드 유닛(unitName이 "Type.Method")의 리시버 변수 이름(예: `func (c *Calculator) Add(...)`의
// `c`)을 알아야 `c.LogAndAdd()`같은 같은 구조체 메서드 호출을 판별할 수 있다 — Go는 리시버
// 이름을 자유롭게 짓기 때문에(Python의 고정된 `self`와 다름) 유닛마다 다시 읽어야 한다.
function getGoReceiverVarName(unitNode: Parser.SyntaxNode): string | null {
  const receiver = unitNode.childForFieldName('receiver');
  const paramDecl = receiver?.namedChildren[0];
  return paramDecl?.childForFieldName('name')?.text ?? null;
}

/**
 * Go는 진짜 AST가 있어 ctags 경로(노드만, 엣지 없음)보다 나은 calls 엣지를 뽑을 수 있다:
 * - 같은 파일 내 직접 호출.
 * - 리시버 변수로 부르는 같은 구조체의 다른 메서드 호출(`c.LogAndAdd()`).
 * - 임포트한 패키지의 셀렉터 호출(`pkg.Func()`) — go.mod의 module 선언으로 임포트 경로를
 *   워크스페이스 디렉토리에 매칭.
 * - 같은 패키지의 다른 파일에서 한정자 없이 부르는 흔한 관용구(`OtherFunc()`)까지 텍스트
 *   스캔으로 근사 해석. import 엣지는 없음(Go는 셀렉터 호출 전부가 사실상 "패키지 전체
 *   임포트" 형태라 calls 하나로 수렴 — 범위를 넓히지 않음, 아래 handoff 문서 참조).
 */
function extractGoEdges(
  parsed: ParsedSource,
  filePath: string,
  units: CodeUnitCandidate[],
  workspaceRoot: string
): EdgeCandidate[] {
  const packages = collectGoImports(parsed.tree.rootNode, workspaceRoot);
  const sameFileUnitNames = new Set(units.map((u) => u.unitName));
  const fileDir = path.dirname(filePath);
  const edges: EdgeCandidate[] = [];

  for (const unit of units) {
    const dotIndex = unit.unitName.indexOf('.');
    const receiverType = dotIndex === -1 ? null : unit.unitName.slice(0, dotIndex);
    const receiverVarName = receiverType ? getGoReceiverVarName(unit.node) : null;
    const { directCallNames, selectorCalls } = collectGoCalls(unit.node);

    for (const name of directCallNames) {
      if (name === unit.unitName) continue; // 재귀 호출 — 그래프 노이즈 제외
      if (sameFileUnitNames.has(name)) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: filePath, toUnitName: name, edgeType: 'calls' });
        continue;
      }
      const siblingFile = findTopLevelFuncFile(fileDir, name, filePath);
      if (siblingFile) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: siblingFile, toUnitName: name, edgeType: 'calls' });
      }
    }

    for (const { object, attribute } of selectorCalls) {
      if (receiverVarName && object === receiverVarName) {
        const target = `${receiverType}.${attribute}`;
        if (target !== unit.unitName && sameFileUnitNames.has(target)) {
          edges.push({ fromUnitName: unit.unitName, toFilePath: filePath, toUnitName: target, edgeType: 'calls' });
        }
        continue;
      }
      const packageDir = packages.get(object);
      if (!packageDir) continue;
      const targetFile = findTopLevelFuncFile(packageDir, attribute);
      if (targetFile) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: targetFile, toUnitName: attribute, edgeType: 'calls' });
      }
    }
  }

  return edges;
}

// ── Java ────────────────────────────────────────────────────────────────
// Java의 import는 Go의 go.mod처럼 결정론적으로 풀 방법이 없다(소스 루트가 워크스페이스
// 루트와 다를 수 있고 — 예: `src/main/java/` — 강제되는 관례가 아니라 프로젝트마다 다름).
// 대신 **이 파일 자신의 package 선언**을 이용한다: `package com.example;`가 있는 파일은
// 관례상 반드시 `.../com/example/`로 끝나는 디렉토리에 있어야 하므로(안 그러면 컴파일이
// 안 됨), 그 파일의 실제 디렉토리에서 패키지 경로만큼 거슬러 올라가면 소스 루트를
// **그 파일에 한해 정확히** 계산할 수 있다 — 워크스페이스 전체에 대한 추측이 필요 없다.
function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findJavaPackageName(root: Parser.SyntaxNode): string {
  for (const child of root.namedChildren) {
    if (child?.type === 'package_declaration') {
      return child.namedChildren[0]?.text ?? '';
    }
  }
  return ''; // package 선언 없음 — 기본 패키지
}

/** packageDotted만큼 fileDir 끝에서 세그먼트 단위로 정확히 걷어낸 소스 루트. 안 맞으면 null. */
function stripPackageSuffix(fileDir: string, packageDotted: string): string | null {
  if (!packageDotted) return fileDir;
  const dirSegments = fileDir.split(path.sep);
  const pkgSegments = packageDotted.split('.');
  if (pkgSegments.length > dirSegments.length) return null;
  const tailStart = dirSegments.length - pkgSegments.length;
  for (let i = 0; i < pkgSegments.length; i++) {
    if (dirSegments[tailStart + i] !== pkgSegments[i]) return null; // 부분 문자열이 아니라 세그먼트 전체 일치 요구
  }
  return dirSegments.slice(0, tailStart).join(path.sep);
}

interface JavaImportedMember {
  filePath: string;
  targetUnitName: string;
}

/**
 * classes: `import a.b.ClassName;` → 로컬 이름(ClassName) → 파일. 셀렉터 호출
 * (`ClassName.method()`) 해석에 쓴다 — Java는 관례상 (public 최상위) 클래스 이름이 곧
 * 우리 유닛 이름 접두어와 같아서, Go처럼 파일 내용을 스캔할 필요 없이 바로
 * `${ClassName}.${method}`를 구성하면 된다.
 * members: `import a.b.Outer.Inner;`(중첩 클래스) 또는 `import static a.b.C.member;`(정적
 * 임포트) — 마지막 세그먼트가 파일로 안 풀릴 때, 그 앞 세그먼트를 파일로 보고 마지막
 * 세그먼트를 그 파일 소속 멤버로 취급한다. 정적 임포트는 보통 한정자 없이 쓰이므로
 * 바로 호출(implicit call) 쪽에서 매칭한다.
 */
function collectJavaImports(root: Parser.SyntaxNode, filePath: string): { classes: Map<string, string>; members: Map<string, JavaImportedMember> } {
  const classes = new Map<string, string>();
  const members = new Map<string, JavaImportedMember>();

  const packageName = findJavaPackageName(root);
  const sourceRoot = stripPackageSuffix(path.dirname(filePath), packageName);
  if (sourceRoot === null) return { classes, members }; // package 선언과 실제 디렉토리 구조가 안 맞음 — 이 파일의 임포트는 못 품

  for (const stmt of root.namedChildren) {
    if (!stmt || stmt.type !== 'import_declaration') continue;
    if (stmt.namedChildren.some((c) => c?.type === 'asterisk')) continue; // `import a.b.*;` — 심볼을 몰라 미해석

    const pathNode = stmt.namedChildren.find((c) => c?.type === 'scoped_identifier' || c?.type === 'identifier');
    if (!pathNode) continue;
    const segments = pathNode.text.split('.');

    const asClassFile = path.join(sourceRoot, ...segments) + '.java';
    if (fileExists(asClassFile)) {
      classes.set(segments[segments.length - 1], asClassFile);
      continue;
    }
    if (segments.length < 2) continue;
    const asMemberOfFile = path.join(sourceRoot, ...segments.slice(0, -1)) + '.java';
    if (fileExists(asMemberOfFile)) {
      const className = segments[segments.length - 2];
      const memberName = segments[segments.length - 1];
      members.set(memberName, { filePath: asMemberOfFile, targetUnitName: `${className}.${memberName}` });
    }
  }

  return { classes, members };
}

interface JavaSelectorCall {
  object: string;
  method: string;
}

function collectJavaCalls(unitNode: Parser.SyntaxNode): { implicitCallNames: Set<string>; selectorCalls: JavaSelectorCall[] } {
  const implicitCallNames = new Set<string>();
  const selectorCalls: JavaSelectorCall[] = [];
  walk(unitNode, (node) => {
    if (node.type !== 'method_invocation') return;
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const objectNode = node.childForFieldName('object');
    // object 필드가 없으면(암묵적 this) 또는 명시적으로 this면 같은 클래스의 메서드 호출.
    if (!objectNode || objectNode.text === 'this') {
      implicitCallNames.add(nameNode.text);
    } else if (objectNode.type === 'identifier') {
      selectorCalls.push({ object: objectNode.text, method: nameNode.text });
    }
  });
  return { implicitCallNames, selectorCalls };
}

/**
 * Java는 모든 메서드가 클래스 안에 있어야 해서 "같은 클래스 메서드 호출"이 Python/Go보다
 * 오히려 더 단순하다 — 한정자 없는 호출(`method_invocation`에 `object` 필드가 없음)은
 * 항상 같은 클래스 자신의 메서드를 가리키므로, Python의 `self`/Go의 리시버 변수 이름
 * 확인 같은 추가 판별이 필요 없다(AST 구조 자체가 이미 구분해줌).
 */
function extractJavaEdges(parsed: ParsedSource, filePath: string, units: CodeUnitCandidate[]): EdgeCandidate[] {
  const { classes, members } = collectJavaImports(parsed.tree.rootNode, filePath);
  const sameFileUnitNames = new Set(units.map((u) => u.unitName));
  const fileDir = path.dirname(filePath);
  const edges: EdgeCandidate[] = [];

  for (const unit of units) {
    const currentClassName = unit.unitType === 'class' ? unit.unitName : unit.unitName.split('.')[0];
    const { implicitCallNames, selectorCalls } = collectJavaCalls(unit.node);

    for (const methodName of implicitCallNames) {
      const target = `${currentClassName}.${methodName}`;
      if (target === unit.unitName) continue; // 재귀 호출 — 그래프 노이즈 제외
      if (sameFileUnitNames.has(target)) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: filePath, toUnitName: target, edgeType: 'calls' });
        continue;
      }
      const member = members.get(methodName); // 정적 임포트로 한정자 없이 쓰는 경우
      if (member) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: member.filePath, toUnitName: member.targetUnitName, edgeType: 'calls' });
      }
    }

    for (const { object, method } of selectorCalls) {
      const targetUnitName = `${object}.${method}`;
      const importedFile = classes.get(object);
      if (importedFile) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: importedFile, toUnitName: targetUnitName, edgeType: 'calls' });
        continue;
      }
      // 임포트 없이 같은 패키지(같은 디렉토리)의 다른 클래스를 부르는 경우 — Java는 관례상
      // public 클래스 이름이 파일명과 같으므로 파일 존재만 확인하면 된다(Go처럼 내용을
      // 스캔할 필요 없음).
      const siblingFile = path.join(fileDir, `${object}.java`);
      if (fileExists(siblingFile)) {
        edges.push({ fromUnitName: unit.unitName, toFilePath: siblingFile, toUnitName: targetUnitName, edgeType: 'calls' });
      }
    }
  }

  return edges;
}

export function extractEdges(
  parsed: ParsedSource,
  filePath: string,
  units: CodeUnitCandidate[],
  workspaceRoot: string
): EdgeCandidate[] {
  if (parsed.lang === 'python') return extractPythonEdges(parsed, filePath, units, workspaceRoot);
  if (parsed.lang === 'go') return extractGoEdges(parsed, filePath, units, workspaceRoot);
  if (parsed.lang === 'java') return extractJavaEdges(parsed, filePath, units);
  return extractJsFamilyEdges(parsed, filePath, units);
}
