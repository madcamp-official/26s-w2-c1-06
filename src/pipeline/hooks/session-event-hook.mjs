#!/usr/bin/env node
// Claude Code SessionStart/SessionEnd/Stop 훅이 실행하는 독립 스크립트.
// TS 빌드 없이 `node <이 파일>`로 바로 실행되므로 순수 JS(ESM)로 작성한다.
// stdin으로 훅 payload(JSON)를 받아 `.factcoding/session-events.jsonl`에
// {type: 'start'|'end'|'turn_end', session_id, ts} 한 줄을 append한다. 실패해도
// 세션을 막으면 안 되므로(차단용 훅이 아님) 항상 exit 0으로 종료한다.
// Stop은 세션이 아니라 매 턴(에이전트 응답 1회)이 끝날 때마다 발생한다 — UI가
// "에이전트 작업이 지금 끝났다"를 유휴시간 추정 없이 즉시 아는 유일한 신호다.

import fs from 'node:fs';
import path from 'node:path';

const HOOK_EVENT_TO_TYPE = {
  SessionStart: 'start',
  SessionEnd: 'end',
  Stop: 'turn_end',
};

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // 파싱 불가 payload는 조용히 무시(세션 진행을 막지 않음)
    return;
  }

  const type = HOOK_EVENT_TO_TYPE[payload.hook_event_name];
  if (!type) {
    process.exit(0);
    return;
  }

  const projectDir = payload.cwd || process.cwd();
  const factcodingDir = path.join(projectDir, '.factcoding');
  const eventsFile = path.join(factcodingDir, 'session-events.jsonl');

  try {
    fs.mkdirSync(factcodingDir, { recursive: true });
    const line = JSON.stringify({ type, session_id: payload.session_id, ts: new Date().toISOString() }) + '\n';
    fs.appendFileSync(eventsFile, line, 'utf8');
  } catch {
    // 파일 쓰기 실패해도 세션 진행에 영향 주지 않는다.
  }

  process.exit(0);
}

main();
