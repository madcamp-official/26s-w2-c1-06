import type { TranscriptEvent } from '../../shared/types.js';

// Claude Code JSONL 라인의 실제 타입 목록(2026-07 기준 관찰치).
// 문서(SPEC 4.1)에는 user/assistant/tool_result만 언급되지만, 실물에는
// queue-operation/attachment/file-history-snapshot/ai-title/last-prompt 등도 섞여 있어
// 안전하게 무시해야 한다 (SPEC 7 리스크: "파서를 필드별 optional-safe하게 작성").
type ContentBlock = { type?: string; [key: string]: unknown };

interface RawLine {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
  };
}

const FILE_PATH_TOOLS = new Set(['Edit', 'Write', 'Read']);

function extractFilePath(toolName: string, input: unknown): string | undefined {
  if (!FILE_PATH_TOOLS.has(toolName)) return undefined;
  if (input && typeof input === 'object' && 'file_path' in input) {
    const fp = (input as Record<string, unknown>).file_path;
    if (typeof fp === 'string') return fp;
  }
  return undefined;
}

/**
 * JSONL 한 줄을 파싱해 0개 이상의 TranscriptEvent로 변환한다.
 * - 알 수 없는 type이거나 JSON 파싱 실패면 빈 배열을 반환(무시), 예외를 던지지 않는다.
 * - 한 줄에서 여러 이벤트가 나올 수 있다 (예: assistant 메시지에 text+tool_use가 같이 옴).
 */
export function parseTranscriptLine(rawLine: string): TranscriptEvent[] {
  let obj: RawLine;
  try {
    obj = JSON.parse(rawLine);
  } catch {
    return [];
  }

  const sessionId = obj.sessionId ?? 'unknown-session';
  const timestamp = obj.timestamp ?? new Date().toISOString();

  if (obj.type === 'user') {
    return parseUserLine(obj, sessionId, timestamp);
  }
  if (obj.type === 'assistant') {
    return parseAssistantLine(obj, sessionId, timestamp);
  }

  // queue-operation, attachment, file-history-snapshot, ai-title, last-prompt 등은 무시
  return [];
}

function parseUserLine(obj: RawLine, sessionId: string, timestamp: string): TranscriptEvent[] {
  const content = obj.message?.content;
  if (typeof content === 'string') {
    // 구버전/단순 포맷 방어: content가 문자열이면 그대로 프롬프트로 취급
    return [{ kind: 'prompt', sessionId, uuid: sessionId + ':' + timestamp, userText: content, timestamp }];
  }
  if (!Array.isArray(content)) return [];

  const events: TranscriptEvent[] = [];
  const textParts: string[] = [];

  for (const block of content) {
    if (block.type === 'tool_result') {
      events.push({
        kind: 'tool_result',
        sessionId,
        toolUseId: String(block.tool_use_id ?? ''),
        isError: Boolean(block.is_error),
        content: block.content,
        timestamp,
      });
    } else if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    }
    // image 등 기타 블록 타입은 Day 1 범위 밖이라 무시
  }

  // 이 라인이 tool_result만 담고 있었다면(실제 사용자 프롬프트가 아님) prompt를 만들지 않는다.
  if (textParts.length > 0) {
    events.push({
      kind: 'prompt',
      sessionId,
      uuid: sessionId + ':' + timestamp,
      userText: textParts.join('\n'),
      timestamp,
    });
  }

  return events;
}

function parseAssistantLine(obj: RawLine, sessionId: string, timestamp: string): TranscriptEvent[] {
  const content = obj.message?.content;
  if (!Array.isArray(content)) return [];

  const events: TranscriptEvent[] = [];

  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      events.push({ kind: 'assistant_text', sessionId, text: block.text, timestamp });
    } else if (block.type === 'tool_use') {
      const toolName = String(block.name ?? '');
      const toolUseId = String(block.id ?? '');
      if (toolName === 'TodoWrite') {
        const todos = Array.isArray((block.input as Record<string, unknown>)?.todos)
          ? ((block.input as Record<string, unknown>).todos as ParsedTodo[])
          : [];
        events.push({ kind: 'todo_write', sessionId, toolUseId, todos, timestamp });
      } else {
        events.push({
          kind: 'tool_use',
          sessionId,
          toolUseId,
          toolName,
          input: block.input,
          filePath: extractFilePath(toolName, block.input),
          timestamp,
        });
      }
    }
    // thinking 블록은 Day 1 범위 밖이라 무시
  }

  return events;
}

const RESULT_TEXT_MAX_LENGTH = 1000;

/**
 * tool_result.content(문자열 또는 {type:'text', text}[] 블록 배열)를 사람이 읽을 수 있는
 * 텍스트로 펼친다. 성공 출력/에러 메시지를 tool_events.result_content에 저장해 AI 캡션이
 * "왜 실패했는지"를 설명할 근거로 쓸 수 있게 한다(explainBatchPrompt 3단계에서 사용).
 * 길이는 프롬프트 토큰/DB 용량을 고려해 truncate한다.
 */
export function extractResultText(content: unknown): string | null {
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((block): block is ContentBlock => typeof block === 'object' && block !== null)
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n');
  } else {
    return null;
  }
  if (!text) return null;
  return text.length > RESULT_TEXT_MAX_LENGTH ? text.slice(0, RESULT_TEXT_MAX_LENGTH) + '…' : text;
}

type ParsedTodo = { content: string; status: string; activeForm: string };
