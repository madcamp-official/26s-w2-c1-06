import { useState } from 'react'
import Markdown from 'react-markdown'
import type { LectureNote, SkillLevel } from '@shared/types'
import { formatTime } from '@shared/format'

interface LectureNotesViewerProps {
  notes: LectureNote[]
  onRegenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
}

const SKILL_LABEL: Record<SkillLevel, string> = {
  beginner: '초급',
  intermediate: '중급',
  advanced: '고급'
}

const ALL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced']

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

export function LectureNotesViewer({ notes, onRegenerate }: LectureNotesViewerProps) {
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  if (notes.length === 0) {
    return (
      <div className="lecture-notes lecture-notes--empty">
        세션이 종료되면 리포트가 자동으로 생성됩니다.
      </div>
    )
  }

  const groups = groupBySession(notes)

  return (
    <div className="lecture-notes">
      {groups.map((group) => {
        const presentLevels = new Set(group.notes.map((note) => note.skill_level))
        return (
          <section key={group.sessionId} className="lecture-note-group">
            <div className="lecture-note-group__header">
              <span className="lecture-note__session">세션 {group.sessionId.slice(0, 8)}</span>
              <div className="lecture-note-group__regen">
                {ALL_LEVELS.filter((level) => !presentLevels.has(level)).map((level) => {
                  const key = `${group.sessionId}:${level}`
                  const pending = pendingKey === key
                  return (
                    <button
                      key={level}
                      type="button"
                      className="lecture-note-group__regen-btn"
                      disabled={pending}
                      title={`${SKILL_LABEL[level]} 해설 모드로 리포트 다시 받기`}
                      onClick={async () => {
                        setPendingKey(key)
                        try {
                          await onRegenerate(group.sessionId, level)
                        } finally {
                          setPendingKey(null)
                        }
                      }}
                    >
                      {pending ? '작성 중…' : `${SKILL_LABEL[level]} 리포트`}
                    </button>
                  )
                })}
              </div>
            </div>
            {group.notes.map((note) => (
              <article key={note.id} className="lecture-note">
                <header className="lecture-note__header">
                  <span className="lecture-note__skill">
                    {SKILL_LABEL[note.skill_level] ?? note.skill_level}
                  </span>
                  <span className="lecture-note__time">{formatTime(note.created_at)}</span>
                </header>
                <div className="lecture-note__body">
                  <Markdown>{note.markdown}</Markdown>
                </div>
              </article>
            ))}
          </section>
        )
      })}
    </div>
  )
}
