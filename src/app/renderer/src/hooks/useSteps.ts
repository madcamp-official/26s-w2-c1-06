import { useCallback, useEffect, useRef, useState } from 'react'
import type { SkillLevel, StepWithExplanation } from '@shared/types'
import { useDataChanged } from './useDataChanged'

// push('data-changed')가 기본 갱신 경로라 폴링은 안전망으로만 남기고 주기를 늘렸다.
const POLL_INTERVAL_MS = 8000

// 실시간 진행 로그(활동 탭 "바뀐 구조와 변경사항"): 세션 전체의 스텝을 한 번에
// 받아온다 — 턴별로 나눠 조회하지 않는 이유는 groupIntoSteps가 세션 단위로만
// 정확히 계산되기 때문(스텝 경계가 턴을 넘지 않긴 하지만, 계산 자체는 세션
// 전체 이벤트를 봐야 한다). 호출부가 promptId로 필터링해서 쓴다.
export function useSteps(sessionId: string | null, skillLevel: SkillLevel): StepWithExplanation[] {
  const [steps, setSteps] = useState<StepWithExplanation[]>([])
  const latestSessionRef = useRef<string | null>(null)

  const fetchSteps = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    latestSessionRef.current = sessionId
    const rows = await window.factcoding.getSteps(sessionId, skillLevel)
    if (latestSessionRef.current !== sessionId) return // 그 사이 다른 세션으로 전환됨 — 버림
    setSteps(rows)
  }, [sessionId, skillLevel])

  useEffect(() => {
    if (!sessionId) {
      setSteps([])
      return
    }

    fetchSteps()
    const timer = setInterval(fetchSteps, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [sessionId, fetchSteps])

  // 스텝 요약도 ai_explanations 행이라 'explanation' kind로 push된다. 새 tool_event가
  // 생겨 스텝 경계 자체가 바뀔 수도 있어(진행 중 스텝에 이벤트가 계속 붙는 것) 'trace'도 구독.
  useDataChanged(['trace', 'explanation'], fetchSteps)

  return steps
}
