import { useMemo } from 'react'
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CodeUnit, CodeUnitEdge, UnitType } from '@shared/types'

interface StructureOverviewProps {
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
  /** 구조도 탭(전체 화면)과 턴 상세(미니 그래프)가 서로 다른 높이를 쓴다. */
  heightClassName?: string
  emptyMessage?: string
  /**
   * 턴 상세에서 "전체 구조도 위에 이번 턴이 만진 곳"을 강사가 짚어주듯 표시할 때 사용.
   * 지정하면 이 집합에 든 유닛만 강조되고 나머지 노드·엣지는 흐려진다.
   */
  highlightUnitIds?: Set<string> | null
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
export function StructureOverview({
  units,
  edges,
  selectedUnitId,
  onSelectUnit,
  heightClassName = 'h-[420px] lg:h-[calc(100vh-260px)]',
  emptyMessage = '추적된 코드 유닛이 없습니다.',
  highlightUnitIds = null
}: StructureOverviewProps) {
  const { nodes, flowEdges } = useMemo(() => {
    const positions = computeLayeredPositions(units, edges)

    const nodes: Node[] = units.map((unit) => {
      const highlighted = highlightUnitIds?.has(unit.id) ?? false
      const dimmed = highlightUnitIds != null && highlightUnitIds.size > 0 && !highlighted
      // border 축약형 + borderLeft를 섞으면 React가 리렌더마다 스타일 충돌 경고를 낸다
      // — 변마다 개별 속성으로 지정한다.
      const edgeBorder =
        unit.id === selectedUnitId
          ? '2px solid #7fd9b5'
          : highlighted
            ? '2px solid #8ed7ba'
            : '1px solid #2c4250'
      return {
        id: unit.id,
        position: positions[unit.id] ?? { x: 0, y: 0 },
        data: { label: `${unit.unit_name}\n${unit.unit_type}` },
        style: {
          borderTop: edgeBorder,
          borderRight: edgeBorder,
          borderBottom: edgeBorder,
          borderLeft: `4px solid ${UNIT_TYPE_COLOR[unit.unit_type] ?? '#888888'}`,
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          background: highlighted ? '#173229' : '#121d25',
          color: highlighted ? '#d9f5e6' : '#c3d2da',
          boxShadow: highlighted ? '0 0 18px rgba(142,215,186,.28)' : undefined,
          opacity: dimmed ? 0.35 : 1,
          whiteSpace: 'pre-line',
          cursor: 'pointer'
        }
      }
    })

    // 강조 모드에서는 강조 노드에 닿은 엣지만 또렷하게, 나머지는 함께 흐린다.
    const flowEdges = mergeParallelEdges(edges).map((edge) => {
      if (highlightUnitIds == null || highlightUnitIds.size === 0) return edge
      const touchesHighlight =
        highlightUnitIds.has(edge.source) || highlightUnitIds.has(edge.target)
      return touchesHighlight ? edge : { ...edge, style: { opacity: 0.25 }, labelStyle: { opacity: 0.25 } }
    })

    return { nodes, flowEdges }
  }, [units, edges, selectedUnitId, highlightUnitIds])

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
