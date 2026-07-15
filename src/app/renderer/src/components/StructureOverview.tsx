import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, Panel, ReactFlow, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
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
// 같은 레이어(형제 유닛)가 한 줄에 이 개수를 넘어가면 다음 줄로 감아 내린다. 실제 값은
// 컨테이너의 가로세로 비율에 맞춰 매 렌더 동적으로 계산한다(nodesPerRow, 아래 참조) —
// 이 상수는 컨테이너 크기를 아직 측정하지 못한 최초 렌더 한 프레임 동안만 쓰인다.
const DEFAULT_NODES_PER_ROW = 8

// parser.ts의 langForFilePath와 동일한 목록 — JS/TS/TSX/Python/Go/Java는 tree-sitter로
// 노드+엣지(import/calls)까지 뽑지만, 그 외 언어(ctags 경로)는 노드만 나오고 엣지가
// 전혀 없다(CTAGS_MULTILANG_HANDOFF.md 참조). 렌더러는 DB 조회 없이 file_path 확장자만
// 보고 이 차이를 판별한다 — 백엔드에 "언어별 지원 수준" 필드를 새로 추가하는 대신 이미
// 알려진 확장자 목록을 그대로 재사용.
const FULLY_SUPPORTED_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.mts', '.cts',
  '.tsx',
  '.py',
  '.go',
  '.java'
])

function getExtension(filePath: string): string {
  const match = filePath.match(/(\.[^./\\]+)$/)
  return match ? match[0].toLowerCase() : ''
}

function hasLimitedSupportUnit(units: CodeUnit[]): boolean {
  return units.some((unit) => !FULLY_SUPPORTED_EXTENSIONS.has(getExtension(unit.file_path)))
}

