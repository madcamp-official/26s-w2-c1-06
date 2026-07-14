import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PipelineConfig } from '../shared/types.js';

// ⚠️ 이 모듈은 CLI(cli.ts) 전용이다 — top-level import.meta.url을 쓰므로 Electron main
// 번들(CJS)에 절대 import하면 안 된다. Electron 쪽은 src/app/main/index.ts가
// app.getAppPath()/process.resourcesPath 기준으로 같은 구조의 assets를 직접 만든다.
// (CLAUDE_PROJECTS_DIR은 양쪽에서 쓰여 session-locator.ts로 옮겼다.)

// src/pipeline/config.ts 기준 프로젝트 루트(FactCoding/) 계산
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql');

export function loadConfig(): PipelineConfig {
  return {
    // CLI는 Electron의 프로젝트 등록 흐름 밖에서 도는 단독 실행 경로라 projects 테이블에
    // 실제로 등록돼 있지 않을 수 있다 — 고정 id로 스코프해 테스트 데이터가 흩어지지 않게 한다.
    projectId: process.env.FACTCODING_PROJECT_ID ?? 'cli-default',
    projectPath: process.env.FACTCODING_PROJECT_PATH ?? process.cwd(),
    // Electron 앱(dev)과 같은 DB를 보도록 db/factcoding.db로 통일 — 예전 기본값은
    // 리포 루트의 factcoding.db였는데, CLI로 채운 데이터가 앱에 안 보이는 원인이 됐다.
    dbPath: process.env.FACTCODING_DB_PATH ?? path.join(REPO_ROOT, 'db', 'factcoding.db'),
    assets: {
      schemaPath: SCHEMA_PATH,
      coreWasmPath: path.join(REPO_ROOT, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
      grammarsDir: path.join(REPO_ROOT, 'src', 'pipeline', 'ast-diff', 'grammars'),
      hookScriptPath: path.join(REPO_ROOT, 'src', 'pipeline', 'hooks', 'session-event-hook.mjs'),
    },
  };
}
