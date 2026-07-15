import type Parser from 'web-tree-sitter';
import type { ParsedSource, SupportedLang } from './parser.js';

export type UnitType = 'function' | 'component' | 'hook' | 'class';

// tree-sitter 전용 필드(node) 없이 matchUnits처럼 unitName/unitType/text만 필요한 소비자를
// 위한 최소 형태. ctags-extractor.ts(비-JS계열 언어)도 이 형태로 후보를 만들어 matchUnits를
// 그대로 재사용한다 — 이 인터페이스가 그 공통분모.
export interface UnitLike {
  unitName: string;
  unitType: UnitType;
  text: string;
}

export interface CodeUnitCandidate extends UnitLike {
  /** edge-extractor(Day 4)가 이 유닛의 본문 안에서 call/JSX 참조를 스캔할 때 재사용. */
  node: Parser.SyntaxNode;
}

const JS_FAMILY_LANGS = new Set<SupportedLang>(['javascript', 'typescript', 'tsx']);

// 최상위 선언만 추출 (SPEC 4.2). 중첩 함수/클로저는 대상에서 제외한다.
const NESTING_CONTAINER_TYPES = new Set(['function_declaration', 'arrow_function', 'function_expression', 'method_definition']);

// class_declaration의 name 필드 노드 타입이 grammar마다 다르다:
// javascript grammar → identifier, typescript/tsx grammar → type_identifier
// (실제 wasm grammar로 검증한 결과. 두 타입을 한 쿼리 문자열에 같이 쓰면 grammar가
// 모르는 노드 타입을 만나 쿼리 자체가 컴파일 에러가 나므로 언어별로 분리해야 한다.)
const CLASS_NAME_NODE_TYPE: Record<'javascript' | 'typescript' | 'tsx', string> = {
  javascript: 'identifier',
  typescript: 'type_identifier',
  tsx: 'type_identifier',
};

function buildJsFamilyQuerySource(lang: 'javascript' | 'typescript' | 'tsx'): string {
  return `
(function_declaration name: (identifier) @func.name) @func.decl
(variable_declarator name: (identifier) @arrow.name value: (arrow_function)) @arrow.decl
(class_declaration name: (${CLASS_NAME_NODE_TYPE[lang]}) @class.name) @class.decl
(method_definition name: (property_identifier) @method.name) @method.decl
`;
}

// Python은 함수/메서드/중첩 클로저가 전부 같은 노드 타입(function_definition)이라 JS처럼
// 선언 종류별로 쿼리를 나눌 수 없다 — 일단 전부 잡고 나서(isPythonNested) 부모를 걸어
// 올라가며 메서드인지 중첩 함수인지 판별한다.
const PYTHON_QUERY_SOURCE = `
(function_definition name: (identifier) @func.name) @func.decl
(class_definition name: (identifier) @class.name) @class.decl
`;

// Go는 named 함수/메서드 선언을 함수 안에 중첩시키는 문법 자체가 없다(중첩된 건 전부
// func_literal이라는 별개 노드 타입) — 그래서 JS/Python과 달리 isNested 판별이 필요 없다.
// 메서드는 receiver 필드에 소속 타입이 명시적으로 붙어 있어 부모를 걸어 올라갈 필요도 없다.
// 쿼리 안에서 필드 제약 순서(receiver 다음 name)는 실제 grammar의 자식 순서와 일치해야
// 한다 — 순서가 다르면 쿼리 컴파일 자체가 "Bad pattern structure" 에러로 실패한다
// (실제 .wasm으로 검증한 결과, tree-sitter query 엔진의 알려지지 않은 제약).
const GO_QUERY_SOURCE = `
(function_declaration name: (identifier) @func.name) @func.decl
(method_declaration receiver: (parameter_list (parameter_declaration type: (_) @method.receiver_type)) name: (field_identifier) @method.name) @method.decl
(type_declaration (type_spec name: (type_identifier) @class.name type: (struct_type))) @class.decl
(type_declaration (type_spec name: (type_identifier) @class.name type: (interface_type))) @class.decl
`;

// Java는 모든 메서드가 항상 클래스류(class/interface/enum/record) 안에 있어야 하는
// 문법이라(자유 함수가 없음) Go의 receiver 같은 소속 표시가 필요 없다 — 대신 중첩
// 클래스(클래스 안의 클래스)가 흔해서 "몇 겹 안에 있는지"를 세어 최상위 여부를 판별해야
// 한다(JAVA_CLASS_LIKE_TYPES 참조).
const JAVA_QUERY_SOURCE = `
(class_declaration name: (identifier) @class.name) @class.decl
(interface_declaration name: (identifier) @class.name) @class.decl
(enum_declaration name: (identifier) @class.name) @class.decl
(record_declaration name: (identifier) @class.name) @class.decl
(method_declaration name: (identifier) @method.name) @method.decl
`;

