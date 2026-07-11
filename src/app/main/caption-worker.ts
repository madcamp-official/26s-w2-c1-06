import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider } from '@ai/types'
import type { CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'

const BATCH_SIZE = 5
// SPEC 4.3.1: 3~5초 배칭. 틱당 provider 호출을 최대 1회로 제한하므로
// 실제 Gemini 사용 시 워스트케이스 12 RPM — 무료 티어(10~15 RPM) 안쪽.
const POLL_INTERVAL_MS = 5000

interface CaptionRow {
  targetType: 'tool_event' | 'code_unit_version'
  targetId: string
  caption: string
  conceptTags: string[]
}

// 아직 팀원의 실시간 파이프라인이 없어 tool_events는 폴링으로 들어오므로,
// 이 워커도 같은 폴링 주기 자체를 배칭 윈도우로 사용한다 (한 틱 = 최대 5개).
// 캡션은 (target_type, target_id, skill_level) 단위로 캐시되므로, 사용자가
// 난이도를 바꾸면 그 난이도로 아직 캡션 없는 대상만 자연스럽게 다시 채워진다.
// 우선순위: 실시간성이 중요한 tool_event 캡션 먼저, 남는 틱에 유닛 버전 요약.
export function startCaptionWorker(db: Database.Database, aiProvider: AIProvider): () => void {
  const getLatestSessionId = db.prepare(`
    SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1
  `)

  const getSkillLevel = db.prepare(`
    SELECT value FROM user_settings WHERE key = 'skill_level'
  `)

  const getUncaptionedEvents = db.prepare(`
    SELECT te.* FROM tool_events te
    WHERE te.session_id = @session_id
      AND NOT EXISTS (
        SELECT 1 FROM ai_explanations ae
        WHERE ae.target_type = 'tool_event'
          AND ae.target_id = te.id
          AND ae.skill_level = @skill_level
      )
    ORDER BY te.created_at ASC
    LIMIT ${BATCH_SIZE}
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
    LIMIT ${BATCH_SIZE}
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

      const sessionRow = getLatestSessionId.get() as { id: string } | undefined

      const pendingEvents = sessionRow
        ? (getUncaptionedEvents.all({
            session_id: sessionRow.id,
            skill_level: skillLevel
          }) as ToolEvent[])
        : []

      if (pendingEvents.length > 0) {
        const captions = await aiProvider.explainBatch(pendingEvents, skillLevel)
        saveCaptions(
          captions.map((c) => ({
            targetType: 'tool_event' as const,
            targetId: c.toolEventId,
            caption: c.caption,
            conceptTags: c.conceptTags
          })),
          skillLevel
        )
        return // 틱당 provider 호출 1회 제한 (RPM 방어)
      }

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
