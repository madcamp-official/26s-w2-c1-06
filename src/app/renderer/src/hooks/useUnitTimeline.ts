import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  SkillLevel
} from '@shared/types'
import { useDataChanged } from './useDataChanged'

// push('data-changed')가 기본 갱신 경로라 폴링은 안전망으로만 남기고 주기를 늘렸다.
const POLL_INTERVAL_MS = 10000

interface UseUnitTimelineResult {
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  selectedUnitId: string | null
  selectUnit: (unitId: string) => void
  versions: CodeUnitVersionWithUnit[]
  explanations: Map<string, AiExplanation>
}

// SPEC 4.5 "구조도 오버뷰" + "코드 유닛 타임라인": 유닛/엣지(구조) + 선택된
// 유닛의 버전 체인과 그 버전들의 Level 3 해설(ai_explanations)을 함께 조회한다.
// projectId가 없으면(프로젝트 미선택) 조회하지 않는다.
export function useUnitTimeline(skillLevel: SkillLevel, projectId: string | null): UseUnitTimelineResult {
  const [units, setUnits] = useState<CodeUnit[]>([])
  const [edges, setEdges] = useState<CodeUnitEdge[]>([])
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [versions, setVersions] = useState<CodeUnitVersionWithUnit[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())

  const latestProjectRef = useRef<string | null>(null)

  const fetchStructure = useCallback(async (): Promise<void> => {
    if (!projectId) return
    latestProjectRef.current = projectId
    const [unitRows, edgeRows] = await Promise.all([
      window.factcoding.getCodeUnits(projectId),
      window.factcoding.getCodeUnitEdges(projectId)
    ])
    if (latestProjectRef.current !== projectId) return // 그 사이 다른 프로젝트로 전환됨 — 버림
    setUnits(unitRows)
    setEdges(edgeRows)
    // 최초 로드 시 첫 유닛 자동 선택(빈 화면 방지). 선택된 유닛이 지금 프로젝트에
    // 없으면(프로젝트 전환으로 이전 프로젝트의 유닛 id가 남은 경우) 첫 유닛으로 교체 —
    // 안 그러면 타임라인이 계속 다른 프로젝트의 유닛을 조회한다.
    setSelectedUnitId((current) =>
      current && unitRows.some((u) => u.id === current) ? current : (unitRows[0]?.id ?? null)
    )
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setUnits([])
      setEdges([])
      setSelectedUnitId(null)
      return
    }

    fetchStructure()
    const timer = setInterval(fetchStructure, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [projectId, fetchStructure])

  useDataChanged(['code-units'], fetchStructure)

  const latestUnitRef = useRef<string | null>(null)

  const fetchTimeline = useCallback(async (): Promise<void> => {
    if (!selectedUnitId) return
    latestUnitRef.current = selectedUnitId
    const [versionRows, explanationRows] = await Promise.all([
      window.factcoding.getUnitVersions(selectedUnitId),
      window.factcoding.getUnitVersionExplanations(selectedUnitId, skillLevel)
    ])
    if (latestUnitRef.current !== selectedUnitId) return
    setVersions(versionRows)
    setExplanations(new Map(explanationRows.map((row) => [row.target_id, row])))
  }, [selectedUnitId, skillLevel])

  useEffect(() => {
    if (!selectedUnitId) {
      setVersions([])
      setExplanations(new Map())
      return
    }

    fetchTimeline()
    const timer = setInterval(fetchTimeline, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [selectedUnitId, fetchTimeline])

  useDataChanged(['code-units', 'explanation'], fetchTimeline)

  return { units, edges, selectedUnitId, selectUnit: setSelectedUnitId, versions, explanations }
}
