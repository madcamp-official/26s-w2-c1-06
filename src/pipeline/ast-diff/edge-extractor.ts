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
export function extractEdges(parsed: ParsedSource, filePath: string, units: CodeUnitCandidate[]): EdgeCandidate[] {
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
