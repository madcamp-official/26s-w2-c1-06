// Main → Renderer 진행상황 패널 페이로드 (IPC progress:update)
export interface ProgressKeyCode {
  filePath: string
  lang: string
  snippet: string
  reason: string
}

export type StepStatus = 'success' | 'failed'

export interface ProgressUpdate {
  stepId: string
  percent: number
  delta: number
  summary: string
  keyCode: ProgressKeyCode | null
  cycleId: string
  status: StepStatus
  cycleNumber: number   // 1부터 시작, 사이클(CYCLE_SIZE 스텝) 롤오버마다 +1
  stepsInCycle: number  // 이번 사이클에서 지금까지 완료된 스텝 수 (분모는 CYCLE_SIZE)
  cycleSize: number
}

export interface ProgressLogEntry {
  stepId: string
  summary: string
  keyCode: ProgressKeyCode | null
  status: StepStatus
}

// db:getProgressState IPC 응답 — 렌더러가 마운트되기 전에 이미 끝난 스텝의
// progress:update가 유실됐을 수 있어(Electron IPC는 버퍼링 안 됨), 마운트 시
// "지금까지 쌓인 상태"를 한 번 당겨오는 캐치업 조회용. cycleId/cycleNumber/stepsInCycle은
// 진행 중인 사이클 개념이라 DB에 없음 — 렌더러는 percent/history만 초기 표시하고, 이후
// 실시간 progress:update가 오면 그 값으로 사이클 정보까지 채운다.
export interface ProgressState {
  percent: number
  history: ProgressLogEntry[]
}

// Main → Renderer "지금 하는 중" 실시간 상태 (IPC progress:live-status).
// Gemini 요약을 기다리지 않는 로컬 규칙 기반 텍스트라 progress:update보다
// 훨씬 빠른 주기로 갱신된다 — DB 캐치업 대상이 아님(항상 최신 한 줄만 의미 있음).
export interface LiveStatus {
  text: string
  idle: boolean
}
