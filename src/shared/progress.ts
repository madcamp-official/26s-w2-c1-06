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
