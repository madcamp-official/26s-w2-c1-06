import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionWithPreview } from '@shared/types'
import { useDataChanged } from './useDataChanged'

// push('data-changed')가 기본 갱신 경로라 폴링은 안전망으로만 남기고 주기를 늘렸다.
const POLL_INTERVAL_MS = 10000

// 세션 목록(SPEC 4.5 확장) — started_at 내림차순, 진행 중/완료 여부는 ended_at으로 구분.
// 각 세션에는 첫 프롬프트 텍스트(first_prompt_text)가 붙어 있어 사이드바 "지난 프롬프트"
// 목록에서 세션을 짧은 id 대신 실제 요청 내용으로 보여줄 수 있다.
// projectId가 없으면(프로젝트 미선택) 조회하지 않는다.
export function useSessions(projectId: string | null): SessionWithPreview[] {
  const [sessions, setSessions] = useState<SessionWithPreview[]>([])
  const latestProjectRef = useRef<string | null>(null)

  const fetchSessions = useCallback(async (): Promise<void> => {
    if (!projectId) return
    latestProjectRef.current = projectId
    const rows = await window.factcoding.getSessions(projectId)
    if (latestProjectRef.current !== projectId) return // 그 사이 다른 프로젝트로 전환됨 — 버림
    setSessions(rows)
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setSessions([])
      return
    }

    fetchSessions()
    const timer = setInterval(fetchSessions, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [projectId, fetchSessions])

  // 세션이 새로 생기거나 시작/종료 시각이 바뀌면 즉시 반영.
  useDataChanged(['session'], fetchSessions)

  return sessions
}
