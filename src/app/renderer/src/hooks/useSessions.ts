import { useEffect, useState } from 'react'
import type { Session } from '@shared/types'

const POLL_INTERVAL_MS = 3000

// 세션 목록(SPEC 4.5 확장) — started_at 내림차순, 진행 중/완료 여부는 ended_at으로 구분.
export function useSessions(): Session[] {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    let cancelled = false

    const fetchSessions = async (): Promise<void> => {
      const rows = await window.factcoding.getSessions()
      if (!cancelled) setSessions(rows)
    }

    fetchSessions()
    const timer = setInterval(fetchSessions, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return sessions
}
