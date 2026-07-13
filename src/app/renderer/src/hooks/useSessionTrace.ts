import { useEffect, useState } from 'react'
import type { AiExplanation, Prompt, SkillLevel, ToolEvent } from '@shared/types'

const POLL_INTERVAL_MS = 1000 // SPEC 4.6: 통합 전까지는 폴링, 이후 IPC push로 대체

interface UseSessionTraceResult {
  sessionId: string | null
  prompts: Prompt[]
  events: ToolEvent[]
  explanations: Map<string, AiExplanation>
  loading: boolean
}

// pinnedSessionId가 주어지면(세션 목록에서 과거 세션을 선택한 경우) 그 세션을 고정해서
// 보여주고, null/undefined면 기존처럼 "가장 최근 세션"을 계속 따라간다(라이브 뷰).
export function useSessionTrace(
  skillLevel: SkillLevel,
  pinnedSessionId?: string | null
): UseSessionTraceResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [events, setEvents] = useState<ToolEvent[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (pinnedSessionId) {
      setSessionId(pinnedSessionId)
      return
    }

    let cancelled = false

    window.factcoding.getLatestSessionId().then((id) => {
      if (cancelled) return
      setSessionId(id)
      if (id === null) setLoading(false) // 세션 자체가 없으면 여기서 로딩 종료 (무한 스피너 방지)
    })

    return () => {
      cancelled = true
    }
  }, [pinnedSessionId])

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    const fetchTrace = async (): Promise<void> => {
      const [promptRows, eventRows, explanationRows] = await Promise.all([
        window.factcoding.getPrompts(sessionId),
        window.factcoding.getToolEvents(sessionId),
        window.factcoding.getExplanations(sessionId, skillLevel)
      ])
      if (!cancelled) {
        setPrompts(promptRows)
        setEvents(eventRows)
        setExplanations(new Map(explanationRows.map((row) => [row.target_id, row])))
        setLoading(false)
      }
    }

    fetchTrace()
    // 과거(고정된) 세션은 더 이상 안 바뀌므로 폴링할 필요가 없다 — 라이브 세션만 폴링.
    const timer = pinnedSessionId ? null : setInterval(fetchTrace, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [sessionId, skillLevel, pinnedSessionId])

  return { sessionId, prompts, events, explanations, loading }
}
