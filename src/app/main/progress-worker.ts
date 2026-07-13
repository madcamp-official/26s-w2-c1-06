import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider, StepInput } from '@ai/types'
import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import { groupIntoSteps, type Step } from '@shared/steps'
import type { ProgressUpdate } from '@shared/progress'

// 학습 파이프라인 4단계: 낱개 tool_event가 아니라 "스텝"(에이전트 의도 1개 +
// 그 안의 액션들)을 요약한다. 한 스텝을 배치로 여러 개 처리하되 틱당 provider
// 호출은 1회로 제한(RPM 방어).
const STEP_BATCH_SIZE = 3
const VERSION_BATCH_SIZE = 5
const POLL_INTERVAL_MS = 5000
const GEMINI_BACKOFF_MS = 60_000

// 스텝 N개 = 사이클 한 바퀴(0→100%). 전체 작업량을 미리 알 수 없으므로 두 방식을
// 검토했다: (A) Gemini에게 "예상 남은 작업량"을 함께 추정시켜 분모로 쓰거나,
// (B) 고정 사이클로 보고 100% 도달 시 리셋. 오늘 이 세션에서만도 Gemini 무료
// 쿼터가 여러 번 소진되는 걸 직접 겪었기 때문에, 진행바가 AI 응답 성공 여부에
// 좌우되면 안 된다고 판단해 (B)를 선택했다 — 퍼센트는 로컬 스텝 카운트만으로
// 결정되고, Gemini/폴백 텍스트는 각 스텝의 summary/keyCode 내용만 채운다.
const CYCLE_SIZE = 8

interface CaptionRow {
  targetType: 'step' | 'code_unit_version'
  targetId: string
  summary: string
  keyCode: { filePath: string; lang: string; snippet: string; reason: string } | null
  stepPercent: number | null
  conceptTags: string[]
}

export interface ProgressWorkerOptions {
  /** 스텝 완료로 퍼센트가 갱신될 때마다 Main이 Renderer로 push */
  onUpdate?: (update: ProgressUpdate) => void
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: number }).status
  if (status === 429) return true
  const message = String((error as { message?: string }).message ?? error)
  return message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')
}