// SPEC 4.5 구조도 오버뷰: code_units를 노드, code_unit_edges를 엣지로 렌더.
// 노드 클릭 시 유닛 타임라인으로 drill-down (Level 1 → Level 3, SPEC 5장).
// 별도 레이아웃 라이브러리 없이, 엣지 방향 기준 BFS로 위→아래 레이어를 계산하고,
// 같은 레이어(의존 관계가 없는 형제 유닛들)는 옆으로 나란히 늘어놓되, 컨테이너 실측 폭에
// 맞춘 개수(nodesPerRow)를 넘으면 그 레이어 안에서 다음 줄로 감아 내린다 — 형제가 많은
// 레이어가 화면 폭을 한없이 넘어가는 대신 여러 줄의 격자로 접혀 fitView가 덜 축소해도
// 다 들어온다.
export function StructureOverview({
  units,
  edges,
  selectedUnitId,
  onSelectUnit,
  heightClassName = 'h-[420px] lg:h-[calc(100vh-260px)]',
  emptyMessage = '추적된 코드 유닛이 없습니다.'
}: StructureOverviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // units가 비어 있으면 아래서 컨테이너 div 자체를 안 그리므로 containerRef가 비어 있다 —
  // 데이터가 나중에 들어와 빈 상태 → 실제 그래프로 바뀌는 순간 이 effect가 다시 돌아
  // 그때 처음 렌더된 div에 옵저버를 붙일 수 있도록 그 전환 자체를 의존성에 넣는다.
  const isEmpty = units.length === 0
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = (width: number, height: number) => setContainerSize({ width, height })
    measure(el.clientWidth, el.clientHeight)
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [isEmpty])

  // 폭만 최대로 채우는 열 수를 쓰면(예: 이전 시도) 폭이 좁은 카드(프롬프트 상세의 미니
  // 구조도 등)에서 열이 2~3개로 줄어 세로 줄 수가 크게 늘어나고, 그 결과 필요한 축소율이
  // React Flow의 기본 minZoom(0.5)보다 작아져 fitView가 다 못 맞추고 중간이 잘려 보이는
  // 문제가 실제로 재현됐다. 폭뿐 아니라 컨테이너의 가로세로 비율 자체에 맞춰 열 수를
  // 골라야(격자 전체의 가로:세로가 컨테이너 가로:세로에 가까워야) 어느 한쪽만 남는 여백 없이
  // 같은 축소율에서 더 크게 보이고, 필요한 축소율 자체도 더 완만해진다.
  const nodesPerRow = useMemo(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0 || units.length === 0) return DEFAULT_NODES_PER_ROW
    const idealCols = Math.round(
      Math.sqrt((units.length * LAYER_HEIGHT * containerSize.width) / (COLUMN_WIDTH * containerSize.height))
    )
    return Math.max(1, Math.min(units.length, idealCols))
  }, [containerSize, units.length])

  const { nodes, flowEdges } = useMemo(() => {
    const positions = computeLayeredPositions(units, edges, nodesPerRow)

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
  }, [units, edges, selectedUnitId, nodesPerRow])

  const showLimitedSupportNotice = useMemo(() => hasLimitedSupportUnit(units), [units])

  // ReactFlow의 fitView prop은 최초 마운트 시 한 번만 맞춰지고, 이후 노드가 늘어나도
  // 뷰포트가 그대로라 새 유닛이 패널 밖으로 벗어날 수 있다 — 관찰 중 코드 구조가 계속
  // 자라나는 이 화면 특성상 매번 사용자가 직접 줌아웃해야 하는 문제가 있었다. onInit으로
  // 인스턴스를 잡아두고, 유닛/엣지 "구성" 자체가 바뀔 때만 다시 fitView를 호출한다.
  // selectedUnitId만 바뀌었을 때(노드 클릭)는 nodes 배열이 스타일 때문에 매번 새로
  // 생성되지만 구조는 그대로이므로, 그때마다 뷰가 재조정되며 화면이 튀는 걸 막기 위해
  // 구조 키(유닛/엣지 id 목록)를 별도로 계산해 그것만 의존성으로 쓴다.
  const structureKey = useMemo(
    () =>
      `${units.map((u) => u.id).join(',')}|${edges.map((e) => `${e.from_unit_id}-${e.to_unit_id}`).join(',')}`,
    [units, edges]
  )
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null)
  useEffect(() => {
    reactFlowInstanceRef.current?.fitView({ padding: 0.15, duration: 200 })
  }, [structureKey, nodesPerRow])

  if (units.length === 0) {
    return <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <div ref={containerRef} className={`structure-overview ${heightClassName}`}>
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodeClick={(_event, node) => onSelectUnit(node.id)}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance
        }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        // React Flow 기본 minZoom(0.5)은 유닛이 많은 프롬프트에서 필요한 축소율보다 클 수
        // 있다 — 그러면 fitView가 그 이상 못 줄이고 일부 노드가 뷰포트 밖으로 잘려 나간다.
        // nodesPerRow를 아무리 잘 골라도 유닛이 아주 많으면 여전히 일어날 수 있으므로,
        // "잘려서 안 보임"보다는 "작아도 전부 보임"이 항상 이기도록 하한을 낮춰둔다.
        minZoom={0.05}
        colorMode="light"
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        {showLimitedSupportNotice && (
          <Panel position="bottom-right">
            <p className="max-w-[220px] rounded-md bg-white/90 px-2 py-1 text-right text-[10px] leading-tight text-muted-foreground shadow-sm">
              일부 언어는 노드만 표시되고 연결선(호출/임포트)은 지원되지 않습니다.
            </p>
          </Panel>
        )}
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
  edges: CodeUnitEdge[],
  nodesPerRow: number
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

  const unitIdsByLayer = new Map<number, string[]>()
  units.forEach((unit) => {
    const unitLayer = layer.get(unit.id) ?? 0
    unitIdsByLayer.set(unitLayer, [...(unitIdsByLayer.get(unitLayer) ?? []), unit.id])
  })

  const positions: Record<string, { x: number; y: number }> = {}
  // rowsUsed: 지금까지의 레이어들이 줄바꿈까지 감안해 실제로 차지한 세로 "줄" 총합.
  // 레이어 자체(의존 depth)의 y 시작 위치를 이 값으로 밀어야, 형제가 많아 여러 줄로
  // 감긴 레이어 다음에 오는 레이어가 그 위에 겹치지 않는다.
  let rowsUsed = 0
  for (const unitLayer of Array.from(unitIdsByLayer.keys()).sort((a, b) => a - b)) {
    const ids = unitIdsByLayer.get(unitLayer) ?? []
    ids.forEach((id, index) => {
      const column = index % nodesPerRow
      const rowWithinLayer = Math.floor(index / nodesPerRow)
      positions[id] = { x: column * COLUMN_WIDTH, y: (rowsUsed + rowWithinLayer) * LAYER_HEIGHT }
    })
    rowsUsed += Math.ceil(ids.length / nodesPerRow)
  }

  return positions
}