function buildQuerySource(lang: SupportedLang): string {
  if (lang === 'python') return PYTHON_QUERY_SOURCE;
  if (lang === 'go') return GO_QUERY_SOURCE;
  if (lang === 'java') return JAVA_QUERY_SOURCE;
  return buildJsFamilyQuerySource(lang);
}

const queryCache = new Map<SupportedLang, Map<Parser.Language, Parser.Query>>();

function getQuery(lang: SupportedLang, language: Parser.Language): Parser.Query {
  let byLanguage = queryCache.get(lang);
  if (!byLanguage) {
    byLanguage = new Map();
    queryCache.set(lang, byLanguage);
  }
  let query = byLanguage.get(language);
  if (!query) {
    query = language.query(buildQuerySource(lang));
    byLanguage.set(language, query);
  }
  return query;
}

function isNested(declNode: Parser.SyntaxNode): boolean {
  let cur = declNode.parent;
  while (cur && cur.type !== 'program') {
    if (NESTING_CONTAINER_TYPES.has(cur.type)) return true;
    cur = cur.parent;
  }
  return false;
}

function findEnclosingClassName(declNode: Parser.SyntaxNode): string | null {
  let cur = declNode.parent;
  while (cur) {
    if (cur.type === 'class_declaration') {
      const nameNode = cur.childForFieldName('name');
      return nameNode ? nameNode.text : null;
    }
    cur = cur.parent;
  }
  return null;
}

function containsJsx(node: Parser.SyntaxNode): boolean {
  if (node.type.startsWith('jsx_')) return true;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && containsJsx(child)) return true;
  }
  return false;
}

function classify(name: string, isClass: boolean, hasJsx: boolean): UnitType {
  if (isClass) return 'class';
  if (hasJsx && /^[A-Z]/.test(name)) return 'component';
  if (/^use[A-Z0-9]/.test(name)) return 'hook';
  return 'function';
}

function extractJsFamilyUnits({ tree, language, lang }: ParsedSource): CodeUnitCandidate[] {
  const query = getQuery(lang, language);
  const matches = query.matches(tree.rootNode);
  const candidates: CodeUnitCandidate[] = [];

  for (const match of matches) {
    const byName = new Map(match.captures.map((c) => [c.name, c.node]));

    if (byName.has('func.decl')) {
      const decl = byName.get('func.decl')!;
      const name = byName.get('func.name')!.text;
      if (isNested(decl)) continue;
      candidates.push({ unitName: name, unitType: classify(name, false, containsJsx(decl)), text: decl.text, node: decl });
    } else if (byName.has('arrow.decl')) {
      const decl = byName.get('arrow.decl')!;
      const name = byName.get('arrow.name')!.text;
      if (isNested(decl)) continue;
      candidates.push({ unitName: name, unitType: classify(name, false, containsJsx(decl)), text: decl.text, node: decl });
    } else if (byName.has('class.decl')) {
      const decl = byName.get('class.decl')!;
      const name = byName.get('class.name')!.text;
      if (isNested(decl)) continue;
      candidates.push({ unitName: name, unitType: 'class', text: decl.text, node: decl });
    } else if (byName.has('method.decl')) {
      const decl = byName.get('method.decl')!;
      const methodName = byName.get('method.name')!.text;
      if (isNested(decl)) continue; // 메서드 자체 조상에 함수가 없어야 함(클래스는 허용)
      const className = findEnclosingClassName(decl);
      const unitName = className ? `${className}.${methodName}` : methodName;
      candidates.push({ unitName, unitType: classify(unitName, false, containsJsx(decl)), text: decl.text, node: decl });
    }
  }

  return candidates;
}

// Python 쪽 "중첩 여부"/"소속 클래스" 판별. JS와 달리 함수/메서드/클로저가 전부
// function_definition 하나뿐이라 부모를 직접 걸어 올라가며 판별해야 한다.
// decorated_definition(@staticmethod 등)은 통과시켜야 하므로 별도로 안 막는다.
function findPythonEnclosingFunctionOrClass(declNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let cur = declNode.parent;
  while (cur && cur.type !== 'module') {
    if (cur.type === 'function_definition' || cur.type === 'class_definition') return cur;
    cur = cur.parent;
  }
  return null;
}

