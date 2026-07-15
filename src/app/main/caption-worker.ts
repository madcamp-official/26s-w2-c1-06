import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider } from '@ai/types'
import type { CodeUnitVersionWithUnit, Prompt, SkillLevel, ToolEvent } from '@shared/types'
import { STEP_IDLE_GAP_MS } from '@shared/steps'

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
  keySnippet: string | null
}

export interface CaptionWorkerHandle {
  stop: () => void
  // 폴링 주기(POLL_INTERVAL_MS)를 기다리지 않고 즉시 한 번 더 시도한다 — main/index.ts가
  // 'turn-completed'/'code-units-changed' 이벤트를 받을 때마다 호출한다.
  triggerTick: () => void
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
  onExplanationSaved?: () => void,
  onTurnCompleted?: () => void
): CaptionWorkerHandle {
  const getSkillLevel = db.prepare(`
    SELECT value FROM user_settings WHERE key = 'skill_level'
  `)

  // "완료된" 턴만 후보로 삼는다: Stop 훅이 이 턴을 완료 처리했거나(p.completed_at,
  // 가장 직접적이고 즉각적인 신호), 같은 세션에 다음 턴이 이미 시작됐거나(=이 턴은
  // 끝났다는 뜻), 세션 자체가 종료됐거나, 또는 이 턴의 마지막 활동으로부터
  // STEP_IDLE_GAP_MS가 지났을 때. 뒤의 세 조건은 Stop 훅 신호가 없던(구버전 DB의
  // 과거 데이터, 혹은 훅이 어떤 이유로 못 온 경우) 폴백으로 유지한다 — 이 턴에
  // 나중에(90초 넘게 쉬었다가) 이벤트가 더 붙으면 이미 저장된 캡션은 갱신되지 않는데
  // — 드문 경우이고, 없어서 영원히 안 끝나는 문제보다는 낫다고 판단했다.
  // 세션을 최신 세션 하나로 한정하지 않는다 — 과거 세션을 고정해 보거나 난이도를 바꾼
  // 경우에도 그 세션의 턴 해설이 채워져야 한다(버전 요약이 이미 전역 대상인 것과 동일).
  // 최신 세션부터 처리해 라이브 화면이 항상 먼저 채워진다.
  // 예전엔 tool_event가 하나도 없는 턴(순수 대화, 또는 도구 호출 전에 중단된 요청)을
  // 여기서 걸러냈는데("코딩 수정이 없으면 요약할 feature가 없다"), 그러면 그 턴이
  // 세션의 마지막 턴일 때 영원히 캡션이 안 생겨 "현재 프롬프트"/타임라인이 완료 판정을
  // 못 받고 계속 진행 중으로 표시되는 문제가 있었다. explainTurn은 이벤트가 0개면
  // AI 호출 없이 빈 caption을 즉시 돌려주므로(GeminiProvider 참조), 여기서 걸러낼
  // 필요가 없다 — 화면 쪽(buildTurnList)이 이미 tool_event 없는 턴을 목록에서 빼므로
  // 빈 캡션이 있어도 사용자에게 그대로 노출되진 않는다.
  const getNextCompletedTurn = db.prepare(`
    SELECT p.* FROM prompts p
    JOIN sessions s ON s.id = p.session_id
    WHERE NOT EXISTS (
        SELECT 1 FROM ai_explanations ae
        WHERE ae.target_type = 'prompt' AND ae.target_id = p.id AND ae.skill_level = @skill_level
      )
      AND (
        p.completed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM prompts nxt WHERE nxt.session_id = p.session_id AND nxt.turn_index > p.turn_index)
        OR s.ended_at IS NOT NULL
        OR COALESCE(
             (SELECT MAX(te.created_at) FROM tool_events te WHERE te.prompt_id = p.id),
             p.created_at
           ) <= @idle_cutoff
      )
    ORDER BY s.started_at DESC, p.turn_index ASC
    LIMIT 1
  `)

  const getEventsForPrompt = db.prepare(`
    SELECT * FROM tool_events WHERE prompt_id = @prompt_id ORDER BY created_at ASC
  `)

  // prompts.completed_at은 원래 Stop 훅(매 턴 종료 신호) 하나로만 채워졌다 — 그런데
  // Stop 훅은 관찰 대상 Claude Code 세션이 "관찰 시작"보다 먼저 열려 있었거나(훅은
  // 세션 시작 시점에 한 번 로드되므로 나중에 .claude/settings.json에 추가해도 그
  // 세션엔 반영이 안 됨) 훅 스크립트 실행이 어떤 이유로 실패하면 영원히 안 온다 —
  // 그러면 실제로는 코딩이 끝나 캡션까지 다 생겼는데도(아래 idle 폴백 덕분) "현재
  // 프롬프트" 카드/진행바/타임라인 스피너는 completed_at만 보고 판단해서 계속
  // "실행 중"으로 멈춰 있었다. getNextCompletedTurn이 캡션 생성 여부를 판단할 때
  // 이미 쓰는 것과 똑같은 idle 기준(마지막 활동 후 STEP_IDLE_GAP_MS 경과)을 여기서도
  // 그대로 적용해 completed_at 자체를 채운다 — Stop 훅이 오면 그게 훨씬 더 빨리
  // 반영되니 그대로 우선하고, 이건 훅이 못 왔을 때의 안전망이다.
  const markIdleTurnsCompleted = db.prepare(`
    UPDATE prompts
    SET completed_at = @now
    WHERE completed_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM prompts nxt WHERE nxt.session_id = prompts.session_id AND nxt.turn_index > prompts.turn_index
        )
        OR EXISTS (
          SELECT 1 FROM sessions s WHERE s.id = prompts.session_id AND s.ended_at IS NOT NULL
        )
        OR COALESCE(
             (SELECT MAX(te.created_at) FROM tool_events te WHERE te.prompt_id = prompts.id),
             prompts.created_at
           ) <= @idle_cutoff
      )
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

  // key_code_snippet은 원래 step 행 전용으로 설계됐지만(schema.sql 주석 참조), code_unit_version
  // 행에도 그대로 재사용한다 — AI가 diff에서 고른 줄 범위를 우리가 직접 잘라낸 "핵심 코드"
  // (explainVersionsPrompt.ts의 sliceKeySnippet). prompt 행은 이 값이 없어 항상 null로 채운다.
  const upsertExplanation = db.prepare(`
    INSERT INTO ai_explanations (id, target_type, target_id, skill_level, content, concept_tags, key_code_snippet, created_at)
    VALUES (@id, @target_type, @target_id, @skill_level, @content, @concept_tags, @key_code_snippet, @created_at)
    ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
      content = excluded.content,
      concept_tags = excluded.concept_tags,
      key_code_snippet = excluded.key_code_snippet,
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
        key_code_snippet: null,
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
        key_code_snippet: row.keySnippet,
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

      const idleCutoff = new Date(Date.now() - STEP_IDLE_GAP_MS).toISOString()

      const idleCompletion = markIdleTurnsCompleted.run({ now: new Date().toISOString(), idle_cutoff: idleCutoff })
      if (idleCompletion.changes > 0) onTurnCompleted?.()

      let completedTurn = getNextCompletedTurn.get({ skill_level: skillLevel, idle_cutoff: idleCutoff }) as
        | Prompt
        | undefined
      if (completedTurn && (retryAfterByTurn.get(completedTurn.id) ?? 0) > Date.now()) {
        completedTurn = undefined // 쿨다운 중 — 이번 틱은 버전 요약이라도 처리한다
      }

      if (completedTurn) {
        const events = getEventsForPrompt.all({ prompt_id: completedTurn.id }) as ToolEvent[]

        try {
          const { caption, conceptTags } = await aiProvider.explainTurn(completedTurn, events, skillLevel)
          saveExplanation('prompt', completedTurn.id, caption, conceptTags, skillLevel)
          onExplanationSaved?.()
        } catch (error) {
          retryAfterByTurn.set(completedTurn.id, Date.now() + FAILURE_COOLDOWN_MS)
          throw error
        }
        // 예전엔 여기서 return해 틱당 provider 호출을 1회로 제한했다(Gemini 무료 티어
        // RPM 방어) — 그런데 턴이 잇달아 완료되면(Stop 훅이 즉시 완료 처리하므로 흔함)
        // 매 틱이 턴 캡션만 처리하고 code_unit_version 캡션(TurnChanges "더 자세히" 카드)은
        // 영원히 뒤로 밀려 "요약 생성 중…"이 몇 분씩 안 풀리는 문제가 있었다. 턴 하나 +
        // 버전 배치 하나, 틱당 최대 2회 호출까지는 허용해 같은 틱에서 버전 캡션도 진행한다.
      }

      const pendingVersions = getUncaptionedVersions.all({
        skill_level: skillLevel
      }) as CodeUnitVersionWithUnit[]

      if (pendingVersions.length > 0) {
        const captions = await aiProvider.explainUnitVersions(pendingVersions, skillLevel)
        saveVersionCaptions(
          captions.map((c) => ({
            targetId: c.versionId,
            caption: c.caption,
            conceptTags: c.conceptTags,
            keySnippet: c.keySnippet
          })),
          skillLevel
        )
        onExplanationSaved?.()
      }
    } catch (error) {
      console.error('[caption-worker] failed to generate captions:', error)
    } finally {
      running = false
      // triggerTick()이 이전 틱 실행 중에 들어왔으면(예: 같은 틱이 아직 provider 호출을
      // 기다리는 사이 새 코드 유닛이 또 생김) 그 요청을 놓치지 않고 방금 끝난 직후 바로
      // 한 번 더 돈다 — POLL_INTERVAL_MS(5초)까지 기다리지 않는다.
      if (retriggerRequested) {
        retriggerRequested = false
        void tick()
      }
    }
  }

  // 예전엔 5초 폴링만으로 새 턴 완료/코드 유닛 생성을 알아챘다 — 그 사이 최대 5초의
  // 지연이 "요약 생성 중…"이 계속 떠 있는 것처럼 느껴지게 했다. main/index.ts가
  // pipeline의 'turn-completed'(Stop 훅)·'code-units-changed'(AST diff 완료) 이벤트를
  // 받을 때마다 이 함수를 호출해 폴링 주기를 기다리지 않고 즉시 한 번 더 시도한다.
  let retriggerRequested = false
  const triggerTick = (): void => {
    if (running) {
      retriggerRequested = true
      return
    }
    void tick()
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS)
  tick()

  return { stop: () => clearInterval(timer), triggerTick }
}
