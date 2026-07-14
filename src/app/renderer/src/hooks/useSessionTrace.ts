import { useEffect, useState } from 'react'
import type { MatchStats, Prompt, Session, SkillLevel } from '@shared/types'

const POLL_INTERVAL_MS = 1000

interface UseSessionTraceResult {
  sessionId: string | null
  session: Session | null
  matchStats: MatchStats
  prompts: Prompt[]
}

const EMPTY_STATS: MatchStats = { success: 0, error: 0, pending: 0, created: 0 }

// 실행 로그(TracePanel)가 없어지면서 이 훅이 들고 있던 events/notes/explanations/
// createdEventIds/loading은 그 패널 전용 데이터였다 — MatchBar(세션 상태 바)가
// 필요로 하는 sessionId/session/matchStats/prompts만 남긴다.
export function useSessionTrace(skillLevel: SkillLevel): UseSessionTraceResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [matchStats, setMatchStats] = useState<MatchStats>(EMPTY_STATS)
  const [prompts, setPrompts] = useState<Prompt[]>([])

  useEffect(() => {
    let cancelled = false

    window.factcoding.getLatestSession().then((row) => {
      if (cancelled) return
      setSession(row)
      setSessionId(row?.id ?? null)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    const fetchTrace = async (): Promise<void> => {
      const [sessionRow, stats, promptRows] = await Promise.all([
        window.factcoding.getLatestSession(),
        window.factcoding.getMatchStats(sessionId),
        window.factcoding.getPrompts(sessionId)
      ])
      if (!cancelled) {
        setSession(sessionRow)
        if (sessionRow && sessionRow.id !== sessionId) setSessionId(sessionRow.id)
        setMatchStats(stats)
        setPrompts(promptRows)
      }
    }

    fetchTrace()
    const timer = setInterval(fetchTrace, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, skillLevel])

  return {
    sessionId,
    session,
    matchStats,
    prompts
  }
}
