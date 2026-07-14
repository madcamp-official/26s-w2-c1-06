// Main → Renderer 진행상황 패널 페이로드 (IPC progress:update)
export interface ProgressKeyCode {
  filePath: string
  lang: string
  snippet: string // 결정론적으로 추출된 실제 diff — AI가 만들지 않음
  otherFiles: string[] // 같은 스텝에서 함께 바뀐 나머지 파일(있으면)
  explanation: string // 이 코드가 무엇인지
  importance: string // 이 코드가 중요한 이유
  application: string // 이 코드로 배우는 점(학습 포인트)
  conceptTags: string[] // 관련 개념 해시태그(예: ["비동기", "에러 핸들링"])
}

export type StepStatus = 'success' | 'failed'

export interface ProgressUpdate {
  stepId: string
  percent: number
  delta: number
  summary: string
  keyCode: ProgressKeyCode | null
  errorDetail: string | null // 실패 스텝의 원본 에러 메시지(요약/truncate만, AI 생성 아님)
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
  errorDetail: string | null
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
