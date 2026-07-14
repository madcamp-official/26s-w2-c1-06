import chokidar from 'chokidar';

export interface ManualWatcher {
  stop(): void;
}

export type ManualFsEventKind = 'add' | 'change' | 'unlink';

const IGNORED_PATTERNS = [/node_modules/, /\.git(\/|\\|$)/, /\.factcoding(\/|\\)/, /\.db(-wal|-shm|-journal)?$/];

function isIgnoredPath(filePath: string): boolean {
  return IGNORED_PATTERNS.some((re) => re.test(filePath));
}

// git checkout/브랜치 전환/대량 find&replace처럼 아주 짧은 시간에 여러 파일이 한꺼번에
// 바뀌는 경우를 "사용자가 직접 타이핑한 수동 수정"으로 개별 기록하면 안 된다 — 트레이스가
// 오염되고(파일 수십 개가 "수동 수정" 카드로 쏟아짐), 한꺼번에 AST 파싱하는 비용도 크다.
// 이 시간(ms) 안에 이 개수를 넘는 fs 이벤트가 몰리면 벌크 작업으로 간주한다.
const BURST_WINDOW_MS = 1000;
const BURST_THRESHOLD = 6;

/**
 * 에이전트가 아닌 수동 파일 생성/수정/삭제를 chokidar로 감지한다 (SPEC 4.1 fallback).
 * `shouldIgnore(filePath)`가 true면(직전에 에이전트가 같은 파일을 건드렸으면) 무시 —
 * 에이전트의 Edit/Write가 만든 디스크 변화까지 "수동 수정"으로 중복 기록하지 않기 위함.
 *
 * onManualEdit의 세 번째 인자 isBulk가 true면 호출부는 스냅샷 캐시만 동기화하고
 * tool_event/AST diff 같은 개별 기록은 생략해야 한다(위 "벌크 작업" 방어).
 */
export function watchManualEdits(
  projectPath: string,
  shouldIgnore: (filePath: string) => boolean,
  onManualEdit: (filePath: string, kind: ManualFsEventKind, isBulk: boolean) => void,
  onError?: (err: unknown) => void
): ManualWatcher {
  const watcher = chokidar.watch(projectPath, {
    ignored: (filePath: string) => isIgnoredPath(filePath),
    ignoreInitial: true,
    // 셸 리다이렉션(`>`)이나 일부 에디터는 파일을 먼저 truncate(0바이트)한 뒤 내용을 쓴다.
    // 이 순간 바로 읽으면 일시적으로 빈 파일을 읽어 "함수가 전부 삭제됨"으로 잘못 diff된다
    // (실제로 재현·확인된 버그) — 파일 크기가 안정될 때까지 기다렸다가 이벤트를 발생시킨다.
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  // chokidar 자체 오류(권한 문제, 파일 핸들 고갈 등) — 리스너가 없으면 EventEmitter가
  // 그대로 throw해 프로세스를 죽인다. 반드시 리스너를 등록해 흡수한다.
  watcher.on('error', (err) => {
    if (onError) onError(err);
    else console.error('[manual-watch] chokidar 오류:', err);
  });

  // 슬라이딩 윈도우: 최근 이벤트 타임스탬프만 유지해 짧은 구간의 이벤트 밀도를 판단한다.
  let recentEventTimestamps: number[] = [];

  function isBulkOperation(): boolean {
    const now = Date.now();
    recentEventTimestamps.push(now);
    recentEventTimestamps = recentEventTimestamps.filter((t) => now - t < BURST_WINDOW_MS);
    return recentEventTimestamps.length > BURST_THRESHOLD;
  }

  function handle(kind: ManualFsEventKind, filePath: string): void {
    if (shouldIgnore(filePath)) return;
    const isBulk = isBulkOperation();
    // onManualEdit은 DB 기록 등 실패할 수 있는 작업을 하므로, 예외가 나도 워처 자체는
    // 계속 살아있어야 한다(다음 파일 변경을 계속 감지해야 함).
    try {
      onManualEdit(filePath, kind, isBulk);
    } catch (err) {
      if (onError) onError(err);
      else console.error('[manual-watch] onManualEdit 처리 중 예외:', err);
    }
  }

  watcher.on('add', (filePath) => handle('add', filePath));
  watcher.on('change', (filePath) => handle('change', filePath));
  watcher.on('unlink', (filePath) => handle('unlink', filePath));

  return {
    stop() {
      void watcher.close();
    },
  };
}
