import { useMemo, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { AiExplanation, CodeUnit, CodeUnitEdge, CodeUnitVersionWithUnit, StepWithExplanation } from '@shared/types'
import { StepCard } from './StepProgressLog'
import { StructureOverview } from './StructureOverview'
import { ORPHAN_TURN_ID, type TurnListItem } from './TurnList'
import { UnitTimeline } from './UnitTimeline'
import { VersionCard } from './VersionCard'

interface TurnDetailPanelProps {
  turn: TurnListItem | null
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  versions: CodeUnitVersionWithUnit[]
  versionExplanations: Map<string, AiExplanation>
  steps: StepWithExplanation[]
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
  unitVersions: CodeUnitVersionWithUnit[]
  unitVersionExplanations: Map<string, AiExplanation>
}

// 관제실의 "프롬프트 상세" 큰 화면: RecentTurns(개요 탭 "직전 실행의 과정")에서 고른
// 프롬프트 하나에 대해 바뀐 구조(미니 구조도) + 실시간 진행 로그를 한 카드에 모아
// 보여준다. feature 요약(explainTurn 캡션)은 RecentTurns 항목 자체에 이미 나와 있어
// 여기서 다시 반복하지 않는다.
// selectedUnitId/onSelectUnit/unitVersions/unitVersionExplanations는 App의 전역
// useUnitTimeline 선택 상태를 그대로 공유한다 — 구조도에서 컴포넌트(유닛)를 클릭하면
// 그 유닛의 전체 버전 이력(코드 타임라인)이 이 프롬프트의 diff와 별개로 아래 펼쳐진다.
export function TurnDetailPanel({
  turn,
  units,
  edges,
  versions,
  versionExplanations,
  steps,
  selectedUnitId,
  onSelectUnit,
  unitVersions,
  unitVersionExplanations
}: TurnDetailPanelProps) {
  // 예전엔 "실시간 진행 로그"(스텝)와 "변경사항"(코드 유닛)을 완전히 별개의 두 목록으로
  // 보여줬다 — 같은 작업을 두 번 설명하는 것처럼 보여서 헷갈린다는 피드백을 받았다.
  // code_unit_versions.tool_event_id가 어느 스텝 소속인지(step.toolEventIds) 매칭해,
  // "에이전트가 이 스텝에서 무엇을 했고, 그 결과 어떤 코드가 생겼는지"를 하나의
  // 타임라인으로 합친다 — 스텝 카드 아래에 그 스텝에서 나온 코드 유닛 카드가 딸려온다.
  const turnPromptId = turn && turn.turnId !== ORPHAN_TURN_ID ? turn.turnId : null
  const turnSteps = useMemo(
    () => steps.filter((step) => step.promptId === turnPromptId),
    [steps, turnPromptId]
  )

  const { versionsByStepId, unassignedVersions } = useMemo(() => {
    const stepIdByToolEventId = new Map<string, string>()
    for (const step of turnSteps) {
      for (const toolEventId of step.toolEventIds) stepIdByToolEventId.set(toolEventId, step.stepId)
    }
    const byStepId = new Map<string, CodeUnitVersionWithUnit[]>()
    const unassigned: CodeUnitVersionWithUnit[] = []
    for (const version of versions) {
      const stepId = version.tool_event_id ? stepIdByToolEventId.get(version.tool_event_id) : undefined
      if (!stepId) {
        unassigned.push(version)
        continue
      }
      const bucket = byStepId.get(stepId)
      if (bucket) bucket.push(version)
      else byStepId.set(stepId, [version])
    }
    return { versionsByStepId: byStepId, unassignedVersions: unassigned }
  }, [turnSteps, versions])

  // 스텝마다 딸린 코드 유닛 카드 목록을 접었다 폈다 할 수 있게 한다 — 기본은 접어둬서
  // (스텝 요약만 죽 훑어보는 용도) 타임라인이 코드 카드로 도배되지 않게 하고, 궁금한
  // 스텝만 펼쳐서 그 안의 코드를 본다.
  const [nestedOpen, setNestedOpen] = useState<Record<string, boolean>>({})

  if (!turn) {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-border bg-card p-10 text-center shadow-[0_3px_14px_rgba(42,46,38,.06)]">
        <p className="text-[13px] leading-6 text-muted-foreground">
          아직 표시할 프롬프트가 없어요. 프롬프트를 실행하면 구조도·변경사항이 자동으로 채워져요.
        </p>
      </div>
    )
  }

  const isEmpty = units.length === 0 && versions.length === 0 && turnSteps.length === 0
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
          {units.length > 0 && (
            <StructureOverview
              units={units}
              edges={edges}
              selectedUnitId={selectedUnitId}
              onSelectUnit={onSelectUnit}
              heightClassName="h-[240px]"
            />
          )}
          {selectedUnit && (
            <div className="border-t border-border p-3.5">
              <p className="mb-3 text-[11px] font-semibold tracking-[0.04em] text-[#6d7069]">
                {selectedUnit.unit_name} 코드 타임라인
              </p>
              <UnitTimeline versions={unitVersions} explanations={unitVersionExplanations} />
            </div>
          )}
          {(turnSteps.length > 0 || unassignedVersions.length > 0) && (
            <div className="max-h-[640px] overflow-y-auto border-t border-border p-3.5">
              <p className="mb-2.5 text-[11px] font-semibold tracking-[0.04em] text-[#6d7069]">
                실시간 진행 로그
              </p>
              <ol className="space-y-2.5">
                {turnSteps.map((step) => {
                  const nested = versionsByStepId.get(step.stepId) ?? []
                  const isOpen = nestedOpen[step.stepId] ?? false
                  return (
                    <li key={step.stepId}>
                      <StepCard step={step} />
                      {nested.length > 0 && (
                        <div className="ml-6 mt-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setNestedOpen((prev) => ({ ...prev, [step.stepId]: !isOpen }))
                            }
                            className="font-mono text-[10px] tracking-[0.08em] text-[#6d7069] transition hover:text-[#285c52]"
                          >
                            {isOpen ? '▴ 코드 유닛 접기' : `▾ 코드 유닛 ${nested.length}개 보기`}
                          </button>
                          {isOpen && (
                            <div className="mt-1.5 space-y-1.5 border-l-2 border-[#e6e4dd] pl-3">
                              {nested.map((version) => (
                                <VersionCard
                                  key={version.id}
                                  version={version}
                                  explanation={versionExplanations.get(version.id)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
                {unassignedVersions.length > 0 && (
                  <li>
                    {turnSteps.length > 0 && (
                      <p className="mb-1.5 text-[11px] font-semibold text-[#6d7069]">기타 변경사항</p>
                    )}
                    <div className="space-y-1.5">
                      {unassignedVersions.map((version) => (
                        <VersionCard
                          key={version.id}
                          version={version}
                          explanation={versionExplanations.get(version.id)}
                        />
                      ))}
                    </div>
                  </li>
                )}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  )
}
