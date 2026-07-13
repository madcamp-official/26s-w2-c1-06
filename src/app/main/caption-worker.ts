import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider, StepInput } from '@ai/types'
import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import { groupIntoSteps } from '@shared/steps'

// 학습 파이프라인 4단계: 낱개 tool_event가 아니라 "스텝"(에이전트 의도 1개 +
// 그 안의 액션들)을 요약한다. 한 스텝을 배치로 여러 개 처리하되 틱당 provider
// 호출은 1회로 제한(RPM 방어). 개별 이벤트 캡션 자동생성은 하지 않는다 —
// 이벤트 행은 원시 데이터(도구/파일/상태/에러)로 드릴다운을 제공하므로 AI 불필요.
const STEP_BATCH_SIZE = 3
const VERSION_BATCH_SIZE = 5
const POLL_INTERVAL_MS = 5000

interface CaptionRow {
  targetType: 'step' | 'code_unit_version'
  targetId: string
  caption: string
  conceptTags: string[]
}

export function startCaptionWorker(db: Database.Database, aiProvider: AIProvider): () => void {
  const getLatestSession = db.prepare(`
    SELECT id, ended_at FROM sessions ORDER BY started_at DESC LIMIT 1
  `)

  const getSkillLevel = db.prepare(`
    SELECT value FROM user_settings WHERE key = 'skill_level'
  `)

  const getEventsBySession = db.prepare(`
    SELECT * FROM tool_events WHERE session_id = @session_id ORDER BY created_at ASC, rowid ASC
  `)

  const getNotesBySession = db.prepare(`
    SELECT * FROM assistant_notes WHERE session_id = @session_id ORDER BY created_at ASC, rowid ASC
  `)

  // 이미 스텝 요약이 생성된 target_id(= note.id) 집합. note.id는 세션 무관하게
  // 유일하므로 세션 조인 없이 skill_level만으로 조회해도 안전하다.
  const getCaptionedStepIds = db.prepare(`
    SELECT target_id FROM ai_explanations WHERE target_type = 'step' AND skill_level = @skill_level
  `)

  const getUncaptionedVersions = db.prepare(`
    SELECT v.*, u.unit_name, u.unit_type, u.file_path
    FROM code_unit_versions v
    JOIN code_units u ON u.id = v.unit_id
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_explanations ae
      WHERE ae.target_type = 'code_unit_version'
        AND ae.target_id = v.id
        AND ae.skill_level = @skill_level
    )
    ORDER BY v.created_at ASC
    LIMIT ${VERSION_BATCH_SIZE}
  `)

  const upsertExplanation = db.prepare(`
    INSERT INTO ai_explanations (id, target_type, target_id, skill_level, content, concept_tags, created_at)
    VALUES (@id, @target_type, @target_id, @skill_level, @content, @concept_tags, @created_at)
    ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
      content = excluded.content,
      concept_tags = excluded.concept_tags,
      created_at = excluded.created_at
  `)

  const saveCaptions = db.transaction((rows: CaptionRow[], skillLevel: SkillLevel) => {
    const now = new Date().toISOString()
    for (const row of rows) {
      upsertExplanation.run({
        id: randomUUID(),
        target_type: row.targetType,
        target_id: row.targetId,
        skill_level: skillLevel,
        content: row.caption,
        concept_tags: JSON.stringify(row.conceptTags),
        created_at: now
      })
    }
  })

  let running = false

  const tick = async (): Promise<void> => {
    if (running) return // 이전 틱의 provider 호출이 아직 안 끝났으면 겹쳐 실행하지 않음
    running = true
    try {
      const skillLevel = ((getSkillLevel.get() as { value: string } | undefined)?.value ??
        'intermediate') as SkillLevel

      const session = getLatestSession.get() as { id: string; ended_at: string | null } | undefined

      if (session) {
        const events = getEventsBySession.all({ session_id: session.id }) as ToolEvent[]
        const notes = getNotesBySession.all({ session_id: session.id }) as AssistantNote[]
        const steps = groupIntoSteps(notes, events)

        // 진행 중인(=시간상 마지막) 스텝은 다음 note가 올 때까지 요약을 보류한다
        // — 아직 액션이 더 붙을 수 있어 조기 요약하면 뒷부분이 빠진다(페이싱).
        // 세션이 이미 끝났으면 마지막 스텝도 완결로 본다.
        const sessionEnded = session.ended_at != null
        const inProgress = sessionEnded || steps.length === 0 ? null : steps[steps.length - 1]

        const captioned = new Set(
          (getCaptionedStepIds.all({ skill_level: skillLevel }) as { target_id: string }[]).map(
            (r) => r.target_id
          )
        )

        const eligible = steps
          .filter(
            (step) =>
              step.id !== null &&
              step.note !== null &&
              // 액션이 0개인 스텝(순수 서사/맺음말)은 요약해봤자 note를 되풀이할 뿐 —
              // API 호출을 아끼기 위해 건너뛴다(무료 티어 20/day). note 텍스트가 곧 내용.
              step.events.length > 0 &&
              step !== inProgress &&
              !captioned.has(step.id)
          )
          .slice(0, STEP_BATCH_SIZE)

        if (eligible.length > 0) {
          const stepInputs: StepInput[] = eligible.map((step) => ({
            stepId: step.id!,
            noteText: step.note!.text,
            events: step.events
          }))
          const captions = await aiProvider.explainSteps(stepInputs, skillLevel)
          saveCaptions(
            captions.map((c) => ({
              targetType: 'step' as const,
              targetId: c.stepId,
              caption: c.caption,
              conceptTags: c.conceptTags
            })),
            skillLevel
          )
          return // 틱당 provider 호출 1회 제한 (RPM 방어)
        }
      }

      // 후순위: 코드 유닛 버전 요약(Level 3). 스텝 요약이 밀리지 않을 때만 처리.
      const pendingVersions = getUncaptionedVersions.all({
        skill_level: skillLevel
      }) as CodeUnitVersionWithUnit[]

      if (pendingVersions.length > 0) {
        const captions = await aiProvider.explainUnitVersions(pendingVersions, skillLevel)
        saveCaptions(
          captions.map((c) => ({
            targetType: 'code_unit_version' as const,
            targetId: c.versionId,
            caption: c.caption,
            conceptTags: c.conceptTags
          })),
          skillLevel
        )
      }
    } catch (error) {
      console.error('[caption-worker] failed to generate captions:', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS)
  tick()

  return () => clearInterval(timer)
}
