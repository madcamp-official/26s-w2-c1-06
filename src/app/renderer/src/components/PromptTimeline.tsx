import { useState } from 'react'
import { CheckCircle2, Circle, FolderKanban, Loader2, MoreHorizontal } from 'lucide-react'
import type { LiveStatus } from '@shared/stepProgress'
import { ORPHAN_TURN_ID, type TurnListItem } from './TurnList'

interface PromptTimelineProps {
  items: TurnListItem[]
  selectedTurnId: string | null
  onSelectTurn: (turnId: string) => void
  // 지금 진행 중인(마지막) 프롬프트 노드의 툴팁에 "지금 하는 중" 한 줄을 덧붙인다 —
  // 실시간 진행 로그(step-worker.ts)와 같은 소스, 활동 탭 헤더의 표시와 동일.
  liveStatus?: LiveStatus
}

const MAX_VISIBLE = 10

type Segment = { key: string; kind: 'ellipsis' } | { key: string; kind: 'item'; item: TurnListItem }

// 활동 탭의 "지난 프롬프트" 선택기: 세로 목록 대신 프롬프트 하나하나를 타임라인 위
// 노드로 늘어놓고(왼쪽=과거 → 오른쪽=최신) 클릭해서 고르게 한다. 세션이 길어져
// 노드가 너무 많아지면 앞쪽(오래된) 것들을 "…" 노드 하나로 접어두고, 그 "…"를 클릭하면
// 접어뒀던 프롬프트까지 전부 펼쳐서 같은 줄 위에서 고를 수 있게 한다.
// "수동으로 수정된 파일들"(ORPHAN) 노드는 시간 순서를 갖는 프롬프트가 아니므로
// (buildTurnList가 목록 끝에 붙여주지만) 타임라인 맨 왼쪽에 별개 노드로 떼어 두고,
// 프롬프트 시퀀스와는 점선으로만 잇는다 — 실선 흐름(과거→최신)에 끼어 있으면
// "몇 번째 프롬프트"처럼 읽히는 문제가 있었다.
export function PromptTimeline({
  items,
  selectedTurnId,
  onSelectTurn,
  liveStatus
}: PromptTimelineProps) {
  const [expanded, setExpanded] = useState(false)

  const orphanItem = items.find((item) => item.turnId === ORPHAN_TURN_ID) ?? null
  const promptItems = items.filter((item) => item.turnId !== ORPHAN_TURN_ID)

  if (items.length === 0) {
    // 빈 상태에서도 헤더("PROMPT TIMELINE")와 타임라인 선 자리는 그대로 남겨서, 아래
    // TurnDetailPanel의 빈 메시지와 똑같이 생긴 텅 빈 박스로 보이지 않게 한다 — 이 자리가
    // 곧 타임라인이 될 자리라는 걸 알 수 있어야 한다.
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <p className="text-[10px] font-semibold tracking-[.1em] text-muted-foreground">PROMPT TIMELINE</p>
          <h4 className="mt-0.5 text-[13px] font-semibold text-muted-foreground">
            아직 완료된 프롬프트가 없어요
          </h4>
        </div>
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-[#cfcfc7] text-[#9a9a92]">
            <Circle size={10} />
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      </div>
    )
  }

  // "…" 접기/펼치기는 프롬프트 노드에만 적용한다 — 수동 수정 노드는 개수와 무관하게
  // 항상 왼쪽에 그대로 보인다.
  const truncated = !expanded && promptItems.length > MAX_VISIBLE
  const visibleItems = truncated ? promptItems.slice(promptItems.length - MAX_VISIBLE) : promptItems
  const hiddenCount = promptItems.length - visibleItems.length

  const segments: Segment[] = []
  if (hiddenCount > 0) segments.push({ key: '__ellipsis__', kind: 'ellipsis' })
  for (const item of visibleItems) segments.push({ key: item.turnId, kind: 'item', item })

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold tracking-[.1em] text-muted-foreground">PROMPT TIMELINE</p>
        <span className="shrink-0 text-[10px] text-muted-foreground">{promptItems.length}개 프롬프트</span>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-center">
          {orphanItem && (
            <div className="flex shrink-0 items-center">
              <TimelineNode
                item={orphanItem}
                active={orphanItem.turnId === selectedTurnId}
                liveStatus={liveStatus}
                onSelect={() => onSelectTurn(orphanItem.turnId)}
              />
              {segments.length > 0 && (
                <span className="w-6 shrink-0 border-t border-dashed border-[#c7c6bd]" />
              )}
            </div>
          )}
          {segments.map((segment, index) => (
            <div key={segment.key} className="flex shrink-0 items-center">
              {index > 0 && <span className="h-px w-6 shrink-0 bg-border" />}
              {segment.kind === 'ellipsis' ? (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  title={`이전 프롬프트 ${hiddenCount}개 더 보기`}
                  className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-[#cfcfc7] text-[#6d7069] transition hover:border-[#4f9c84] hover:text-[#285c52]"
                >
                  <MoreHorizontal size={14} />
                </button>
              ) : (
                <TimelineNode
                  item={segment.item}
                  active={segment.item.turnId === selectedTurnId}
                  liveStatus={liveStatus}
                  onSelect={() => onSelectTurn(segment.item.turnId)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TimelineNode({
  item,
  active,
  liveStatus,
  onSelect
}: {
  item: TurnListItem
  active: boolean
  liveStatus: LiveStatus | undefined
  onSelect: () => void
}) {
  const isOrphan = item.turnId === ORPHAN_TURN_ID
  // Stop 훅(턴 종료) 신호(completedAt) 기준으로 진행 중 여부를 판단한다. 한때 여기에
  // liveStatus.idle(step-worker가 세션 전체에서 계산하는 전역 "지금 활동 없음" 신호)도
  // 같이 썼는데, 이건 가장 최근 스텝 하나만 보고 판단해서 새 턴이 막 시작해 이 턴의
  // 스텝이 아직 하나도 없는 순간엔 "직전 턴 마지막 스텝이 idle"이라는 이유로 이 새 턴을
  // 잘못 "완료"로 표시했다(체크 아이콘이 시작하자마자 잠깐 떴다가 스피너로 바뀜). Stop
  // 훅이 새 세션에서도 안정적으로 붙게 된 뒤로는(파이프라인 attachTo 수정 참고) 이 폴백이
  // 굳이 없어도 completedAt이 충분히 빨리 채워진다.
  const inProgress = item.isLastTurn && !item.completedAt && !isOrphan
  const Icon = isOrphan ? FolderKanban : inProgress ? Loader2 : CheckCircle2
  const baseLabel = isOrphan
    ? '수동으로 수정된 파일들'
    : `${item.turnIndex !== null ? `프롬프트 ${item.turnIndex + 1}: ` : ''}${item.userText ?? '연결된 요청 없음'}`
  const label =
    inProgress && liveStatus && !liveStatus.idle && liveStatus.text
      ? `${baseLabel} — 지금: ${liveStatus.text}`
      : baseLabel

  return (
    <button
      type="button"
      onClick={onSelect}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid size-7 shrink-0 place-items-center rounded-full border-2 transition ${
        active
          ? 'border-[#285c52] bg-[#e4f0eb] text-[#245248]'
          : isOrphan
            ? // 프롬프트 시퀀스와 별개인 노드임이 색으로도 드러나게 초록 대신 중립 톤을 쓴다.
              'border-transparent bg-[#f1f0eb] text-[#8a8b83] hover:border-[#cfcfc7]'
            : 'border-transparent bg-[#eef5f2] text-[#3c7c6d] hover:border-[#b8d9ce]'
      }`}
    >
      <Icon size={13} className={inProgress ? 'animate-spin' : undefined} />
    </button>
  )
}
