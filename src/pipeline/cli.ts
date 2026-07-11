import Database from 'better-sqlite3';
import { startPipeline } from './index.js';
import { loadConfig } from './config.js';
import type { TranscriptEvent } from '../shared/types.js';

const CODE_UNIT_POLL_MS = 1000;

function shortId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) : id;
}

function formatEvent(event: TranscriptEvent): string {
  const sid = shortId(event.sessionId);
  switch (event.kind) {
    case 'prompt':
      return `[${sid}] PROMPT      ${truncate(event.userText)}`;
    case 'assistant_text':
      return `[${sid}] ASSISTANT   ${truncate(event.text)}`;
    case 'tool_use':
      return `[${sid}] TOOL_USE    ${event.toolName}${event.filePath ? ` (${event.filePath})` : ''}`;
    case 'todo_write':
      return `[${sid}] TODO_WRITE  ${event.todos.map((t) => `[${t.status}] ${t.content}`).join(' | ')}`;
    case 'tool_result':
      return `[${sid}] TOOL_RESULT ${event.isError ? 'ERROR' : 'OK'} for ${shortId(event.toolUseId)}`;
  }
}

function truncate(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

function main() {
  const config = loadConfig();
  console.log(`[factcoding] observing project: ${config.projectPath}`);

  const pipeline = startPipeline(config);

  pipeline.on('session-file-changed', (filePath) => {
    console.log(`[factcoding] tailing session file: ${filePath}`);
  });

  pipeline.on('transcript-event', (event) => {
    console.log(formatEvent(event));
  });

  pipeline.on('error', (err) => {
    console.error('[factcoding] pipeline error:', err);
  });

  // AST diff 결과(code_units/code_unit_versions)는 PipelineHandle이 이벤트로 쏘지 않고
  // DB에만 저장된다(Person B의 UI가 SQLite를 직접 폴링하는 구조로 합의했기 때문) — 그래서
  // 원본 대화 로그만 보여주는 위 transcript-event 리스너만으로는 "함수가 어떻게 바뀌었는지"가
  // 안 보인다. cli.ts도 Person B와 똑같은 방식(폴링)으로 새 code_unit_versions를 확인해서
  // 디버그용으로 같이 출력한다.
  let codeUnitDb: Database.Database | null = null;
  let lastSeenRowId = 0;
  const codeUnitPollTimer = setInterval(() => {
    try {
      if (!codeUnitDb) codeUnitDb = new Database(config.dbPath, { readonly: true, fileMustExist: true });
      const rows = codeUnitDb
        .prepare(
          `SELECT cuv.rowid as rowid, cu.file_path, cu.unit_name, cu.unit_type, cuv.change_type, cuv.version_no
           FROM code_unit_versions cuv JOIN code_units cu ON cu.id = cuv.unit_id
           WHERE cuv.rowid > ? ORDER BY cuv.rowid`
        )
        .all(lastSeenRowId) as {
        rowid: number;
        file_path: string;
        unit_name: string;
        unit_type: string;
        change_type: string;
        version_no: number;
      }[];
      for (const row of rows) {
        lastSeenRowId = row.rowid;
        console.log(
          `[CODE_UNIT] ${row.unit_name} (${row.unit_type}) ${row.change_type} v${row.version_no} — ${row.file_path}`
        );
      }
    } catch {
      // DB 파일이 아직 생성 전이거나 일시적으로 잠겨있음 — 다음 폴링에서 재시도
    }
  }, CODE_UNIT_POLL_MS);

  const shutdown = () => {
    console.log('\n[factcoding] stopping...');
    clearInterval(codeUnitPollTimer);
    codeUnitDb?.close();
    pipeline.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
