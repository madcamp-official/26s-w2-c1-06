import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider, StepInput } from '@ai/types'
import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import { groupIntoSteps, type Step } from '@shared/steps'
import type { LiveStatus, ProgressUpdate, StepStatus } from '@shared/progress'

// 학습 파이프라인 4단계: 낱개 tool_event가 아니라 "스텝"(에이전트 의도 1개 +
// 그 안의 액션들)을 요약한다. 한 스텝을 배치로 여러 개 처리하되 틱당 provider
// 호출은 1회로 제한(RPM 방어).
const STEP_BATCH_SIZE = 3
const VERSION_BATCH_SIZE = 5
const POLL_INTERVAL_MS = 5000
const GEMINI_BACKOFF_MS = 60_000
// "지금 하는 중" 표시는 Gemini 요약(POLL_INTERVAL_MS, 최대 60초 백오프까지 늘어남)을
// 기다리면 라이브 느낌이 사라지므로, 훨씬 빠른 별도 주기로 로컬 규칙만 돌린다.
const LIVE_STATUS_POLL_INTERVAL_MS = 1500

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
  status: StepStatus
  conceptTags: string[]
}

export interface ProgressWorkerOptions {
  /** 스텝 완료로 퍼센트가 갱신될 때마다 Main이 Renderer로 push */
  onUpdate?: (update: ProgressUpdate) => void
  /** "지금 하는 중" 한 줄 상태가 바뀔 때마다 Main이 Renderer로 push (빠른 별도 주기) */
  onLiveUpdate?: (status: LiveStatus) => void
}

