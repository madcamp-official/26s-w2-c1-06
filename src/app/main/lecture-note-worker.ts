import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider } from '@ai/types'
import type { Session, SkillLevel } from '@shared/types'
import { createSessionTraceLoader } from './session-trace'

const POLL_INTERVAL_MS = 3000
// 같은 세션 합성이 계속 실패하면(429 쿼터 소진 등) 3초마다 무한 재시도하며 API를
// 계속 두드린다 — 실패한 세션은 이 시간 동안 건너뛰고 다른 세션을 먼저 처리한다.
const FAILURE_COOLDOWN_MS = 60_000

// SPEC 4.3.2: Stop 훅 → 파이프라인이 sessions.ended_at 기록 → 여기서 그 전이를
// 감지해 강의노트를 합성한다. "아직 노트가 없는, 이미 종료된 세션"을 찾는
// 방식으로 구현해 NULL→NOT NULL 전이를 직접 추적할 필요가 없다 (lecture_notes
// 존재 여부 자체가 "이미 처리했다"는 표식). 세션당 최초 1회만 자동 생성되고,
// 다른 난이도로 다시 보고 싶을 때의 온디맨드 재생성은 index.ts의
// db:regenerateLectureNote IPC로 처리한다 (동일한 세션 트레이스 로더 재사용).
// onNoteSaved: 강의노트를 저장할 때마다 호출된다 — Electron main이 이 콜백에서
// 렌더러로 'data-changed'(kind: 'lecture-note')를 push해 다음 3초 폴링을 기다리지
// 않고 즉시 반영되게 한다(SPEC 4.6).
export function startLectureNoteWorker(
  db: Database.Database,
  aiProvider: AIProvider,
  onNoteSaved?: () => void
): () => void {
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
  const retryAfterBySession = new Map<string, number>()

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const endedSessions = getEndedSessionsWithoutNotes.all() as Session[]

      const skillLevel = ((getSkillLevel.get() as { value: string } | undefined)?.value ??
        'intermediate') as SkillLevel

      // 세션당 큰 컨텍스트 하나를 통째로 던지는 무거운 호출이므로, 틱당 1개만 처리.
      // 직전에 실패한 세션(쿨다운 중)은 건너뛰어 다른 세션까지 막히지 않게 한다.
      const session = endedSessions.find((s) => (retryAfterBySession.get(s.id) ?? 0) <= Date.now())
      if (!session) return

      try {
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
        onNoteSaved?.()
      } catch (error) {
        retryAfterBySession.set(session.id, Date.now() + FAILURE_COOLDOWN_MS)
        throw error
      }
    } catch (error) {
      console.error('[lecture-note-worker] failed to synthesize lecture note:', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS)
  tick()

  return () => clearInterval(timer)
}
