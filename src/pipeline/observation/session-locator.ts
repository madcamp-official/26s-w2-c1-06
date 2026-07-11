import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// config.ts가 아니라 여기서 직접 정의한다 — config.ts는 top-level import.meta.url을
// 쓰는 CLI 전용 모듈이라, 여기서 import하면 Electron main 번들(CJS)에 끌려 들어가 깨진다.
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Claude Code가 프로젝트 경로를 ~/.claude/projects/<hash> 디렉토리명으로 매핑하는 규칙.
 * 실물 디렉토리(c:\Users\...\FactCoding -> c--Users-...-FactCoding)를 열어 확인한 결과,
 * 경로 구분자(":", "\\", "/")를 전부 "-"로 치환하는 규칙임을 검증함.
 */
export function projectPathToHash(projectPath: string): string {
  return projectPath.replace(/[:\\/]/g, '-');
}

export function getClaudeProjectDir(projectPath: string): string {
  return path.join(CLAUDE_PROJECTS_DIR, projectPathToHash(projectPath));
}

/** 프로젝트 세션 디렉토리에서 가장 최근에 수정된 *.jsonl 파일을 찾는다. */
export function findLatestSessionFile(projectDir: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return null;
  }

  let latestFile: string | null = null;
  let latestMtimeMs = -Infinity;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const fullPath = path.join(projectDir, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs > latestMtimeMs) {
      latestMtimeMs = stat.mtimeMs;
      latestFile = fullPath;
    }
  }

  return latestFile;
}
