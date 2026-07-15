import { useState } from 'react'
import Markdown from 'react-markdown'
import { BookOpen, Play, RefreshCw, Sparkles } from 'lucide-react'
import type { LectureNote, SkillLevel } from '@shared/types'
import { formatTime } from '@shared/format'
import { SKILL_LEVEL_LABEL, SKILL_LEVEL_ORDER } from '@shared/skillProfile'

interface LectureNotesViewerProps {
  notes: LectureNote[]
  onRegenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
  // "오늘은 여기까지"로 방금 끝낸 세션의 id — 있으면 그 세션의 요약을 맨 위에 강조
  // 배너로 보여주고 "계속하기"를 띄운다. 노트 탭에 그냥 들어온 경우(이 값이 null)엔
  // 기존과 동일하게 세션별 목록만 보여준다.
  justCompletedSessionId?: string | null
  onContinue?: () => Promise<void>
  continuePending?: boolean
}

const SKILL_LABEL = SKILL_LEVEL_LABEL
const ALL_LEVELS = SKILL_LEVEL_ORDER

interface SessionGroup {
  sessionId: string
  notes: LectureNote[]
}

function groupBySession(notes: LectureNote[]): SessionGroup[] {
  const order: string[] = []
  const bySession = new Map<string, LectureNote[]>()

  for (const note of notes) {
    if (!bySession.has(note.session_id)) {
      order.push(note.session_id)
      bySession.set(note.session_id, [])
    }
    bySession.get(note.session_id)!.push(note)
  }

  return order.map((sessionId) => ({ sessionId, notes: bySession.get(sessionId)! }))
}

function RegenerateButtons({
  group,
  onRegenerate
}: {
  group: SessionGroup
  onRegenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
}) {
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const presentLevels = new Set(group.notes.map((note) => note.skill_level))

  return (
    <div className="ml-auto flex gap-1.5">
      {ALL_LEVELS.filter((level) => !presentLevels.has(level)).map((level) => {
        const key = `${group.sessionId}:${level}`
        const pending = pendingKey === key
        return (
          <button
            key={level}
            type="button"
            disabled={pending}
            onClick={async () => {
              setPendingKey(key)
              try {
                await onRegenerate(group.sessionId, level)
              } finally {
                setPendingKey(null)
              }
            }}
            className="flex items-center gap-1.5 rounded-md border border-border bg-[#f6f5f1] px-2.5 py-1.5 text-[11px] text-[#6d7069] transition hover:bg-[#f1f0eb] hover:text-[#245248] disabled:opacity-50"
          >
            <RefreshCw size={11} className={pending ? 'animate-spin' : undefined} />
            {pending ? '생성 중…' : `${SKILL_LABEL[level]}로도 보기`}
          </button>
        )
      })}
    </div>
  )
}

function NoteGroupSection({
  group,
  onRegenerate,
  highlighted
}: {
  group: SessionGroup
  onRegenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
  highlighted?: boolean
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border bg-card shadow-[0_3px_14px_rgba(42,46,38,.06)] ${
        highlighted ? 'border-[#4f9c84]' : 'border-border'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
        {highlighted ? (
          <span className="flex items-center gap-1.5 rounded-md bg-[#eaf4ef] px-2 py-0.5 text-[11px] font-semibold text-[#245248]">
            <Sparkles size={12} />
            오늘 세션 요약
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#6d7069]">
            SESSION / {group.sessionId.slice(0, 8)}
          </span>
        )}
        <RegenerateButtons group={group} onRegenerate={onRegenerate} />
      </div>

      <div className="divide-y divide-border">
        {group.notes.map((note) => (
          <article key={note.id} className="px-5 py-4">
            <header className="mb-3 flex items-center gap-2">
              <span className="rounded bg-[#eaf4ef] px-2 py-0.5 text-[11px] font-semibold text-[#245248]">
                {SKILL_LABEL[note.skill_level] ?? note.skill_level}
              </span>
              <span className="font-mono text-[10px] text-[#9a9a92]">{formatTime(note.created_at)}</span>
            </header>
            <div className="markdown-body">
              <Markdown>{note.markdown}</Markdown>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ContinueButton({
  pending,
  onContinue
}: {
  pending: boolean
  onContinue: () => Promise<void>
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onContinue}
      className="flex shrink-0 items-center gap-2 rounded-lg bg-[#285c52] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-[#1f4a41] disabled:opacity-50"
    >
      <Play size={15} />
      {pending ? '시작하는 중…' : '계속하기'}
    </button>
  )
}

// SPEC 4.5 강의노트 뷰어: lecture_notes를 세션별로 묶어 표시, Markdown 렌더.
// SPEC 5.1: "다른 난이도로 다시 보고 싶으면 뷰어에서 재생성 요청(온디맨드)" —
// 세션마다 아직 없는 난이도를 생성 요청할 수 있는 버튼을 둔다.
// 세션이 아직 끝나지 않았으면(ended_at 미기록) 비어있는 게 정상 상태.
export function LectureNotesViewer({
  notes,
  onRegenerate,
  justCompletedSessionId,
  onContinue,
  continuePending = false
}: LectureNotesViewerProps) {
  const groups = groupBySession(notes)
  const highlightGroup = justCompletedSessionId
    ? (groups.find((g) => g.sessionId === justCompletedSessionId) ?? null)
    : null
  const restGroups = justCompletedSessionId
    ? groups.filter((g) => g.sessionId !== justCompletedSessionId)
    : groups

  // "오늘은 여기까지"로 막 넘어온 경우: 강의노트는 세션 종료 후 워커가 몇 초 뒤
  // 비동기로 만들기 때문에(useLectureNotes가 'lecture-note' push로 자동 반영), 클릭
  // 직후엔 아직 없을 수 있다 — 그 사이엔 "만드는 중" 배너를 보여준다(끝날 때까지
  // 기다리는 동안에도 계속하기는 바로 누를 수 있다).
  const completedBanner = justCompletedSessionId && (
    <section className="overflow-hidden rounded-xl border border-[#4f9c84] bg-card shadow-[0_3px_14px_rgba(42,46,38,.06)]">
      {highlightGroup ? (
        <NoteGroupSection group={highlightGroup} onRegenerate={onRegenerate} highlighted />
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="flex items-center gap-1.5 rounded-md bg-[#eaf4ef] px-2 py-0.5 text-[11px] font-semibold text-[#245248]">
            <Sparkles size={12} />
            오늘 세션 요약
          </span>
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <RefreshCw size={13} className="animate-spin text-[#4f9c84]" />
            방금 끝난 세션을 정리하고 있어요…
          </span>
        </div>
      )}
      {onContinue && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-[#f6f5f1] px-5 py-3.5">
          <p className="text-[12px] text-muted-foreground">더 진행하고 싶으면 이어서 관찰을 시작할 수 있어요.</p>
          <ContinueButton pending={continuePending} onContinue={onContinue} />
        </div>
      )}
    </section>
  )

  if (notes.length === 0 && !justCompletedSessionId) {
    return (
      <div className="grid place-items-center rounded-xl border border-border bg-card px-6 py-16 text-center">
        <BookOpen size={28} className="mb-3 text-[#9a9a92]" />
        <p className="max-w-[420px] text-[13px] leading-6 text-muted-foreground">
          아직 종료된 세션이 없습니다. 세션이 끝나면(완료 버튼 또는 Stop 훅 감지) 자동으로
          강의노트가 생성됩니다.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {completedBanner}
      {restGroups.map((group) => (
        <NoteGroupSection key={group.sessionId} group={group} onRegenerate={onRegenerate} />
      ))}
    </div>
  )
}