function fallbackSummaryFromNote(noteText: string | null | undefined): string {
  const cleaned = (noteText ?? '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return '작업을 진행했어요'
  return cleaned.length > 40 ? cleaned.slice(0, 40) + '…' : cleaned
}

export function startProgressWorker(
  db: Database.Database,
  aiProvider: AIProvider,
  options: ProgressWorkerOptions = {}
): () => void {
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

  const getSummarizedStepIds = db.prepare(`
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
    INSERT INTO ai_explanations (
      id, target_type, target_id, skill_level, summary,
      key_code_snippet, key_code_lang, key_code_file, key_code_reason, step_percent,
      concept_tags, created_at
    )
    VALUES (
      @id, @target_type, @target_id, @skill_level, @summary,
      @key_code_snippet, @key_code_lang, @key_code_file, @key_code_reason, @step_percent,
      @concept_tags, @created_at
    )
    ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
      summary = excluded.summary,
      key_code_snippet = excluded.key_code_snippet,
      key_code_lang = excluded.key_code_lang,
      key_code_file = excluded.key_code_file,
      key_code_reason = excluded.key_code_reason,
      step_percent = excluded.step_percent,
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
        summary: row.summary,
        key_code_snippet: row.keyCode?.snippet ?? null,
        key_code_lang: row.keyCode?.lang ?? null,
        key_code_file: row.keyCode?.filePath ?? null,
        key_code_reason: row.keyCode?.reason ?? null,
        step_percent: row.stepPercent,
        concept_tags: JSON.stringify(row.conceptTags),
        created_at: now
      })
    }
  })

  // 앱 실행 동안 이미 진행바에 반영한 스텝 — 재시작 전까지 한 번만 카운트한다
  // (사이클/퍼센트는 앱 라이프타임 상태라, DB에 이미 캐시된 요약이 있어도 이번
  // 실행에서 처음 지나가는 스텝이면 한 번은 진행바를 움직인다).
  const processedStepIds = new Set<string>()
  let completedInCycle = 0
  let cycleId = randomUUID()
  let geminiCooldownUntil = 0

  // 반환값(퍼센트)은 방금 이 스텝이 완료된 시점의 값 — 호출부가 DB에 step_percent로
  // 그대로 저장한다. completedInCycle/cycleId는 사이클 롤오버 시 이 함수 안에서 바로
  // 리셋되므로, 호출 뒤에 상태를 다시 읽으면 이미 다음 사이클 값이라 어긋난다.
  const emitProgress = (
    stepId: string,
    summary: string,
    keyCode: CaptionRow['keyCode']
  ): number | null => {
    if (!options.onUpdate) return null
    if (processedStepIds.has(stepId)) return null
    processedStepIds.add(stepId)

    completedInCycle += 1
    const percent = Math.min(100, Math.round((completedInCycle / CYCLE_SIZE) * 100))
    const delta = Math.round(100 / CYCLE_SIZE)
    const thisCycleId = cycleId

    options.onUpdate({ stepId, percent, delta, summary, keyCode, cycleId: thisCycleId })

    // 결승선 통과 애니메이션은 렌더러가 percent===100을 보고 재생 — 다음 스텝부터는
    // 새 사이클이 0%에서 다시 시작하도록 여기서 리셋한다(잔여값 이월 없음).
    if (completedInCycle >= CYCLE_SIZE) {
      completedInCycle = 0
      cycleId = randomUUID()
    }
    return percent
  }

  const processCachedOrFallback = (
    steps: Step[],
    inProgress: Step | null,
    skillLevel: SkillLevel,
    limit = 1
  ): number => {
    let processed = 0
    for (const step of steps) {
      if (processed >= limit) break
      if (!step.id || step === inProgress || step.events.length === 0) continue
      if (processedStepIds.has(step.id)) continue

      const row = db
        .prepare(
          `SELECT summary, key_code_snippet, key_code_lang, key_code_file, key_code_reason
           FROM ai_explanations WHERE target_type = 'step' AND target_id = @target_id AND skill_level = @skill_level`
        )
        .get({ target_id: step.id, skill_level: skillLevel }) as
        | {
            summary: string
            key_code_snippet: string | null
            key_code_lang: string | null
            key_code_file: string | null
            key_code_reason: string | null
          }
        | undefined

      let summary = row?.summary ?? ''
      let keyCode: CaptionRow['keyCode'] = null
      if (row?.key_code_snippet && row.key_code_lang && row.key_code_file && row.key_code_reason) {
        keyCode = {
          snippet: row.key_code_snippet,
          lang: row.key_code_lang,
          filePath: row.key_code_file,
          reason: row.key_code_reason
        }
      }
      if (!summary) summary = fallbackSummaryFromNote(step.note?.text)

      emitProgress(step.id, summary, keyCode)
      processed += 1
    }
    return processed
  }

  let running = false

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const skillLevel = ((getSkillLevel.get() as { value: string } | undefined)?.value ??
        'intermediate') as SkillLevel

      const session = getLatestSession.get() as { id: string; ended_at: string | null } | undefined
      if (!session) return

      const events = getEventsBySession.all({ session_id: session.id }) as ToolEvent[]
      const notes = getNotesBySession.all({ session_id: session.id }) as AssistantNote[]
      const steps = groupIntoSteps(notes, events)

      const sessionEnded = session.ended_at != null
      const inProgress = sessionEnded || steps.length === 0 ? null : steps[steps.length - 1]

      const summarized = new Set(
        (getSummarizedStepIds.all({ skill_level: skillLevel }) as { target_id: string }[]).map(
          (r) => r.target_id
        )
      )

      const eligible = steps
        .filter(
          (step) =>
            step.id !== null &&
            step.note !== null &&
            step.events.length > 0 &&
            step !== inProgress &&
            !summarized.has(step.id)
        )
        .slice(0, STEP_BATCH_SIZE)

      const now = Date.now()
      const geminiReady = now >= geminiCooldownUntil

      if (eligible.length > 0 && geminiReady) {
        try {
          const stepInputs: StepInput[] = eligible.map((step) => ({
            stepId: step.id!,
            noteText: step.note!.text,
            events: step.events
          }))
          const summaries = await aiProvider.summarizeProgress(stepInputs, skillLevel)

          for (const item of summaries) {
            const step = eligible.find((s) => s.id === item.stepId)
            if (!step) continue

            const percent = emitProgress(item.stepId, item.summary, item.keyCode)
            if (percent !== null) {
              saveCaptions(
                [
                  {
                    targetType: 'step',
                    targetId: item.stepId,
                    summary: item.summary,
                    keyCode: item.keyCode,
                    stepPercent: percent,
                    conceptTags: []
                  }
                ],
                skillLevel
              )
            }
          }

          return
        } catch (error) {
          console.error('[progress-worker] failed to generate progress summaries:', error)
          if (isRateLimitError(error)) {
            geminiCooldownUntil = Date.now() + GEMINI_BACKOFF_MS
            console.warn(
              `[progress-worker] Gemini rate-limited — backing off ${GEMINI_BACKOFF_MS / 1000}s; using fallback summaries`
            )
          }
          // Gemini 실패해도 폴백으로 진행바는 계속 움직인다 (아래 processCachedOrFallback)
        }
      }

      // 캐시된 요약 또는 note 폴백으로 진행 (Gemini 없이도 진행바는 계속 움직임)
      processCachedOrFallback(steps, inProgress, skillLevel, 1)

      if (!geminiReady || eligible.length > 0) {
        // Gemini 쿨다운 중이거나 방금 실패한 경우 버전 요약도 스킵해 쿼터 보호
        return
      }

      const pendingVersions = getUncaptionedVersions.all({
        skill_level: skillLevel
      }) as CodeUnitVersionWithUnit[]

      if (pendingVersions.length > 0) {
        try {
          const captions = await aiProvider.explainUnitVersions(pendingVersions, skillLevel)
          saveCaptions(
            captions.map((c) => ({
              targetType: 'code_unit_version' as const,
              targetId: c.versionId,
              summary: c.caption,
              keyCode: null,
              stepPercent: null,
              conceptTags: c.conceptTags
            })),
            skillLevel
          )
        } catch (error) {
          console.error('[progress-worker] failed to generate version captions:', error)
          if (isRateLimitError(error)) {
            geminiCooldownUntil = Date.now() + GEMINI_BACKOFF_MS
          }
        }
      }
    } catch (error) {
      console.error('[progress-worker] tick failed:', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS)
  tick()

  return () => clearInterval(timer)
}
