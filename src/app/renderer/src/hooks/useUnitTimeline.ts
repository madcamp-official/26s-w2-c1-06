import { useEffect, useState } from 'react'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  SkillLevel
} from '@shared/types'

const POLL_INTERVAL_MS = 2000 // 트레이스보다 갱신 빈도가 낮아도 되는 데이터

interface UseUnitTimelineResult {
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  selectedUnitId: string | null
  selectUnit: (unitId: string) => void
  versions: CodeUnitVersionWithUnit[]
  explanations: Map<string, AiExplanation>
}

// SPEC 4.5 "구조도 오버뷰" + "코드 유닛 타임라인": 유닛/엣지(구조) + 선택된
// 유닛의 버전 체인과 그 버전들의 Level 3 해설(ai_explanations)을 함께 폴링한다.
export function useUnitTimeline(skillLevel: SkillLevel): UseUnitTimelineResult {
  const [units, setUnits] = useState<CodeUnit[]>([])
  const [edges, setEdges] = useState<CodeUnitEdge[]>([])
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [versions, setVersions] = useState<CodeUnitVersionWithUnit[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())

  useEffect(() => {
    let cancelled = false

    const fetchStructure = async (): Promise<void> => {
      const [unitRows, edgeRows] = await Promise.all([
        window.factcoding.getCodeUnits(),
        window.factcoding.getCodeUnitEdges()
      ])
      if (cancelled) return
      setUnits(unitRows)
      setEdges(edgeRows)
      // 최초 로드 시 첫 유닛 자동 선택 (빈 화면 방지)
      setSelectedUnitId((current) => current ?? unitRows[0]?.id ?? null)
    }

    fetchStructure()
    const timer = setInterval(fetchStructure, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!selectedUnitId) return

    let cancelled = false

    const fetchTimeline = async (): Promise<void> => {
      const [versionRows, explanationRows] = await Promise.all([
        window.factcoding.getUnitVersions(selectedUnitId),
        window.factcoding.getUnitVersionExplanations(selectedUnitId, skillLevel)
      ])
      if (cancelled) return
      setVersions(versionRows)
      setExplanations(new Map(explanationRows.map((row) => [row.target_id, row])))
    }

    fetchTimeline()
    const timer = setInterval(fetchTimeline, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [selectedUnitId, skillLevel])

  return { units, edges, selectedUnitId, selectUnit: setSelectedUnitId, versions, explanations }
}
