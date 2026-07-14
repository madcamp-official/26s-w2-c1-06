import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider } from '@ai/types'
import type {
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  Prompt,
  SkillLevel,
  ToolEvent
} from '@shared/types'
import { serializeTurnNarrative } from '@shared/format'

const BATCH_SIZE = 5
// 같은 턴 요약이 계속 실패하면(429 쿼터 소진, 프롬프트 초과 등) 틱마다 같은 턴만
// 무한 재시도하며 버전 요약까지 막는다 — 실패한 턴은 이 시간 동안 건너뛴다.
const FAILURE_COOLDOWN_MS = 60_000
// SPEC 4.3.1 개편: 예전엔 개별 tool_event(Read/Write/Bash 등)마다 캡션을 만들어서
// 단위가 너무 잘게 쪼개지고 틱마다 AI를 계속 호출했다. 이제는 "프롬프트를 보낼 때"가
// 아니라 "그 턴의 코딩 수정이 완료된 시점"에 턴 전체를 한 번만 호출해 feature 단위로
// 요약한다 — 관제실에 보이는 단위도, 실제 API 호출 횟수도 둘 다 줄어든다.
const POLL_INTERVAL_MS = 5000

interface VersionCaptionRow {
  targetId: string
  caption: string
  conceptTags: string[]
}

