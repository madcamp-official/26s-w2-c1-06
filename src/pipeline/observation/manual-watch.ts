import chokidar from 'chokidar';

export interface ManualWatcher {
  stop(): void;
}

const IGNORED_PATTERNS = [/node_modules/, /\.git(\/|\\|$)/, /\.factcoding(\/|\\)/, /\.db(-wal|-shm|-journal)?$/];

function isIgnoredPath(filePath: string): boolean {
  return IGNORED_PATTERNS.some((re) => re.test(filePath));
}

/**
 * 에이전트가 아닌 수동 파일 수정을 chokidar로 감지한다 (SPEC 4.1 fallback).
 * `shouldIgnore(filePath)`가 true면(직전에 에이전트가 같은 파일을 건드렸으면) 무시 —
 * 에이전트의 Edit/Write가 만든 디스크 변화까지 "수동 수정"으로 중복 기록하지 않기 위함.
 */
export function watchManualEdits(
  projectPath: string,
  shouldIgnore: (filePath: string) => boolean,
  onManualEdit: (filePath: string) => void,
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

  watcher.on('change', (filePath) => {
    if (shouldIgnore(filePath)) return;
    // onManualEdit은 DB 기록 등 실패할 수 있는 작업을 하므로, 예외가 나도 워처 자체는
    // 계속 살아있어야 한다(다음 파일 변경을 계속 감지해야 함).
    try {
      onManualEdit(filePath);
    } catch (err) {
      if (onError) onError(err);
      else console.error('[manual-watch] onManualEdit 처리 중 예외:', err);
    }
  });

  return {
    stop() {
      void watcher.close();
    },
  };
}
