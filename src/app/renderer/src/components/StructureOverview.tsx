import { useMemo } from 'react'
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CodeUnit, CodeUnitEdge, UnitType } from '@shared/types'

interface StructureOverviewProps {
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
}

const UNIT_TYPE_COLOR: Record<UnitType, string> = {
  component: '#61dafb',
  hook: '#c586c0',
  function: '#dcdcaa',
  class: '#4ec9b0'
}

const LAYER_WIDTH = 200
const ROW_HEIGHT = 70

// SPEC 4.5 구조도 오버뷰: code_units를 노드, code_unit_edges를 엣지로 렌더.
// 노드 클릭 시 유닛 타임라인으로 drill-down (Level 1 → Level 3, SPEC 5장).
// 별도 레이아웃 라이브러리 없이, 엣지 방향 기준 BFS로 왼쪽→오른쪽 레이어를 계산한다.
export function StructureOverview({ units, edges, selectedUnitId, onSelectUnit }: StructureOverviewProps) {
  const { nodes, flowEdges } = useMemo(() => {
    const positions = computeLayeredPositions(units, edges)

    const nodes: Node[] = units.map((unit) => ({
      id: unit.id,
      position: positions[unit.id] ?? { x: 0, y: 0 },
      data: { label: `${unit.unit_name}\n${unit.unit_type}` },
      style: {
        border: unit.id === selectedUnitId ? '2px solid #58a6ff' : '1px solid #8888',
        borderLeft: `4px solid ${UNIT_TYPE_COLOR[unit.unit_type] ?? '#888888'}`,
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
        whiteSpace: 'pre-line',
        cursor: 'pointer'
      }
    }))

    return { nodes, flowEdges: mergeParallelEdges(edges) }
  }, [units, edges, selectedUnitId])

  if (units.length === 0) {
    return <div className="structure-overview structure-overview--empty">추적된 코드 유닛이 없습니다.</div>
  }

  return (
    <div className="structure-overview">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodeClick={(_event, node) => onSelectUnit(node.id)}
        fitView
        colorMode="system"
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

function mergeParallelEdges(edges: CodeUnitEdge[]): Edge[] {
  const merged = new Map<string, { source: string; target: string; types: Set<string> }>()

  for (const edge of edges) {
    const key = `${edge.from_unit_id}->${edge.to_unit_id}`
    const entry = merged.get(key) ?? {
      source: edge.from_unit_id,
      target: edge.to_unit_id,
      types: new Set<string>()
    }
    entry.types.add(edge.edge_type)
    merged.set(key, entry)
  }

  return Array.from(merged.entries()).map(([key, entry]) => ({
    id: key,
    source: entry.source,
    target: entry.target,
    label: Array.from(entry.types).join(', ')
  }))
}

function computeLayeredPositions(
  units: CodeUnit[],
  edges: CodeUnitEdge[]
): Record<string, { x: number; y: number }> {
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()
  units.forEach((unit) => incomingCount.set(unit.id, 0))

  for (const edge of edges) {
    if (!incomingCount.has(edge.from_unit_id) || !incomingCount.has(edge.to_unit_id)) continue // 알 수 없는 유닛 참조 스킵
    outgoing.set(edge.from_unit_id, [...(outgoing.get(edge.from_unit_id) ?? []), edge.to_unit_id])
    incomingCount.set(edge.to_unit_id, (incomingCount.get(edge.to_unit_id) ?? 0) + 1)
  }

  const layer = new Map<string, number>()
  const queue: string[] = units.filter((u) => incomingCount.get(u.id) === 0).map((u) => u.id)
  queue.forEach((id) => layer.set(id, 0))

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    const currentLayer = layer.get(id) ?? 0
    for (const nextId of outgoing.get(id) ?? []) {
      if (!layer.has(nextId) || (layer.get(nextId) ?? 0) < currentLayer + 1) {
        layer.set(nextId, currentLayer + 1)
        queue.push(nextId)
      }
    }
  }

  units.forEach((unit) => {
    if (!layer.has(unit.id)) layer.set(unit.id, 0) // 순환/고아 노드는 레이어 0으로 대체
  })

  const rowsUsedPerLayer = new Map<number, number>()
  const positions: Record<string, { x: number; y: number }> = {}

  for (const unit of units) {
    const unitLayer = layer.get(unit.id) ?? 0
    const row = rowsUsedPerLayer.get(unitLayer) ?? 0
    rowsUsedPerLayer.set(unitLayer, row + 1)
    positions[unit.id] = { x: unitLayer * LAYER_WIDTH, y: row * ROW_HEIGHT }
  }

  return positions
}
