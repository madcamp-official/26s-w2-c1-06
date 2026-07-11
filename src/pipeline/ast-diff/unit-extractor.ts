import type Parser from 'web-tree-sitter';
import type { ParsedSource, SupportedLang } from './parser.js';

export type UnitType = 'function' | 'component' | 'hook' | 'class';

export interface CodeUnitCandidate {
  unitName: string;
  unitType: UnitType;
  text: string;
  /** edge-extractor(Day 4)가 이 유닛의 본문 안에서 call/JSX 참조를 스캔할 때 재사용. */
  node: Parser.SyntaxNode;
}

// 최상위 선언만 추출 (SPEC 4.2). 중첩 함수/클로저는 대상에서 제외한다.
const NESTING_CONTAINER_TYPES = new Set(['function_declaration', 'arrow_function', 'function_expression', 'method_definition']);

// class_declaration의 name 필드 노드 타입이 grammar마다 다르다:
// javascript grammar → identifier, typescript/tsx grammar → type_identifier
// (실제 wasm grammar로 검증한 결과. 두 타입을 한 쿼리 문자열에 같이 쓰면 grammar가
// 모르는 노드 타입을 만나 쿼리 자체가 컴파일 에러가 나므로 언어별로 분리해야 한다.)
const CLASS_NAME_NODE_TYPE: Record<SupportedLang, string> = {
  javascript: 'identifier',
  typescript: 'type_identifier',
  tsx: 'type_identifier',
};

function buildQuerySource(lang: SupportedLang): string {
  return `
(function_declaration name: (identifier) @func.name) @func.decl
(variable_declarator name: (identifier) @arrow.name value: (arrow_function)) @arrow.decl
(class_declaration name: (${CLASS_NAME_NODE_TYPE[lang]}) @class.name) @class.decl
(method_definition name: (property_identifier) @method.name) @method.decl
`;
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

/** 파싱된 트리에서 최상위 함수/컴포넌트/훅/클래스/메서드 선언을 추출한다. */
export function extractUnits({ tree, language, lang }: ParsedSource): CodeUnitCandidate[] {
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
