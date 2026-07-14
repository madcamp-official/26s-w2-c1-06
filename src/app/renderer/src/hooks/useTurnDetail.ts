import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiExplanation, CodeUnitVersionWithUnit, SkillLevel } from '@shared/types'
import { useDataChanged } from './useDataChanged'

// push('data-changed')가 기본 갱신 경로라 폴링은 안전망으로만 남기고 주기를 늘렸다.
const POLL_INTERVAL_MS = 8000

interface UseTurnDetailResult {
  versions: CodeUnitVersionWithUnit[]
  explanations: Map<string, AiExplanation>
}

// 관제실의 "프롬프트 상세" 화면: 선택된 프롬프트에서 실제로 바뀐 코드 유닛 버전(diff)과 그
// 버전들의 Level 3 해설을 프롬프트 단위로 가져온다. promptId가 null이면 프롬프트에
// 연결되지 않은 수동 수정(SPEC 4.1 fallback)을 대신 조회한다.
export function useTurnDetail(
  sessionId: string | null,
  promptId: string | null,
  skillLevel: SkillLevel
): UseTurnDetailResult {
  const [versions, setVersions] = useState<CodeUnitVersionWithUnit[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())

  // 응답이 늦게 와서 그 사이 sessionId/promptId/skillLevel이 바뀌었으면 stale
  // 응답으로 state를 덮어쓰지 않는다 — push와 폴링이 겹쳐 여러 요청이 동시에 날아갈 수 있다.
  const latestParamsRef = useRef<object | null>(null)

  const fetchDetail = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    const params = {}
    latestParamsRef.current = params
    const [versionRows, explanationRows] = await Promise.all([
      window.factcoding.getUnitVersionsByPrompt(promptId, sessionId),
      window.factcoding.getUnitVersionExplanationsByPrompt(promptId, sessionId, skillLevel)
    ])
    if (latestParamsRef.current !== params) return
    setVersions(versionRows)
    setExplanations(new Map(explanationRows.map((row) => [row.target_id, row])))
  }, [sessionId, promptId, skillLevel])

  useEffect(() => {
    if (!sessionId) {
      setVersions([])
      setExplanations(new Map())
      return
    }

    fetchDetail()
    const timer = setInterval(fetchDetail, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [sessionId, fetchDetail])

  // 이 프롬프트의 코드 유닛 버전(diff)이나 그 해설이 새로 기록되면 즉시 반영.
  useDataChanged(['code-units', 'explanation'], fetchDetail)

  return { versions, explanations }
}