function stepStatusOf(step: Pick<Step, 'events'>): StepStatus {
  return step.events.some((e) => e.status === 'error') ? 'failed' : 'success'
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

export interface ProgressWorkerHandle {
  stop: () => void
  /** 렌더러 마운트 캐치업용 — progress:live-status도 push라 워커가 이 모듈 로드 시점(BrowserWindow가
   * 아직 없을 때) 곧바로 한 번 쏘는 최초 상태는 브로드캐스트할 창이 없어 유실된다. 그 뒤로는 DB
   * 상태가 그대로라 dedupe 때문에 재전송도 안 되므로(같은 키), pull로 현재값을 한 번 당겨와야 한다. */
  getLiveStatus: () => LiveStatus
}

export function startProgressWorker(
  db: Database.Database,
  aiProvider: AIProvider,
  options: ProgressWorkerOptions = {}
): ProgressWorkerHandle {
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
      status, concept_tags, created_at
    )
    VALUES (
      @id, @target_type, @target_id, @skill_level, @summary,
      @key_code_snippet, @key_code_lang, @key_code_file, @key_code_reason, @step_percent,
      @status, @concept_tags, @created_at
    )
    ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
      summary = excluded.summary,
      key_code_snippet = excluded.key_code_snippet,
      key_code_lang = excluded.key_code_lang,
      key_code_file = excluded.key_code_file,
      key_code_reason = excluded.key_code_reason,
      step_percent = excluded.step_percent,
      status = excluded.status,
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
        status: row.status,
        concept_tags: JSON.stringify(row.conceptTags),
        created_at: now
      })
    }
  })

  // code_unit_versions.step_id 백필: pipeline(Person A)은 스텝 개념을 모르고 삽입하므로,
  // 이미 events → step 매핑을 계산한 이 워커가 tool_event_id로 역추적해 채운다
  // (구조도 노드 클릭 → 진행상황 카드 스크롤 연결에 사용, SPEC 패치 v2 #6).
  const hasUnbackfilledVersions = db.prepare(
    `SELECT 1 FROM code_unit_versions WHERE step_id IS NULL AND tool_event_id IS NOT NULL LIMIT 1`
  )
  const backfillStepIdForEvent = db.prepare(
    `UPDATE code_unit_versions SET step_id = @step_id WHERE tool_event_id = @tool_event_id AND step_id IS NULL`
  )
  const backfillVersionStepIds = db.transaction((steps: Step[]) => {
    for (const step of steps) {
      if (!step.id) continue
      for (const event of step.events) {
        backfillStepIdForEvent.run({ step_id: step.id, tool_event_id: event.id })
      }
    }
  })

  // 앱 실행 동안 이미 진행바에 반영한 스텝 — 재시작 전까지 한 번만 카운트한다
  // (사이클/퍼센트는 앱 라이프타임 상태라, DB에 이미 캐시된 요약이 있어도 이번
  // 실행에서 처음 지나가는 스텝이면 한 번은 진행바를 움직인다).
  const processedStepIds = new Set<string>()
  let completedInCycle = 0
  let cycleId = randomUUID()
  let cycleNumber = 1
  let geminiCooldownUntil = 0

  // 반환값(퍼센트)은 방금 이 스텝이 완료된 시점의 값 — 호출부가 DB에 step_percent로
  // 그대로 저장한다. completedInCycle/cycleId/cycleNumber는 사이클 롤오버 시 이 함수
  // 안에서 바로 리셋되므로, 호출 뒤에 상태를 다시 읽으면 이미 다음 사이클 값이라 어긋난다
  // — 그래서 롤오버 전 값을 반환 객체에 담아 호출부로 넘긴다.
  const emitProgress = (
    stepId: string,
    summary: string,
    keyCode: CaptionRow['keyCode'],
    status: StepStatus
  ): { percent: number; cycleNumber: number; stepsInCycle: number } | null => {
    if (!options.onUpdate) return null
    if (processedStepIds.has(stepId)) return null
    processedStepIds.add(stepId)

    completedInCycle += 1
    const percent = Math.min(100, Math.round((completedInCycle / CYCLE_SIZE) * 100))
    const delta = Math.round(100 / CYCLE_SIZE)
    const thisCycleId = cycleId
    const thisCycleNumber = cycleNumber
    const thisStepsInCycle = completedInCycle

    options.onUpdate({
      stepId,
      percent,
      delta,
      summary,
      keyCode,
      cycleId: thisCycleId,
      status,
      cycleNumber: thisCycleNumber,
      stepsInCycle: thisStepsInCycle,
      cycleSize: CYCLE_SIZE
    })

    // 결승선 통과 애니메이션은 렌더러가 percent===100을 보고 재생 — 다음 스텝부터는
    // 새 사이클이 0%에서 다시 시작하도록 여기서 리셋한다(잔여값 이월 없음).
    if (completedInCycle >= CYCLE_SIZE) {
      completedInCycle = 0
      cycleId = randomUUID()
      cycleNumber += 1
    }
    return { percent, cycleNumber: thisCycleNumber, stepsInCycle: thisStepsInCycle }
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
          `SELECT summary, key_code_snippet, key_code_lang, key_code_file, key_code_reason, step_percent
           FROM ai_explanations WHERE target_type = 'step' AND target_id = @target_id AND skill_level = @skill_level`
        )
        .get({ target_id: step.id, skill_level: skillLevel }) as
        | {
            summary: string
            key_code_snippet: string | null
            key_code_lang: string | null
            key_code_file: string | null
            key_code_reason: string | null
            step_percent: number | null
          }
        | undefined

      // 이 스텝이 이전 실행에서 이미 퍼센트에 반영된 적 있으면(step_percent가 저장돼
      // 있으면) processedStepIds(이번 실행 한정 메모리)엔 없어도 다시 카운트하면 안
      // 된다 — 앱 재시작마다 옛날 스텝을 "새로 완료"로 잘못 세서 퍼센트가 실제보다
      // 부풀거나(중복 카운트), 렌더러에서 같은 stepId가 히스토리에 두 번 들어가는
      // 문제(React key 충돌)로 실제 이어졌다. db:getProgressState가 이미 이 값을
      // 재수화하므로 여기선 조용히 스킵하고 메모리에도 처리됨으로 표시만 해둔다.
      if (row && row.step_percent !== null) {
        processedStepIds.add(step.id)
        continue
      }

      // 위에서 step_percent가 있는 행은 이미 continue했으므로, 여기 도달했다는 건
      // row가 아예 없다는 뜻(한 번도 처리된 적 없는 스텝) — note 기반 폴백 요약을 쓴다.
      // status는 AI 없이도 tool_event 결과만으로 결정론적으로 계산 가능하므로 Gemini
      // 성공/실패와 무관하게 항상 로컬로 판정한다.
      const summary = fallbackSummaryFromNote(step.note?.text)
      const status = stepStatusOf(step)
      const result = emitProgress(step.id, summary, null, status)
      // 폴백도 Gemini 성공 경로와 동일하게 DB에 남겨야, 다음 재시작 때 이미 카운트된
      // 스텝으로 인식돼(위 step_percent 체크) 또 세지 않는다 — 안 남기면 Gemini가
      // 끝내 이 스텝을 못 봐도(예: 세션 종료) 재시작마다 중복 카운트가 반복된다.
      if (result !== null) {
        saveCaptions(
          [
            {
              targetType: 'step',
              targetId: step.id,
              summary,
              keyCode: null,
              stepPercent: result.percent,
              status,
              conceptTags: []
            }
          ],
          skillLevel
        )
      }
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

      if (hasUnbackfilledVersions.get()) backfillVersionStepIds(steps)

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

            const status = stepStatusOf(step)
            const result = emitProgress(item.stepId, item.summary, item.keyCode, status)
            if (result !== null) {
              saveCaptions(
                [
                  {
                    targetType: 'step',
                    targetId: item.stepId,
                    summary: item.summary,
                    keyCode: item.keyCode,
                    stepPercent: result.percent,
                    status,
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
              status: 'success' as const, // status는 step 행 전용 — code_unit_version 행은 스키마 기본값과 동일하게 둠
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

  // "지금 하는 중" — Gemini 요약을 거치지 않는 로컬 규칙(최근 tool_event의 도구명+파일)만
  // 사용해 훨씬 빠른 주기로 갱신한다. 완료된 스텝(위 tick)과 달리 아직 note로 닫히지
  // 않은 진행 중 스텝만 본다 — 세션 종료나 진행 중 스텝이 없으면 idle.
  const computeLiveStatus = (): LiveStatus => {
    const session = getLatestSession.get() as { id: string; ended_at: string | null } | undefined
    if (!session) return { text: '', idle: true }

    const events = getEventsBySession.all({ session_id: session.id }) as ToolEvent[]
    const notes = getNotesBySession.all({ session_id: session.id }) as AssistantNote[]
    const steps = groupIntoSteps(notes, events)
    const sessionEnded = session.ended_at != null
    const inProgress = sessionEnded || steps.length === 0 ? null : steps[steps.length - 1]
    if (!inProgress) return { text: '', idle: true }

    const lastEvent = inProgress.events[inProgress.events.length - 1]
    if (lastEvent) {
      return { text: `${lastEvent.tool_name} · ${lastEvent.file_path ?? '파일 미지정'}`, idle: false }
    }
    if (inProgress.note) {
      return { text: `${fallbackSummaryFromNote(inProgress.note.text)} 준비 중`, idle: false }
    }
    return { text: '', idle: true }
  }

  let lastLiveKey: string | null = null

  const liveTick = (): void => {
    if (!options.onLiveUpdate) return
    try {
      const status = computeLiveStatus()
      const key = `${status.idle}:${status.text}`
      if (key === lastLiveKey) return
      lastLiveKey = key
      options.onLiveUpdate(status)
    } catch (error) {
      console.error('[progress-worker] live-status tick failed:', error)
    }
  }

  const timer = setInterval(tick, POLL_INTERVAL_MS)
  const liveTimer = setInterval(liveTick, LIVE_STATUS_POLL_INTERVAL_MS)
  tick()
  liveTick()

  return {
    stop: () => {
      clearInterval(timer)
      clearInterval(liveTimer)
    },
    getLiveStatus: computeLiveStatus
  }
}
