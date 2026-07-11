import fs from 'node:fs';

export interface FileTailer {
  stop(): void;
}

export interface TailOptions {
  pollIntervalMs?: number;
  /** true면 파일 끝에서부터 tail 시작(기존 내용은 스킵). 기본은 처음부터(false). */
  startAtEnd?: boolean;
  /**
   * onLine이 던진 예외를 여기로 전달한다. 지정하지 않으면 console.error로만 남기고
   * 삼킨다 — 어느 쪽이든 이 tailer는 절대 멈추지 않고 다음 줄/다음 polling을 계속한다.
   * (한 줄이 파싱 오류를 내더라도 이후 로그 전체를 못 읽게 되면 안 됨.)
   */
  onError?: (err: unknown) => void;
}

/**
 * 파일을 append-only로 가정하고 byte offset 기준 증분 tail한다.
 * fs.watch는 플랫폼별로 신뢰성이 낮아(특히 Windows) 폴링 방식을 사용한다.
 * 파일 크기가 줄어들면(회전/교체) offset을 0으로 되돌려 처음부터 다시 읽는다.
 */
export function tailFile(filePath: string, onLine: (line: string) => void, options: TailOptions = {}): FileTailer {
  const pollIntervalMs = options.pollIntervalMs ?? 300;
  let offset = 0;
  let buffer = '';
  let stopped = false;
  let initialized = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

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

      // 최초 poll 시 startAtEnd면 현재 크기부터 시작(과거 라인은 건너뜀).
      if (!initialized) {
        initialized = true;
        if (options.startAtEnd) {
          offset = stat.size;
          schedule();
          return;
        }
      }

      if (stat.size < offset) {
        // 파일이 회전/교체됨 — 처음부터 다시 읽는다.
        offset = 0;
        buffer = '';
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
