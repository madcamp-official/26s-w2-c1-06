/** 세션 시작 시각 기준 경과 분 (최소 0). */
export function elapsedMinutes(sessionStartedAt: string | null | undefined, atIso?: string | null): number {
  if (!sessionStartedAt) return 0
  const start = Date.parse(sessionStartedAt)
  const at = atIso ? Date.parse(atIso) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(at)) return 0
  return Math.max(0, Math.floor((at - start) / 60_000))
}

export function formatElapsedMinutes(minute: number): string {
  return `${minute}분`
}
