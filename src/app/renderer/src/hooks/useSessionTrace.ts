import { useEffect, useState } from 'react'
import type { AiExplanation, AssistantNote, Prompt, SkillLevel, ToolEvent } from '@shared/types'

const POLL_INTERVAL_MS = 1000 // SPEC 4.6: 통합 전까지는 폴링, 이후 IPC push로 대체

interface UseSessionTraceResult {
  sessionId: string | null
  prompts: Prompt[]
  events: ToolEvent[]
  notes: AssistantNote[]
  explanations: Map<string, AiExplanation>
  stepExplanations: Map<string, AiExplanation>
  loading: boolean
}

export function useSessionTrace(skillLevel: SkillLevel): UseSessionTraceResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [events, setEvents] = useState<ToolEvent[]>([])
  const [notes, setNotes] = useState<AssistantNote[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())
  const [stepExplanations, setStepExplanations] = useState<Map<string, AiExplanation>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    window.factcoding.getLatestSessionId().then((id) => {
      if (cancelled) return
      setSessionId(id)
      if (id === null) setLoading(false) // 세션 자체가 없으면 여기서 로딩 종료 (무한 스피너 방지)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    const fetchTrace = async (): Promise<void> => {
      const [promptRows, eventRows, noteRows, explanationRows, stepExplanationRows] = await Promise.all([
        window.factcoding.getPrompts(sessionId),
        window.factcoding.getToolEvents(sessionId),
        window.factcoding.getAssistantNotes(sessionId),
        window.factcoding.getExplanations(sessionId, skillLevel),
        window.factcoding.getStepExplanations(sessionId, skillLevel)
      ])
      if (!cancelled) {
        setPrompts(promptRows)
        setEvents(eventRows)
        setNotes(noteRows)
        setExplanations(new Map(explanationRows.map((row) => [row.target_id, row])))
        setStepExplanations(new Map(stepExplanationRows.map((row) => [row.target_id, row])))
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

  return { sessionId, prompts, events, notes, explanations, stepExplanations, loading }
}
