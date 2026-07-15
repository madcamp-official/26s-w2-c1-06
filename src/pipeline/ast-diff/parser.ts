import path from 'node:path';
import Parser from 'web-tree-sitter';

export type SupportedLang = 'javascript' | 'typescript' | 'tsx' | 'python' | 'go' | 'java';

// wasm 경로는 모듈 로드 시점에 import.meta.url로 계산하지 않고 호출부가 주입한다
// (import.meta 기반 계산은 vite 번들링 시 산출물 경로를 가리키게 됨 — db/connection.ts와
// 같은 이유). startPipeline()이 PipelineConfig.assets로 받아 여기로 넘겨준다.
let coreWasmPath: string | null = null;
let grammarsDir: string | null = null;

export function configureParser(paths: { coreWasmPath: string; grammarsDir: string }): void {
  coreWasmPath = paths.coreWasmPath;
  grammarsDir = paths.grammarsDir;
}

const GRAMMAR_FILENAMES: Record<SupportedLang, string> = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
};

let initPromise: Promise<void> | null = null;
const languageCache = new Map<SupportedLang, Parser.Language>();

/** tree-sitter grammar 지원 범위: JS/TS/TSX/Python/Go/Java. 나머지 언어는 ctags 경로(ctags-extractor.ts)로 간다. */
export function langForFilePath(filePath: string): SupportedLang | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'typescript';
  if (ext === '.tsx') return 'tsx';
  if (ext === '.py') return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.java') return 'java';
  return null;
}

function requireConfigured(value: string | null): string {
  if (!value) {
    throw new Error(
      '[parser] configureParser()가 호출되지 않았습니다 — startPipeline이 PipelineConfig.assets를 전달해야 합니다'
    );
  }
  return value;
}

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    const wasm = requireConfigured(coreWasmPath);
    initPromise = Parser.init({ locateFile: () => wasm });
  }
  return initPromise;
}

async function loadLanguage(lang: SupportedLang): Promise<Parser.Language> {
  await ensureInitialized();
  const cached = languageCache.get(lang);
  if (cached) return cached;
  const dir = requireConfigured(grammarsDir);
  const loaded = await Parser.Language.load(path.join(dir, GRAMMAR_FILENAMES[lang]));
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
