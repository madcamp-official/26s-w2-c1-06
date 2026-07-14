import { GitBranch } from 'lucide-react'
import type { AiExplanation, CodeUnit, CodeUnitEdge, CodeUnitVersionWithUnit } from '@shared/types'
import { StructureOverview } from './StructureOverview'
import { TurnChanges } from './TurnChanges'
import type { TurnListItem } from './TurnList'
import { UnitTimeline } from './UnitTimeline'

interface TurnDetailPanelProps {
  turn: TurnListItem | null
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  versions: CodeUnitVersionWithUnit[]
  versionExplanations: Map<string, AiExplanation>
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
  unitVersions: CodeUnitVersionWithUnit[]
  unitVersionExplanations: Map<string, AiExplanation>
}

// 관제실의 "프롬프트 상세" 큰 화면: RecentTurns(개요 탭 "직전 실행의 과정")에서 고른
// 프롬프트 하나에 대해 바뀐 구조(미니 구조도)와 유닛별 변경사항(diff)을 한 카드에
// 모아 보여준다. feature 요약(explainTurn 캡션)은 RecentTurns 항목 자체에 이미 나와
// 있어 여기서 다시 반복하지 않는다.
// selectedUnitId/onSelectUnit/unitVersions/unitVersionExplanations는 App의 전역
// useUnitTimeline 선택 상태를 그대로 공유한다 — 구조도에서 컴포넌트(유닛)를 클릭하면
// 그 유닛의 전체 버전 이력(코드 타임라인)이 이 프롬프트의 diff와 별개로 아래 펼쳐진다.
export function TurnDetailPanel({
  turn,
  units,
  edges,
  versions,
  versionExplanations,
  selectedUnitId,
  onSelectUnit,
  unitVersions,
  unitVersionExplanations
}: TurnDetailPanelProps) {
  if (!turn) {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-border bg-card p-10 text-center shadow-[0_3px_14px_rgba(42,46,38,.06)]">
        <p className="text-[13px] leading-6 text-muted-foreground">
          아직 표시할 프롬프트가 없어요. 프롬프트를 실행하면 구조도·변경사항이 자동으로 채워져요.
        </p>
      </div>
    )
  }

  const isEmpty = units.length === 0 && versions.length === 0
  // 지금 선택된 유닛이 이 프롬프트에서 실제로 바뀐 유닛일 때만 타임라인을 보여준다 —
  // 다른 프롬프트를 보다가 고른 선택이 남아있을 수 있어(선택 상태는 전역 공유), 이
  // 프롬프트의 구조도에 없는 유닛이면 굳이 안 맞는 타임라인을 보여주지 않는다.
  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_3px_14px_rgba(42,46,38,.06)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <GitBranch size={14} className="text-[#3c7566]" />
        <h4 className="text-[12.5px] font-semibold">바뀐 구조와 변경사항</h4>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {units.length} UNITS · {versions.length} CHANGES
        </span>
      </div>
      {isEmpty ? (
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          이 프롬프트에서 바뀐 코드 유닛이 없어요.
        </p>
      ) : (
        <>
          <StructureOverview
            units={units}
            edges={edges}
            selectedUnitId={selectedUnitId}
            onSelectUnit={onSelectUnit}
            heightClassName="h-[240px]"
          />
          {selectedUnit && (
            <div className="border-t border-border p-3.5">
              <p className="mb-3 text-[11px] font-semibold tracking-[0.04em] text-[#6d7069]">
                {selectedUnit.unit_name} 코드 타임라인
              </p>
              <UnitTimeline versions={unitVersions} explanations={unitVersionExplanations} />
            </div>
          )}
          <div className="max-h-[320px] overflow-y-auto border-t border-border p-3.5">
            <TurnChanges versions={versions} explanations={versionExplanations} />
          </div>
        </>
      )}
    </section>
  )
}
