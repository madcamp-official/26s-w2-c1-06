/** 세션 시작 시각 기준 경과 분 (최소 0). */
export function matchMinute(sessionStartedAt: string | null | undefined, atIso?: string | null): number {
  if (!sessionStartedAt) return 0
  const start = Date.parse(sessionStartedAt)
  const at = atIso ? Date.parse(atIso) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(at)) return 0
  return Math.max(0, Math.floor((at - start) / 60_000))
}

export function formatMatchMinute(minute: number): string {
  return `${minute}'`
}

export type UnitTypePos = 'FW' | 'MF' | 'DF' | 'GK'

export function unitTypeToPos(unitType: string): UnitTypePos {
  switch (unitType) {
    case 'component':
      return 'FW'
    case 'hook':
      return 'MF'
    case 'class':
      return 'DF'
    default:
      return 'MF'
  }
}
