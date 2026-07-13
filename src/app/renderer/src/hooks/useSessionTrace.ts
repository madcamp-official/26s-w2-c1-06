import { useEffect, useState } from 'react'
import type {
  AiExplanation,
  AssistantNote,
  MatchStats,
  Prompt,
  Session,
  SkillLevel,
  ToolEvent
} from '@shared/types'

const POLL_INTERVAL_MS = 1000

interface UseSessionTraceResult {
  sessionId: string | null
  session: Session | null
  matchStats: MatchStats
  createdEventIds: Set<string>
  prompts: Prompt[]
  events: ToolEvent[]
  notes: AssistantNote[]
  explanations: Map<string, AiExplanation>
  loading: boolean
}

const EMPTY_STATS: MatchStats = { success: 0, error: 0, pending: 0, created: 0 }

export function useSessionTrace(skillLevel: SkillLevel): UseSessionTraceResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [matchStats, setMatchStats] = useState<MatchStats>(EMPTY_STATS)
  const [createdEventIds, setCreatedEventIds] = useState<Set<string>>(new Set())
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [events, setEvents] = useState<ToolEvent[]>([])
  const [notes, setNotes] = useState<AssistantNote[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    window.factcoding.getLatestSession().then((row) => {
      if (cancelled) return
      setSession(row)
      setSessionId(row?.id ?? null)
      if (row === null) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    const fetchTrace = async (): Promise<void> => {
      const [sessionRow, stats, createdIds, promptRows, eventRows, noteRows, explanationRows] =
        await Promise.all([
          window.factcoding.getLatestSession(),
          window.factcoding.getMatchStats(sessionId),
          window.factcoding.getCreatedToolEventIds(sessionId),
          window.factcoding.getPrompts(sessionId),
          window.factcoding.getToolEvents(sessionId),
          window.factcoding.getAssistantNotes(sessionId),
          window.factcoding.getExplanations(sessionId, skillLevel)
        ])
      if (!cancelled) {
        setSession(sessionRow)
        if (sessionRow && sessionRow.id !== sessionId) setSessionId(sessionRow.id)
        setMatchStats(stats)
        setCreatedEventIds(new Set(createdIds))
        setPrompts(promptRows)
        setEvents(eventRows)
        setNotes(noteRows)
        setExplanations(new Map(explanationRows.map((row) => [row.target_id, row])))
        setLoading(false)
      }
    }

    fetchTrace()
    const timer = setInterval(fetchTrace, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionId, skillLevel])

  return {
    sessionId,
    session,
    matchStats,
    createdEventIds,
    prompts,
    events,
    notes,
    explanations,
    loading
  }
}
