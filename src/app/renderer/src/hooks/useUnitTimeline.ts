import { useEffect, useState } from 'react'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  SkillLevel,
  UnitMatchStat
} from '@shared/types'

const POLL_INTERVAL_MS = 2000

interface UseUnitTimelineResult {
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  unitStats: Map<string, UnitMatchStat>
  selectedUnitId: string | null
  selectUnit: (unitId: string) => void
  versions: CodeUnitVersionWithUnit[]
  explanations: Map<string, AiExplanation>
}

export function useUnitTimeline(skillLevel: SkillLevel): UseUnitTimelineResult {
  const [units, setUnits] = useState<CodeUnit[]>([])
  const [edges, setEdges] = useState<CodeUnitEdge[]>([])
  const [unitStats, setUnitStats] = useState<Map<string, UnitMatchStat>>(new Map())
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [versions, setVersions] = useState<CodeUnitVersionWithUnit[]>([])
  const [explanations, setExplanations] = useState<Map<string, AiExplanation>>(new Map())

  useEffect(() => {
    let cancelled = false

    const fetchStructure = async (): Promise<void> => {
      const [unitRows, edgeRows, statsRows] = await Promise.all([
        window.factcoding.getCodeUnits(),
        window.factcoding.getCodeUnitEdges(),
        window.factcoding.getUnitMatchStats()
      ])
      if (cancelled) return
      setUnits(unitRows)
      setEdges(edgeRows)
      setUnitStats(new Map(statsRows.map((row) => [row.unitId, row])))
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

  return {
    units,
    edges,
    unitStats,
    selectedUnitId,
    selectUnit: setSelectedUnitId,
    versions,
    explanations
  }
}
