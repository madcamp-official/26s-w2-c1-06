import { useState } from 'react'
import Markdown from 'react-markdown'
import { BookOpen, RefreshCw } from 'lucide-react'
import type { LectureNote, SkillLevel } from '@shared/types'
import { formatTime } from '@shared/format'
import { SKILL_LEVEL_LABEL, SKILL_LEVEL_ORDER } from '@shared/skillProfile'

interface LectureNotesViewerProps {
  notes: LectureNote[]
  onRegenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
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

// SPEC 4.5 강의노트 뷰어: lecture_notes를 세션별로 묶어 표시, Markdown 렌더.
// SPEC 5.1: "다른 난이도로 다시 보고 싶으면 뷰어에서 재생성 요청(온디맨드)" —
// 세션마다 아직 없는 난이도를 생성 요청할 수 있는 버튼을 둔다.
// 세션이 아직 끝나지 않았으면(ended_at 미기록) 비어있는 게 정상 상태.
export function LectureNotesViewer({ notes, onRegenerate }: LectureNotesViewerProps) {
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  if (notes.length === 0) {
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

  const groups = groupBySession(notes)

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const presentLevels = new Set(group.notes.map((note) => note.skill_level))
        return (
          <section
            key={group.sessionId}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_3px_14px_rgba(42,46,38,.06)]"
          >
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#6d7069]">
                SESSION / {group.sessionId.slice(0, 8)}
              </span>
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
            </div>

            <div className="divide-y divide-border">
              {group.notes.map((note) => (
                <article key={note.id} className="px-5 py-4">
                  <header className="mb-3 flex items-center gap-2">
                    <span className="rounded bg-[#eaf4ef] px-2 py-0.5 text-[11px] font-semibold text-[#245248]">
                      {SKILL_LABEL[note.skill_level] ?? note.skill_level}
                    </span>
                    <span className="font-mono text-[10px] text-[#9a9a92]">
                      {formatTime(note.created_at)}
                    </span>
                  </header>
                  <div className="markdown-body">
                    <Markdown>{note.markdown}</Markdown>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
