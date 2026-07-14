import { useMemo } from 'react'
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CodeUnit, CodeUnitEdge, UnitType } from '@shared/types'

interface StructureOverviewProps {
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
  /** 구조도 탭(전체 화면)과 프롬프트 상세(미니 그래프)가 서로 다른 높이를 쓴다. */
  heightClassName?: string
  emptyMessage?: string
}

const UNIT_TYPE_COLOR: Record<UnitType, string> = {
  component: '#61dafb',
  hook: '#c586c0',
  function: '#dcdcaa',
  class: '#4ec9b0'
}

const COLUMN_WIDTH = 220
const LAYER_HEIGHT = 90

// SPEC 4.5 구조도 오버뷰: code_units를 노드, code_unit_edges를 엣지로 렌더.
// 노드 클릭 시 유닛 타임라인으로 drill-down (Level 1 → Level 3, SPEC 5장).
// 별도 레이아웃 라이브러리 없이, 엣지 방향 기준 BFS로 위→아래 레이어를 계산하고,
// 같은 레이어(의존 관계가 없는 형제 유닛들)는 옆으로 나란히 늘어놓는다 — 패널이
// 세로로 길고 좁기보다 가로로 넓은 경우가 많아, 같은 레이어 노드가 아래로 쌓이는
// 대신 옆으로 펼쳐져야 "한눈에" 보기 편하다.
export function StructureOverview({
  units,
  edges,
  selectedUnitId,
  onSelectUnit,
  heightClassName = 'h-[420px] lg:h-[calc(100vh-260px)]',
  emptyMessage = '추적된 코드 유닛이 없습니다.'
}: StructureOverviewProps) {
  const { nodes, flowEdges } = useMemo(() => {
    const positions = computeLayeredPositions(units, edges)

    // border 축약형 + borderLeft를 섞으면 React가 리렌더마다 스타일 충돌 경고를 낸다
    // — 변마다 개별 속성으로 지정한다.
    const nodes: Node[] = units.map((unit) => {
      const edgeBorder = unit.id === selectedUnitId ? '2px solid #4f9c84' : '1px solid #dfe3dc'
      return {
        id: unit.id,
        position: positions[unit.id] ?? { x: 0, y: 0 },
        data: { label: `${unit.unit_name}\n${unit.unit_type}` },
        style: {
          borderTop: edgeBorder,
          borderRight: edgeBorder,
          borderBottom: edgeBorder,
          borderLeft: `4px solid ${UNIT_TYPE_COLOR[unit.unit_type] ?? '#9a9a92'}`,
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          background: '#ffffff',
          color: '#373832',
          whiteSpace: 'pre-line',
          cursor: 'pointer'
        }
      }
    })

    return { nodes, flowEdges: mergeParallelEdges(edges) }
  }, [units, edges, selectedUnitId])

  if (units.length === 0) {
    return <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <div className={`structure-overview ${heightClassName}`}>
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodeClick={(_event, node) => onSelectUnit(node.id)}
        fitView
        colorMode="light"
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

  const columnsUsedPerLayer = new Map<number, number>()
  const positions: Record<string, { x: number; y: number }> = {}

  for (const unit of units) {
    const unitLayer = layer.get(unit.id) ?? 0
    const column = columnsUsedPerLayer.get(unitLayer) ?? 0
    columnsUsedPerLayer.set(unitLayer, column + 1)
    positions[unit.id] = { x: column * COLUMN_WIDTH, y: unitLayer * LAYER_HEIGHT }
  }

  return positions
}
