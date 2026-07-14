import { useState } from 'react'
import { FolderTree, GitBranch, GraduationCap, Lightbulb, Loader2 } from 'lucide-react'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  TurnNarrativeBubble
} from '@shared/types'
import { parseConceptTags, parseTurnNarrative } from '@shared/format'
import { StructureOverview } from './StructureOverview'
import { TurnChanges } from './TurnChanges'
import type { TurnListItem } from './TurnList'

interface TurnDetailPanelProps {
  turn: TurnListItem | null
  explanation: AiExplanation | undefined
  /** 프로젝트 전체 구조도 — 이번 턴에 바뀐 유닛은 highlightUnitIds로 강조된다. */
  units: CodeUnit[]
  edges: CodeUnitEdge[]
  highlightUnitIds: Set<string>
  versions: CodeUnitVersionWithUnit[]
  versionExplanations: Map<string, AiExplanation>
}

// 사수가 슬랙에서 말풍선을 보내듯, 턴 하나를 서술식으로 풀어주는 화면.
// 강사가 칠판의 구조도를 짚어가며 설명하는 흐름을 그대로 따른다:
// (1) 전체 구조도(이번 턴이 만진 곳 하이라이트) 옆에 (2) overview→change→concept
// 말풍선 해설, 그리고 diff 나열은 맨 아래 "코드 변경 상세"로 접어서 보조로만 남긴다.
export function TurnDetailPanel({
  turn,
  explanation,
  units,
  edges,
  highlightUnitIds,
  versions,
  versionExplanations
}: TurnDetailPanelProps) {
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const narrative = explanation ? parseTurnNarrative(explanation.content) : null
  const tags = explanation ? parseConceptTags(explanation.concept_tags) : []

  if (!turn) {
    return (
      <div className="grid h-full place-items-center rounded-xl border border-border bg-card p-10 text-center shadow-[0_18px_45px_rgba(0,0,0,.14)]">
        <p className="text-[13px] leading-6 text-muted-foreground">
          왼쪽 목록에서 턴을 선택하면 사수의 해설과 구조도를 크게 볼 수 있어요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── 턴 헤더: 요청 + 한 줄 요약 ─────────────────────────── */}
      <section className="rounded-xl border border-[#326055] bg-[#11231f] px-5 py-4 shadow-[0_18px_45px_rgba(0,0,0,.14)]">
        <div className="flex flex-wrap items-baseline gap-2">
          {turn.turnIndex !== null && (
            <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-[#7fa593]">
              TURN {turn.turnIndex + 1}
            </span>
          )}
          <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-[-0.02em] text-[#e9f8ef]">
            {turn.userText ?? '연결된 요청 없음 (수동 수정 등)'}
          </h3>
        </div>
        {narrative?.summary && (
          <p className="mt-1.5 text-[12px] text-[#8fb3a4]">{narrative.summary}</p>
        )}
        {tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-[#31594b] bg-[#162b25] px-2 py-1 font-mono text-[10px] text-[#a9d3bd]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── 구조도(전체 + 하이라이트) + 사수의 말풍선 해설 ───────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_45px_rgba(0,0,0,.14)]">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <FolderTree size={14} className="text-[#8cc8e6]" />
            <h4 className="text-[12.5px] font-semibold">전체 구조도</h4>
            <span className="ml-auto font-mono text-[10px] text-[#75909a]">
              {highlightUnitIds.size > 0
                ? `이번 턴에서 ${highlightUnitIds.size}곳 변경`
                : `${units.length} UNITS`}
            </span>
          </div>
          <StructureOverview
            units={units}
            edges={edges}
            selectedUnitId={selectedUnitId}
            onSelectUnit={setSelectedUnitId}
            highlightUnitIds={highlightUnitIds}
            heightClassName="h-[420px]"
            emptyMessage="아직 추적된 코드 유닛이 없어요."
          />
        </section>

        <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_45px_rgba(0,0,0,.14)]">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <GraduationCap size={15} className="text-[#94d6b7]" />
            <h4 className="text-[12.5px] font-semibold">사수의 해설</h4>
            <span className="ml-auto font-mono text-[10px] text-[#75909a]">
              {narrative ? `${narrative.bubbles.length} MESSAGES` : ''}
            </span>
          </div>
          <div className="max-h-[420px] flex-1 space-y-3 overflow-y-auto p-4">
            {narrative && narrative.bubbles.length > 0 ? (
              narrative.bubbles.map((bubble, i) => <NarrativeBubble key={i} bubble={bubble} />)
            ) : (
              <div className="flex items-center gap-2 py-8 text-center text-[12.5px] text-muted-foreground">
                <Loader2 size={13} className="animate-spin text-[#8fc9ae]" />
                {turn.isLastTurn
                  ? '진행 중… 이 턴이 끝나면 사수가 구조도를 짚어가며 설명해줘요.'
                  : '해설 생성 중…'}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── 코드 변경 상세(diff) — 보조 정보라 접어둔다 ─────────── */}
      <details className="group overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_45px_rgba(0,0,0,.14)]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 transition hover:bg-[#121d25] [&::-webkit-details-marker]:hidden">
          <GitBranch size={14} className="text-[#94d6b7]" />
          <h4 className="text-[12.5px] font-semibold">코드 변경 상세</h4>
          <span className="ml-auto font-mono text-[10px] text-[#75909a]">
            {versions.length} CHANGES · 펼쳐서 diff 보기
          </span>
        </summary>
        <div className="max-h-[420px] overflow-y-auto border-t border-border p-3.5">
          <TurnChanges versions={versions} explanations={versionExplanations} />
        </div>
      </details>
    </div>
  )
}

// 말풍선 하나: 사수 아바타 + 슬랙 스타일 버블. concept(알아야 할 개념)은
// 전구 아이콘과 노란 계열로 구분해 "이건 챙겨가"라는 느낌을 준다.
function NarrativeBubble({ bubble }: { bubble: TurnNarrativeBubble }) {
  const isConcept = bubble.kind === 'concept'

  return (
    <div className="flex items-start gap-2.5">
      <div
        className={`grid size-7 shrink-0 place-items-center rounded-full ${
          isConcept ? 'bg-[#3a3320] text-[#e7c76f]' : 'bg-[#20323a] text-[#a5e7cb]'
        }`}
      >
        {isConcept ? <Lightbulb size={14} /> : <GraduationCap size={14} />}
      </div>
      <div
        className={`min-w-0 max-w-[92%] rounded-2xl rounded-tl-md border px-3.5 py-2.5 ${
          isConcept ? 'border-[#4a3f22] bg-[#221d10]' : 'border-[#24404d] bg-[#12222b]'
        }`}
      >
        {bubble.title && (
          <p
            className={`mb-1 text-[11px] font-semibold ${
              isConcept ? 'text-[#e7c76f]' : 'text-[#8ed7ba]'
            }`}
          >
            {bubble.title}
          </p>
        )}
        <p className="whitespace-pre-wrap text-[13px] leading-6 text-[#c9d9e0]">{bubble.text}</p>
      </div>
    </div>
  )
}
