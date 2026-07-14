import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiExplanation, Prompt, SkillLevel, ToolEvent } from '@shared/types'
import { useDataChanged } from './useDataChanged'

// SPEC 4.6: push('data-changed')가 기본 갱신 경로고, 폴링은 그걸 놓친 경우의
// 안전망이라 주기를 넉넉히 늘렸다(예전엔 push가 없어 1000ms로 촘촘히 폴링했음).
const POLL_INTERVAL_MS = 8000

interface UseSessionTraceResult {
  sessionId: string | null
  prompts: Prompt[]
  events: ToolEvent[]
  explanations: Map<string, AiExplanation>
  loading: boolean
}

// pinnedSessionId가 주어지면(세션 목록에서 과거 세션을 선택한 경우) 그 세션을 고정해서
// 보여주고, null/undefined면 기존처럼 "가장 최근 세션"을 계속 따라간다(라이브 뷰).
// projectId가 없으면(프로젝트 미선택) 아무것도 조회하지 않는다.
export function useSessionTrace(
  skillLevel: SkillLevel,
  projectId: string | null,
  pinnedSessionId?: string | null
): UseSessionTraceResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [events, setEvents] = useState<ToolEvent[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())
  const [loading, setLoading] = useState(true)

  const latestProjectRef = useRef<string | null>(null)

  const fetchLatest = useCallback(async (): Promise<void> => {
    if (pinnedSessionId || !projectId) return
    latestProjectRef.current = projectId
    const id = await window.factcoding.getLatestSessionId(projectId)
    if (latestProjectRef.current !== projectId) return // 그 사이 다른 프로젝트로 전환됨 — 버림
    setSessionId(id)
    if (id === null) setLoading(false) // 세션 자체가 없으면 여기서 로딩 종료 (무한 스피너 방지)
  }, [projectId, pinnedSessionId])

  useEffect(() => {
    if (pinnedSessionId) {
      setSessionId(pinnedSessionId)
      return
    }

    if (!projectId) {
      setSessionId(null)
      setLoading(false)
      return
    }

    fetchLatest()
    // 라이브 모드는 "가장 최근 세션"을 계속 따라가야 한다 — 최초 1회만 조회하면
    // "시작하기" 이후 새로 생긴 세션으로 갈아타지 못하고 이전 세션에 계속 머문다.
    const timer = setInterval(fetchLatest, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [projectId, pinnedSessionId, fetchLatest])

  // 새 세션이 시작되면(모니터링 시작, SessionStart 훅) push로 즉시 갈아탄다.
  useDataChanged(['session'], fetchLatest)

  // 요청 시작 시점의 (sessionId, skillLevel)을 기억해뒀다가, 응답이 늦게 와서 그
  // 사이에 둘 중 하나가 바뀌었으면 stale 응답으로 state를 덮어쓰지 않는다 — push와
  // 폴링, 파라미터 변경이 겹쳐 여러 fetchTrace가 동시에 날아갈 수 있어서 필요하다.
  const latestParamsRef = useRef<{ sessionId: string; skillLevel: SkillLevel } | null>(null)

  const fetchTrace = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    const params = { sessionId, skillLevel }
    latestParamsRef.current = params
    const [promptRows, eventRows, explanationRows] = await Promise.all([
      window.factcoding.getPrompts(sessionId),
      window.factcoding.getToolEvents(sessionId),
      window.factcoding.getExplanations(sessionId, skillLevel)
    ])
    if (latestParamsRef.current !== params) return // 그 사이 더 최신 요청이 시작됨 — 버림
    setPrompts(promptRows)
    setEvents(eventRows)
    setExplanations(new Map(explanationRows.map((row) => [row.target_id, row])))
    setLoading(false)
  }, [sessionId, skillLevel])

  useEffect(() => {
    if (!sessionId) {
      // 세션이 없는 프로젝트로 전환한 경우 등 — 이전 세션의 트레이스가 화면에 남지 않게 비운다.
      setPrompts([])
      setEvents([])
      setExplanations(new Map())
      return
    }

    fetchTrace()
    // 과거(고정된) 세션은 더 이상 안 바뀌므로 폴링할 필요가 없다 — 라이브 세션만 폴링.
    const timer = pinnedSessionId ? null : setInterval(fetchTrace, POLL_INTERVAL_MS)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [sessionId, pinnedSessionId, fetchTrace])

  // 새 tool_event/prompt(trace)나 턴 해설(explanation)이 기록되면 즉시 반영.
  useDataChanged(['trace', 'explanation'], fetchTrace)

  return { sessionId, prompts, events, explanations, loading }
}
