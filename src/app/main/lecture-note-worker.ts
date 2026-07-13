import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider } from '@ai/types'
import type { Session, SkillLevel } from '@shared/types'
import { createSessionTraceLoader } from './session-trace'

const POLL_INTERVAL_MS = 3000
const GEMINI_BACKOFF_MS = 60_000

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: number }).status
  if (status === 429) return true
  const message = String((error as { message?: string }).message ?? error)
  return message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')
}

// SPEC 4.3.2: Stop 훅 → 파이프라인이 sessions.ended_at 기록 → 여기서 그 전이를
// 감지해 강의노트를 합성한다. "아직 노트가 없는, 이미 종료된 세션"을 찾는
// 방식으로 구현해 NULL→NOT NULL 전이를 직접 추적할 필요가 없다 (lecture_notes
// 존재 여부 자체가 "이미 처리했다"는 표식). 세션당 최초 1회만 자동 생성되고,
// 다른 난이도로 다시 보고 싶을 때의 온디맨드 재생성은 index.ts의
// db:regenerateLectureNote IPC로 처리한다 (동일한 세션 트레이스 로더 재사용).
export function startLectureNoteWorker(db: Database.Database, aiProvider: AIProvider): () => void {
  const getEndedSessionsWithoutNotes = db.prepare(`
    SELECT s.* FROM sessions s
    WHERE s.ended_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM lecture_notes ln WHERE ln.session_id = s.id)
  `)

  const getSkillLevel = db.prepare(`
    SELECT value FROM user_settings WHERE key = 'skill_level'
  `)

  const loadSessionTrace = createSessionTraceLoader(db)

  const insertLectureNote = db.prepare(`
    INSERT INTO lecture_notes (id, session_id, markdown, skill_level, created_at)
    VALUES (@id, @session_id, @markdown, @skill_level, @created_at)
  `)

  let running = false
  let geminiCooldownUntil = 0

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      if (Date.now() < geminiCooldownUntil) return

      const endedSessions = getEndedSessionsWithoutNotes.all() as Session[]
      if (endedSessions.length === 0) return

      const skillLevel = ((getSkillLevel.get() as { value: string } | undefined)?.value ??
        'intermediate') as SkillLevel

      const session = endedSessions[0]
      const trace = loadSessionTrace(session.id)
      if (!trace) return

      const markdown = await aiProvider.synthesizeLectureNote(trace, skillLevel)

      insertLectureNote.run({
        id: randomUUID(),
        session_id: session.id,
        markdown,
        skill_level: skillLevel,
        created_at: new Date().toISOString()
      })
    } catch (error) {
      console.error('[lecture-note-worker] failed to synthesize lecture note:', error)
      if (isRateLimitError(error)) {
        geminiCooldownUntil = Date.now() + GEMINI_BACKOFF_MS
        console.warn(
          `[lecture-note-worker] Gemini rate-limited — backing off ${GEMINI_BACKOFF_MS / 1000}s`
        )
      }
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS)
  tick()

  return () => clearInterval(timer)
}
