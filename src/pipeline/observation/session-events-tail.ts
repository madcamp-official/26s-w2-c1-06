import path from 'node:path';
import { tailFile, type FileTailer } from './jsonl-tail.js';

export interface SessionEventMarker {
  type: 'start' | 'end';
  sessionId: string;
  ts: string;
}

interface RawMarker {
  type?: string;
  session_id?: string;
  ts?: string;
}

/**
 * `.factcoding/session-events.jsonl`을 tail한다 — session-event-hook.mjs가 append하는
 * {type, session_id, ts} 마커. 파일이 아직 없어도(훅이 한 번도 안 불렸어도) jsonl-tail이
 * 자체적으로 재시도하므로 여기서 별도 존재 체크는 불필요하다.
 */
export function tailSessionEvents(
  projectPath: string,
  onMarker: (marker: SessionEventMarker) => void,
  onError?: (err: unknown) => void
): FileTailer {
  const filePath = path.join(projectPath, '.factcoding', 'session-events.jsonl');
  const cursorPath = path.join(projectPath, '.factcoding', 'cursors', 'session-events.jsonl.offset');
  return tailFile(
    filePath,
    (line) => {
      let obj: RawMarker;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if ((obj.type === 'start' || obj.type === 'end') && obj.session_id && obj.ts) {
        onMarker({ type: obj.type, sessionId: obj.session_id, ts: obj.ts });
      }
    },
    { onError, cursorPath }
  );
}
