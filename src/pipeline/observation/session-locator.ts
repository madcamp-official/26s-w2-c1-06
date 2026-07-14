import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// config.ts가 아니라 여기서 직접 정의한다 — config.ts는 top-level import.meta.url을
// 쓰는 CLI 전용 모듈이라, 여기서 import하면 Electron main 번들(CJS)에 끌려 들어가 깨진다.
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Claude Code가 프로젝트 경로를 ~/.claude/projects/<hash> 디렉토리명으로 매핑하는 규칙.
 * 이전 검증(project명에 밑줄이 없던 "FactCoding" 기준)은 구분자만 치환하면 되는 줄
 * 알았지만, 실제로는 두 가지가 더 있었다 — 밑줄(언더스코어)이 있는 실제 폴더명
 * (version_tts)으로 재검증한 결과 실물 디렉토리가 "c--Users-...-version-tts"였다:
 *   1) 드라이브 문자만 소문자로 정규화(Windows 드라이브 문자는 대소문자 구분 없음
 *      — 나머지 경로 대소문자는 그대로 유지, 즉 전체 lowercase가 아님)
 *   2) 밑줄(_)도 구분자와 마찬가지로 "-"로 치환
 * 이걸 놓치면 해시가 실물 디렉토리와 어긋나 findLatestSessionFile이 항상 null을
 * 반환하고, 파이프라인이 세션 파일을 영영 못 찾아 관찰이 조용히 멈춘다(에러 없이
 * 그냥 아무 tool_event도 안 쌓임 — manual-edit fallback만 계속 잡음).
 */
export function projectPathToHash(projectPath: string): string {
  const withLowerDrive = /^[a-zA-Z]:/.test(projectPath)
    ? projectPath[0].toLowerCase() + projectPath.slice(1)
    : projectPath;
  return withLowerDrive.replace(/[:\\/_]/g, '-');
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
