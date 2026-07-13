import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider, StepInput } from '@ai/types'
import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import { parseStepExplanation, serializeStepExplanation } from '@shared/format'
import { groupIntoSteps, type Step } from '@shared/steps'
import type { TtsPriority, TtsUtterance } from '@shared/tts'
import type { EdgeTtsService, TtsVoiceId } from './tts/EdgeTtsService'
import { DEFAULT_TTS_VOICE, TTS_MIME_TYPE } from './tts/EdgeTtsService'

// 학습 파이프라인 4단계: 낱개 tool_event가 아니라 "스텝"(에이전트 의도 1개 +
// 그 안의 액션들)을 요약한다. 한 스텝을 배치로 여러 개 처리하되 틱당 provider
// 호출은 1회로 제한(RPM 방어). 개별 이벤트 캡션 자동생성은 하지 않는다 —
// 이벤트 행은 원시 데이터(도구/파일/상태/에러)로 드릴다운을 제공하므로 AI 불필요.
const STEP_BATCH_SIZE = 3
const VERSION_BATCH_SIZE = 5
const POLL_INTERVAL_MS = 5000
const GEMINI_BACKOFF_MS = 60_000

interface CaptionRow {
  targetType: 'step' | 'code_unit_version'
  targetId: string
  caption: string
  conceptTags: string[]
}

export interface CaptionWorkerOptions {
  tts?: EdgeTtsService
  /** TTS 음성 클립이 준비되면 Main이 Renderer로 push */
  onUtterance?: (utterance: TtsUtterance) => void
  isTtsEnabled?: () => boolean
  getTtsVoice?: () => TtsVoiceId
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: number }).status
  if (status === 429) return true
  const message = String((error as { message?: string }).message ?? error)
  return message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')
}

function fallbackScriptFromNote(noteText: string): string {
  const cleaned = noteText.replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  const short = cleaned.length > 180 ? `${cleaned.slice(0, 180)} 이어서 설명합니다` : cleaned
  return `지금 에이전트가 이렇게 움직이고 있습니다 ${short}`
}

export function startCaptionWorker(
  db: Database.Database,
  aiProvider: AIProvider,
  options: CaptionWorkerOptions = {}
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

  const getCaptionedStepIds = db.prepare(`
    SELECT target_id FROM ai_explanations WHERE target_type = 'step' AND skill_level = @skill_level
  `)

  const getStepExplanation = db.prepare(`
    SELECT content FROM ai_explanations
    WHERE target_type = 'step' AND target_id = @target_id AND skill_level = @skill_level
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

  const countCreatedForEvents = (eventIds: string[]): number => {
    if (eventIds.length === 0) return 0
    const placeholders = eventIds.map(() => '?').join(', ')
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM code_unit_versions
         WHERE change_type = 'created' AND tool_event_id IN (${placeholders})`
      )
      .get(...eventIds) as { cnt: number } | undefined
    return row?.cnt ?? 0
  }

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

  const stepHasCreatedUnit = (eventIds: string[]): boolean => countCreatedForEvents(eventIds) > 0

  // 앱 실행 동안 이미 낭독한 스텝 — Gemini 없이도 캐시/폴백 TTS를 한 번씩 재생
  const spokenStepIds = new Set<string>()
  let geminiCooldownUntil = 0

  const emitTts = async (
    id: string,
    script: string,
    priority: TtsPriority,
    source: TtsUtterance['source']
  ): Promise<boolean> => {
    if (!options.tts || !options.onUtterance) return false
    if (options.isTtsEnabled && !options.isTtsEnabled()) return false
    if (!script.trim()) return false
    if (spokenStepIds.has(id)) return false

    try {
      const voice = options.getTtsVoice?.() ?? DEFAULT_TTS_VOICE
      const buffer = await options.tts.synthesize(script, voice)
      spokenStepIds.add(id)
      options.onUtterance({
        id,
        mimeType: TTS_MIME_TYPE,
        audioBase64: buffer.toString('base64'),
        priority,
        source
      })
      return true
    } catch (error) {
      console.error('[caption-worker] TTS synthesize failed:', error)
      return false
    }
  }

  const speakCachedOrFallback = async (
    steps: Step[],
    inProgress: Step | null,
    skillLevel: SkillLevel,
    limit = 1
  ): Promise<number> => {
    let spoken = 0
    for (const step of steps) {
      if (spoken >= limit) break
      if (!step.id || step === inProgress || step.events.length === 0) continue
      if (spokenStepIds.has(step.id)) continue

      const row = getStepExplanation.get({
        target_id: step.id,
        skill_level: skillLevel
      }) as { content: string } | undefined

      let script = ''
      if (row) {
        const parsed = parseStepExplanation(row.content)
        script = parsed.ttsScript || parsed.body
      }
      if (!script && step.note?.text) {
        script = fallbackScriptFromNote(step.note.text)
      }
      if (!script) continue

      const priority: TtsPriority = stepHasCreatedUnit(step.events.map((e) => e.id))
        ? 'high'
        : 'normal'
      const ok = await emitTts(step.id, script, priority, 'step')
      if (ok) spoken += 1
    }
    return spoken
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
            step.events.length > 0 &&
            step !== inProgress &&
            !captioned.has(step.id)
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
          const captions = await aiProvider.explainSteps(stepInputs, skillLevel)
          saveCaptions(
            captions.map((c) => ({
              targetType: 'step' as const,
              targetId: c.stepId,
              caption: serializeStepExplanation({
                title: c.title,
                body: c.caption,
                why: c.why,
                ttsScript: c.ttsScript
              }),
              conceptTags: c.conceptTags
            })),
            skillLevel
          )

          void (async () => {
            for (const caption of captions) {
              const step = eligible.find((s) => s.id === caption.stepId)
              const priority: TtsPriority = stepHasCreatedUnit(step?.events.map((e) => e.id) ?? [])
                ? 'high'
                : 'normal'
              await emitTts(caption.stepId, caption.ttsScript || caption.caption, priority, 'step')
            }
          })()

          return
        } catch (error) {
          console.error('[caption-worker] failed to generate captions:', error)
          if (isRateLimitError(error)) {
            geminiCooldownUntil = Date.now() + GEMINI_BACKOFF_MS
            console.warn(
              `[caption-worker] Gemini rate-limited — backing off ${GEMINI_BACKOFF_MS / 1000}s; using TTS fallback`
            )
          }
          // Gemini 실패해도 폴백 중계는 진행 (아래 speakCachedOrFallback)
        }
      }

      // 캐시된 캡션 또는 note 폴백으로 TTS (Gemini 없이도 실시간 중계 유지)
      await speakCachedOrFallback(steps, inProgress, skillLevel, 1)

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
              caption: c.caption,
              conceptTags: c.conceptTags
            })),
            skillLevel
          )
        } catch (error) {
          console.error('[caption-worker] failed to generate version captions:', error)
          if (isRateLimitError(error)) {
            geminiCooldownUntil = Date.now() + GEMINI_BACKOFF_MS
          }
        }
      }
    } catch (error) {
      console.error('[caption-worker] tick failed:', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS)
  tick()

  return () => clearInterval(timer)
}
