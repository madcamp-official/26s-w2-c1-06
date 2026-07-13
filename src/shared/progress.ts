// Main → Renderer 진행상황 패널 페이로드 (IPC progress:update)
export interface ProgressKeyCode {
  filePath: string
  lang: string
  snippet: string
  reason: string
}

export interface ProgressUpdate {
  stepId: string
  percent: number
  delta: number
  summary: string
  keyCode: ProgressKeyCode | null
  cycleId: string
}

export interface ProgressLogEntry {
  stepId: string
  summary: string
  keyCode: ProgressKeyCode | null
}

// db:getProgressState IPC 응답 — 렌더러가 마운트되기 전에 이미 끝난 스텝의
// progress:update가 유실됐을 수 있어(Electron IPC는 버퍼링 안 됨), 마운트 시
// "지금까지 쌓인 상태"를 한 번 당겨오는 캐치업 조회용. cycleId는 진행 중인
// 사이클 개념이라 DB에 없음 — 렌더러는 이 값으로 초기 표시만 하고, 이후
// 실시간 progress:update가 오면 그 값으로 갱신한다.
export interface ProgressState {
  percent: number
  history: ProgressLogEntry[]
}
