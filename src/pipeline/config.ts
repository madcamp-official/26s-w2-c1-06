import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { PipelineConfig } from '../shared/types.js';

// src/pipeline/config.ts 기준 프로젝트 루트(FactCoding/) 계산
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const SCHEMA_PATH = path.join(REPO_ROOT, 'db', 'schema.sql');

export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

export function loadConfig(): PipelineConfig {
  return {
    projectPath: process.env.FACTCODING_PROJECT_PATH ?? process.cwd(),
    dbPath: process.env.FACTCODING_DB_PATH ?? path.join(REPO_ROOT, 'factcoding.db'),
  };
}
