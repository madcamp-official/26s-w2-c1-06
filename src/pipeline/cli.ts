import { startPipeline } from './index.js';
import { loadConfig } from './config.js';
import type { TranscriptEvent } from '../shared/types.js';

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

  const shutdown = async () => {
    console.log('\n[factcoding] stopping...');
    // stop()은 진행 중인 AST diff가 DB에 기록될 때까지 기다린다 — await 없이 exit하면
    // 종료 직전 변경이 유실된다.
    await pipeline.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