function extractPythonUnits({ tree, language, lang }: ParsedSource): CodeUnitCandidate[] {
  const query = getQuery(lang, language);
  const matches = query.matches(tree.rootNode);
  const candidates: CodeUnitCandidate[] = [];

  for (const match of matches) {
    const byName = new Map(match.captures.map((c) => [c.name, c.node]));

    if (byName.has('class.decl')) {
      const decl = byName.get('class.decl')!;
      const name = byName.get('class.name')!.text;
      const enclosing = findPythonEnclosingFunctionOrClass(decl);
      if (enclosing) continue; // 함수/클래스 내부에 중첩된 클래스는 SPEC 4.2 대상 밖
      candidates.push({ unitName: name, unitType: 'class', text: decl.text, node: decl });
    } else if (byName.has('func.decl')) {
      const decl = byName.get('func.decl')!;
      const funcName = byName.get('func.name')!.text;
      const enclosing = findPythonEnclosingFunctionOrClass(decl);
      if (enclosing?.type === 'function_definition') continue; // 다른 함수 안의 클로저 — 제외
      const unitName = enclosing?.type === 'class_definition' ? `${enclosing.childForFieldName('name')!.text}.${funcName}` : funcName;
      candidates.push({ unitName, unitType: 'function', text: decl.text, node: decl });
    }
  }

  return candidates;
}

// receiver 필드 타입 노드는 값 리시버(type_identifier, 예: "Calculator") 또는 포인터
// 리시버(pointer_type, 예: "*Calculator") 둘 다 가능 — 텍스트에서 선행 `*`만 떼면 된다.
function stripPointerStar(text: string): string {
  return text.startsWith('*') ? text.slice(1) : text;
}

function extractGoUnits({ tree, language, lang }: ParsedSource): CodeUnitCandidate[] {
  const query = getQuery(lang, language);
  const matches = query.matches(tree.rootNode);
  const candidates: CodeUnitCandidate[] = [];

  for (const match of matches) {
    const byName = new Map(match.captures.map((c) => [c.name, c.node]));

    if (byName.has('class.decl')) {
      const decl = byName.get('class.decl')!;
      const name = byName.get('class.name')!.text;
      candidates.push({ unitName: name, unitType: 'class', text: decl.text, node: decl });
    } else if (byName.has('method.decl')) {
      const decl = byName.get('method.decl')!;
      const methodName = byName.get('method.name')!.text;
      const receiverType = stripPointerStar(byName.get('method.receiver_type')!.text);
      candidates.push({ unitName: `${receiverType}.${methodName}`, unitType: 'function', text: decl.text, node: decl });
    } else if (byName.has('func.decl')) {
      const decl = byName.get('func.decl')!;
      const name = byName.get('func.name')!.text;
      candidates.push({ unitName: name, unitType: 'function', text: decl.text, node: decl });
    }
  }

  return candidates;
}

const JAVA_CLASS_LIKE_TYPES = new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']);

// declNode를 감싸는 클래스류 조상을 전부 걸어 올라가며 수집한다(가까운 것부터). Java는
// 모든 메서드가 클래스류 안에 있어야 하므로 "몇 겹인지"로 최상위 여부를 판별한다 —
// 정확히 1겹이면 최상위 클래스의 직속 멤버, 2겹 이상이면 중첩 클래스 안이라 SPEC 4.2
// 대상 밖(최상위 선언만).
function collectJavaEnclosingClassLikes(declNode: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const ancestors: Parser.SyntaxNode[] = [];
  let cur = declNode.parent;
  while (cur && cur.type !== 'program') {
    if (JAVA_CLASS_LIKE_TYPES.has(cur.type)) ancestors.push(cur);
    cur = cur.parent;
  }
  return ancestors;
}

function extractJavaUnits({ tree, language, lang }: ParsedSource): CodeUnitCandidate[] {
  const query = getQuery(lang, language);
  const matches = query.matches(tree.rootNode);
  const candidates: CodeUnitCandidate[] = [];

  for (const match of matches) {
    const byName = new Map(match.captures.map((c) => [c.name, c.node]));

    if (byName.has('class.decl')) {
      const decl = byName.get('class.decl')!;
      const name = byName.get('class.name')!.text;
      if (collectJavaEnclosingClassLikes(decl).length > 0) continue; // 중첩 클래스 — 제외
      candidates.push({ unitName: name, unitType: 'class', text: decl.text, node: decl });
    } else if (byName.has('method.decl')) {
      const decl = byName.get('method.decl')!;
      const methodName = byName.get('method.name')!.text;
      const enclosing = collectJavaEnclosingClassLikes(decl);
      if (enclosing.length !== 1) continue; // 0겹(불가능) 또는 2겹 이상(중첩 클래스 소속) — 제외
      const className = enclosing[0].childForFieldName('name')!.text;
      candidates.push({ unitName: `${className}.${methodName}`, unitType: 'function', text: decl.text, node: decl });
    }
  }

  return candidates;
}

/** 파싱된 트리에서 최상위 함수/컴포넌트/훅/클래스/메서드 선언을 추출한다. */
export function extractUnits(parsed: ParsedSource): CodeUnitCandidate[] {
  if (JS_FAMILY_LANGS.has(parsed.lang)) return extractJsFamilyUnits(parsed);
  if (parsed.lang === 'go') return extractGoUnits(parsed);
  if (parsed.lang === 'java') return extractJavaUnits(parsed);
  return extractPythonUnits(parsed);
}
