import fs from 'node:fs';
import path from 'node:path';

export interface FileTailer {
  stop(): void;
}

export interface TailOptions {
  pollIntervalMs?: number;
  /** true면 파일 끝에서부터 tail 시작(기존 내용은 스킵). 기본은 처음부터(false). */
  startAtEnd?: boolean;
  /**
   * 지정하면 읽은 byte offset을 이 경로에 저장해두고, 다음 시작 시 거기서부터 이어 읽는다.
   * 앱(Electron main)이 재시작될 때마다 offset이 메모리에서 0으로 리셋되면서 이미 처리한
   * 내용을 처음부터 다시 읽는 문제(이미 끝난 세션이 재시작마다 "새로 끝난 세션"으로 재감지돼
   * 리포트가 중복 생성됨)를 막기 위함 — DB 상태와 무관하게, 파일 자체를 어디까지 읽었는지
   * 디스크에 별도로 기록해둔다.
   */
  cursorPath?: string;
  /**
   * onLine이 던진 예외를 여기로 전달한다. 지정하지 않으면 console.error로만 남기고
   * 삼킨다 — 어느 쪽이든 이 tailer는 절대 멈추지 않고 다음 줄/다음 polling을 계속한다.
   * (한 줄이 파싱 오류를 내더라도 이후 로그 전체를 못 읽게 되면 안 됨.)
   */
  onError?: (err: unknown) => void;
}

function loadCursor(cursorPath: string): number | null {
  try {
    const text = fs.readFileSync(cursorPath, 'utf8').trim();
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function saveCursor(cursorPath: string, offset: number): void {
  fs.writeFile(cursorPath, String(offset), () => {
    // 커서 저장 실패는 "다음 재시작 때 조금 더 다시 읽는" 정도라 조용히 무시한다 —
    // tailer 본연의 동작(다음 줄 계속 읽기)을 막을 이유가 아니다.
  });
}

/**
 * 파일을 append-only로 가정하고 byte offset 기준 증분 tail한다.
 * fs.watch는 플랫폼별로 신뢰성이 낮아(특히 Windows) 폴링 방식을 사용한다.
 * 파일 크기가 줄어들면(회전/교체) offset을 0으로 되돌려 처음부터 다시 읽는다.
 */
export function tailFile(filePath: string, onLine: (line: string) => void, options: TailOptions = {}): FileTailer {
  const pollIntervalMs = options.pollIntervalMs ?? 300;
  const cursorPath = options.cursorPath;
  let offset = 0;
  let buffer = '';
  let stopped = false;
  let initialized = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (cursorPath) {
    try {
      fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    } catch {
      // 디렉토리를 못 만들면 이후 saveCursor 호출들이 조용히 실패할 뿐 — 폴백은 매 재시작마다
      // 처음부터 다시 읽는, 커서 도입 전과 동일한 동작이라 별도 처리 없이 진행한다.
    }
  }

  function schedule() {
    if (!stopped) timer = setTimeout(poll, pollIntervalMs);
  }

  function poll() {
    if (stopped) return;
    fs.stat(filePath, (err, stat) => {
      if (stopped) return;

      if (err) {
        schedule();
        return;
      }

      // 최초 poll 시: 저장된 커서가 있으면 거기서 이어 읽고(재시작 후 재처리 방지),
      // 없으면 startAtEnd 여부에 따라 처음부터 또는 현재 크기부터 시작한다.
      if (!initialized) {
        initialized = true;
        const savedOffset = cursorPath ? loadCursor(cursorPath) : null;
        if (savedOffset !== null) {
          offset = Math.min(savedOffset, stat.size);
        } else if (options.startAtEnd) {
          offset = stat.size;
          schedule();
          return;
        }
      }

      if (stat.size < offset) {
        // 파일이 회전/교체됨 — 처음부터 다시 읽는다.
        offset = 0;
        buffer = '';
        if (cursorPath) saveCursor(cursorPath, offset);
      }

      if (stat.size <= offset) {
        schedule();
        return;
      }

      const stream = fs.createReadStream(filePath, { start: offset, end: stat.size - 1, encoding: 'utf8' });
      let chunk = '';
      stream.on('data', (d) => {
        chunk += d;
      });
      stream.on('end', () => {
        offset = stat.size;
        if (cursorPath) saveCursor(cursorPath, offset);
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // 마지막(아직 flush 미완료일 수 있는) 라인은 버퍼에 보관
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          // onLine(및 그 안에서 emit되는 이벤트를 받는 리스너들)이 예외를 던져도
          // 이 tailer 자체는 죽지 않고 나머지 줄/다음 polling을 계속 진행해야 한다.
          try {
            onLine(trimmed);
          } catch (err) {
            if (options.onError) options.onError(err);
            else console.error('[jsonl-tail] onLine 처리 중 예외:', err);
          }
        }
        schedule();
      });
      stream.on('error', () => {
        schedule();
      });
    });
  }

  poll();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
