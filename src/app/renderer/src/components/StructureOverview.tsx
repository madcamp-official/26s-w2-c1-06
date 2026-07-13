import { useMemo } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CodeUnit, CodeUnitEdge, UnitMatchStat } from '@shared/types'
import { PlayerUnitNode, type PlayerUnitNodeData } from './PlayerUnitNode'

interface StructureOverviewProps {
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
  unitStats?: Map<string, UnitMatchStat>
}

const LAYER_WIDTH = 220
const ROW_HEIGHT = 90
const RECENT_MS = 5 * 60_000

const nodeTypes: NodeTypes = {
  player: PlayerUnitNode
}

// SPEC 4.5 구조도 = FM 전술판. 커스텀 선수 카드 노드 + 선택 유닛 패스 강조.
export function StructureOverview({
  units,
  edges,
  selectedUnitId,
  onSelectUnit,
  unitStats
}: StructureOverviewProps) {
  const { nodes, flowEdges } = useMemo(() => {
    const positions = computeLayeredPositions(units, edges)
    const now = Date.now()

    const nodes: Node<PlayerUnitNodeData>[] = units.map((unit) => {
      const stat = unitStats?.get(unit.id)
      const lastSeen = unit.last_seen_at ? Date.parse(unit.last_seen_at) : 0
      const recent = Number.isFinite(lastSeen) && now - lastSeen < RECENT_MS

      return {
        id: unit.id,
        type: 'player',
        position: positions[unit.id] ?? { x: 0, y: 0 },
        data: {
          name: unit.unit_name,
          unitType: unit.unit_type,
          versionCount: stat?.versionCount ?? 0,
          latestChangeType: stat?.latestChangeType ?? null,
          selected: unit.id === selectedUnitId,
          recent
        }
      }
    })

    return {
      nodes,
      flowEdges: mergeParallelEdges(edges, selectedUnitId)
    }
  }, [units, edges, selectedUnitId, unitStats])

  if (units.length === 0) {
    return (
      <div className="structure-overview structure-overview--empty">
        전술판에 올라온 선수가 없습니다.
      </div>
    )
  }

  return (
    <div className="structure-overview structure-overview--pitch">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => onSelectUnit(node.id)}
        fitView
        colorMode="system"
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

function mergeParallelEdges(edges: CodeUnitEdge[], selectedUnitId: string | null): Edge[] {
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

  return Array.from(merged.entries()).map(([key, entry]) => {
    const linked =
      selectedUnitId != null &&
      (entry.source === selectedUnitId || entry.target === selectedUnitId)
    return {
      id: key,
      source: entry.source,
      target: entry.target,
      label: Array.from(entry.types).join(', '),
      animated: linked,
      style: linked
        ? { stroke: '#58a6ff', strokeWidth: 2 }
        : { stroke: '#8886', strokeWidth: 1 },
      labelStyle: { fontSize: 10, fill: '#888' }
    }
  })
}

function computeLayeredPositions(
  units: CodeUnit[],
  edges: CodeUnitEdge[]
): Record<string, { x: number; y: number }> {
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()
  units.forEach((unit) => incomingCount.set(unit.id, 0))

  for (const edge of edges) {
    if (!incomingCount.has(edge.from_unit_id) || !incomingCount.has(edge.to_unit_id)) continue
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
    if (!layer.has(unit.id)) layer.set(unit.id, 0)
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