// 아직 팀원의 실시간 파이프라인이 없어 tool_events는 폴링으로 들어오므로,
// 이 워커도 같은 폴링 주기 자체를 배칭 윈도우로 사용한다.
// 캡션은 (target_type, target_id, skill_level) 단위로 캐시되므로, 사용자가
// 난이도를 바꾸면 그 난이도로 아직 캡션 없는 대상만 자연스럽게 다시 채워진다.
// 우선순위: 실시간성이 중요한 완료된 턴 요약 먼저, 남는 틱에 유닛 버전 요약.
// onExplanationSaved: 해설을 저장할 때마다 호출된다 — Electron main이 이 콜백에서
// 렌더러로 'data-changed'(kind: 'explanation')를 push해 다음 5초 폴링을 기다리지
// 않고 즉시 반영되게 한다(SPEC 4.6).
export function startCaptionWorker(
  db: Database.Database,
  aiProvider: AIProvider,
  onExplanationSaved?: () => void
): () => void {
  const getSkillLevel = db.prepare(`
    SELECT value FROM user_settings WHERE key = 'skill_level'
  `)

  // "완료된" 턴만 후보로 삼는다: 같은 세션에 다음 턴이 이미 시작됐거나(=이 턴은 끝났다는
  // 뜻) 세션 자체가 종료됐을 때. 아직 에이전트가 도구를 계속 호출 중인, 진행 중인
  // 마지막 턴은 제외해서 미완성 상태로 요약되지 않게 한다. tool_event가 하나도 없는
  // 턴(순수 대화 등)도 스킵 — "코딩 수정"이 없으면 요약할 feature가 없다.
  // 세션을 최신 세션 하나로 한정하지 않는다 — 과거 세션을 고정해 보거나 난이도를 바꾼
  // 경우에도 그 세션의 턴 해설이 채워져야 한다(버전 요약이 이미 전역 대상인 것과 동일).
  // 최신 세션부터 처리해 라이브 화면이 항상 먼저 채워진다.
  const getNextCompletedTurn = db.prepare(`
    SELECT p.*, s.project_id AS session_project_id FROM prompts p
    JOIN sessions s ON s.id = p.session_id
    WHERE EXISTS (SELECT 1 FROM tool_events te WHERE te.prompt_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM ai_explanations ae
        WHERE ae.target_type = 'prompt' AND ae.target_id = p.id AND ae.skill_level = @skill_level
      )
      AND (
        EXISTS (SELECT 1 FROM prompts nxt WHERE nxt.session_id = p.session_id AND nxt.turn_index > p.turn_index)
        OR s.ended_at IS NOT NULL
      )
    ORDER BY s.started_at DESC, p.turn_index ASC
    LIMIT 1
  `)

  const getEventsForPrompt = db.prepare(`
    SELECT * FROM tool_events WHERE prompt_id = @prompt_id ORDER BY created_at ASC
  `)

  // 턴 해설이 "구조도를 짚어가며" 서술할 수 있게, 이 턴에서 바뀐 유닛 버전과
  // 프로젝트 전체 구조도(유닛/엣지)를 함께 프롬프트 컨텍스트로 넘긴다.
  const getVersionsForPrompt = db.prepare(`
    SELECT v.*, u.unit_name, u.unit_type, u.file_path
    FROM code_unit_versions v
    JOIN code_units u ON u.id = v.unit_id
    WHERE v.prompt_id = @prompt_id
    ORDER BY v.created_at ASC
  `)

  const getProjectUnits = db.prepare(`
    SELECT * FROM code_units WHERE project_id = @project_id ORDER BY file_path, unit_name
  `)

  const getProjectEdges = db.prepare(`
    SELECT e.* FROM code_unit_edges e
    JOIN code_units u ON u.id = e.from_unit_id
    WHERE u.project_id = @project_id
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

  const saveExplanation = db.transaction(
    (targetType: 'prompt' | 'code_unit_version', targetId: string, caption: string, conceptTags: string[], skillLevel: SkillLevel) => {
      upsertExplanation.run({
        id: randomUUID(),
        target_type: targetType,
        target_id: targetId,
        skill_level: skillLevel,
        content: caption,
        concept_tags: JSON.stringify(conceptTags),
        created_at: new Date().toISOString()
      })
    }
  )

  const saveVersionCaptions = db.transaction((rows: VersionCaptionRow[], skillLevel: SkillLevel) => {
    for (const row of rows) {
      upsertExplanation.run({
        id: randomUUID(),
        target_type: 'code_unit_version',
        target_id: row.targetId,
        skill_level: skillLevel,
        content: row.caption,
        concept_tags: JSON.stringify(row.conceptTags),
        created_at: new Date().toISOString()
      })
    }
  })

  let running = false
  const retryAfterByTurn = new Map<string, number>()

  const tick = async (): Promise<void> => {
    if (running) return // 이전 틱의 provider 호출이 아직 안 끝났으면 겹쳐 실행하지 않음
    running = true
    try {
      const skillLevel = ((getSkillLevel.get() as { value: string } | undefined)?.value ??
        'intermediate') as SkillLevel

      let completedTurn = getNextCompletedTurn.get({ skill_level: skillLevel }) as
        | (Prompt & { session_project_id: string | null })
        | undefined
      if (completedTurn && (retryAfterByTurn.get(completedTurn.id) ?? 0) > Date.now()) {
        completedTurn = undefined // 쿨다운 중 — 이번 틱은 버전 요약이라도 처리한다
      }

      if (completedTurn) {
        const projectId = completedTurn.session_project_id
        const events = getEventsForPrompt.all({ prompt_id: completedTurn.id }) as ToolEvent[]
        const versions = getVersionsForPrompt.all({
          prompt_id: completedTurn.id
        }) as CodeUnitVersionWithUnit[]
        const units = projectId
          ? (getProjectUnits.all({ project_id: projectId }) as CodeUnit[])
          : []
        const edges = projectId
          ? (getProjectEdges.all({ project_id: projectId }) as CodeUnitEdge[])
          : []

        try {
          const { summary, bubbles, conceptTags } = await aiProvider.explainTurn(
            completedTurn,
            events,
            { versions, units, edges },
            skillLevel
          )
          // 말풍선 배열은 기존 content 컬럼에 JSON으로 직렬화해 저장한다 —
          // 렌더러는 parseTurnNarrative()로 읽고, 개편 전 평문 캐시도 폴백으로 소화한다.
          saveExplanation(
            'prompt',
            completedTurn.id,
            serializeTurnNarrative({ summary, bubbles }),
            conceptTags,
            skillLevel
          )
          onExplanationSaved?.()
        } catch (error) {
          retryAfterByTurn.set(completedTurn.id, Date.now() + FAILURE_COOLDOWN_MS)
          throw error
        }
        return // 틱당 provider 호출 1회 제한 (RPM 방어)
      }

      const pendingVersions = getUncaptionedVersions.all({
        skill_level: skillLevel
      }) as CodeUnitVersionWithUnit[]

      if (pendingVersions.length > 0) {
        const captions = await aiProvider.explainUnitVersions(pendingVersions, skillLevel)
        saveVersionCaptions(
          captions.map((c) => ({ targetId: c.versionId, caption: c.caption, conceptTags: c.conceptTags })),
          skillLevel
        )
        onExplanationSaved?.()
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
