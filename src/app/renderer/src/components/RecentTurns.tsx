import { CheckCircle2, ChevronRight, FolderKanban } from 'lucide-react'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  Prompt,
  StepWithExplanation,
  ToolEvent
} from '@shared/types'
import { formatRelativeTime } from '@shared/format'
import { buildTurnList, ORPHAN_TURN_ID } from './TurnList'
import { TurnDetailPanel } from './TurnDetailPanel'

interface RecentTurnsProps {
  prompts: Prompt[]
  events: ToolEvent[]
  explanations: Map<string, AiExplanation>
  loading: boolean
  expandedTurnId: string | null
  onToggleTurn: (turnId: string) => void
  detailUnits: CodeUnit[]
  detailEdges: CodeUnitEdge[]
  detailVersions: CodeUnitVersionWithUnit[]
  detailVersionExplanations: Map<string, AiExplanation>
  steps: StepWithExplanation[]
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
  unitVersions: CodeUnitVersionWithUnit[]
  unitVersionExplanations: Map<string, AiExplanation>
  onViewAll: () => void
}

// 개요 탭의 "직전 실행의 과정": "직전"이라는 이름 그대로 이미 끝난 실행만 다룬다 —
// 프롬프트(실행 1회)마다 caption-worker.ts가 이미 만들어 둔 explainTurn() 요약
// (explanation.content)이 준비된 것만 보여주고, 아직 실행 중이라 요약이 없는 마지막
// 프롬프트는 요약이 생기기 전까지 이 목록에 나타나지 않는다(진행 중 상태는 "현재
// 프롬프트" 카드가 이미 보여주므로 여기서 반복하지 않음). 실행한 프롬프트(제목)와 그
// 프롬프트로 구현된 기능(AI 요약)을 한 항목에 담는다 — 새 AI 호출은 없음, 기존
// 캡션을 그대로 표시. 항목을 펼치면 기존 TurnDetailPanel(미니 구조도 + diff)을 그대로
// 재사용해 보여준다 — 이 펼침 상태는 활동 탭의 TurnDetailPanel과 동일한 값을
// 공유한다(App.tsx의 selectedTurnId).
export function RecentTurns({
  prompts,
  events,
  explanations,
  loading,
  expandedTurnId,
  onToggleTurn,
  detailUnits,
  detailEdges,
  detailVersions,
  detailVersionExplanations,
  steps,
  selectedUnitId,
  onSelectUnit,
  unitVersions,
  unitVersionExplanations,
  onViewAll
}: RecentTurnsProps) {
  // 완료(요약 존재)된 턴 또는 수동 수정 묶음만 남긴다 — 아직 요약이 없는 진행 중인
  // 턴은 완료되어 캡션이 생길 때까지 목록에서 빠진다.
  const items = [...buildTurnList(prompts, events)]
    .reverse()
    .filter((item) => item.turnId === ORPHAN_TURN_ID || explanations.has(item.turnId))

  const promptTimeById = new Map(prompts.map((p) => [p.id, p.created_at]))
  const latestEventTime = events.reduce<string | null>((latest, event) => {
    if (!event.created_at) return latest
    if (!latest || event.created_at > latest) return event.created_at
    return latest
  }, null)

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.025em]">직전 실행의 과정</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            프롬프트를 실행할 때마다 AI가 이번에 구현된 기능을 한 번에 정리해 남겨요.
          </p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="shrink-0 text-[12px] font-medium text-[#285c52] hover:underline"
        >
          전체 보기
        </button>
      </div>

      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-5">
        {loading ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">세션을 불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-[13px] leading-6 text-muted-foreground">
            아직 완료된 실행이 없어요. 진행 중인 프롬프트가 끝나면 여기에 정리돼요.
          </p>
        ) : (
          items.map((item) => {
            const isOrphan = item.turnId === ORPHAN_TURN_ID
            const explanation = isOrphan ? undefined : explanations.get(item.turnId)
            const expanded = expandedTurnId === item.turnId
            const time = formatRelativeTime(isOrphan ? latestEventTime : (promptTimeById.get(item.turnId) ?? null))

            const Icon = isOrphan ? FolderKanban : CheckCircle2
            const title = isOrphan ? '수동으로 수정된 파일들' : (item.userText ?? '연결된 요청 없음')
            const desc = isOrphan
              ? `프롬프트 실행 없이 직접 바뀐 파일 ${item.eventCount}개예요.`
              : (explanation?.content ?? '요약 생성 중…')

            return (
              <div key={item.turnId}>
                <button
                  type="button"
                  onClick={() => onToggleTurn(item.turnId)}
                  className="group flex w-full items-start gap-4 py-5 text-left"
                >
                  <div
                    className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${
                      expanded ? 'bg-[#e4f0eb] text-[#245248]' : 'bg-[#eef5f2] text-[#3c7c6d]'
                    }`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-[13px] font-semibold group-hover:text-[#285c52]">
                        {title}
                      </h3>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{time}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{desc}</p>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`mt-1.5 shrink-0 text-[#9a9a92] transition-transform ${
                      expanded ? 'rotate-90' : ''
                    }`}
                  />
                </button>

                {expanded && !isOrphan && (
                  <div className="pb-5">
                    <TurnDetailPanel
                      turn={item}
                      units={detailUnits}
                      edges={detailEdges}
                      versions={detailVersions}
                      versionExplanations={detailVersionExplanations}
                      steps={steps}
                      selectedUnitId={selectedUnitId}
                      onSelectUnit={onSelectUnit}
                      unitVersions={unitVersions}
                      unitVersionExplanations={unitVersionExplanations}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
