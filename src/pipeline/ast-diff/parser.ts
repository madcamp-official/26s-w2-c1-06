import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'web-tree-sitter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_WASM = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
const GRAMMARS_DIR = path.join(__dirname, 'grammars');

export type SupportedLang = 'javascript' | 'typescript' | 'tsx';

const GRAMMAR_FILES: Record<SupportedLang, string> = {
  javascript: path.join(GRAMMARS_DIR, 'tree-sitter-javascript.wasm'),
  typescript: path.join(GRAMMARS_DIR, 'tree-sitter-typescript.wasm'),
  tsx: path.join(GRAMMARS_DIR, 'tree-sitter-tsx.wasm'),
};

let initPromise: Promise<void> | null = null;
const languageCache = new Map<SupportedLang, Parser.Language>();

/** MVP grammar 지원 범위: JS/TS/TSX 3종 (SPEC 7 리스크 대응). 확장자로 언어를 정한다. */
export function langForFilePath(filePath: string): SupportedLang | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'typescript';
  if (ext === '.tsx') return 'tsx';
  return null;
}

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({ locateFile: () => CORE_WASM });
  }
  return initPromise;
}

async function loadLanguage(lang: SupportedLang): Promise<Parser.Language> {
  await ensureInitialized();
  const cached = languageCache.get(lang);
  if (cached) return cached;
  const loaded = await Parser.Language.load(GRAMMAR_FILES[lang]);
  languageCache.set(lang, loaded);
  return loaded;
}

export interface ParsedSource {
  tree: Parser.Tree;
  language: Parser.Language;
  lang: SupportedLang;
}

/** source를 파일 확장자에 맞는 grammar로 파싱. 지원하지 않는 확장자면 null. */
export async function parseSource(filePath: string, source: string): Promise<ParsedSource | null> {
  const lang = langForFilePath(filePath);
  if (!lang) return null;
  const language = await loadLanguage(lang);
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  return { tree, language, lang };
}
