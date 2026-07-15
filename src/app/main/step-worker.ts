import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AIProvider, StepInput } from '@ai/types'
import { errorDetailOf, pickCodeCandidate, summarizeRawPayload } from '@ai/prompt-templates/stepCodeExtract'
import type { AssistantNote, SkillLevel, ToolEvent } from '@shared/types'
import { groupIntoSteps, STEP_IDLE_GAP_MS, TURN_IDLE_GAP_MS, type Step } from '@shared/steps'
import type { LiveStatus } from '@shared/stepProgress'

// 활동 탭 "바뀐 구조와 변경사항"에 실시간으로 쌓이는 진행 로그 — 턴이 끝나길 기다리는
// caption-worker(explainTurn)와 달리, 턴 안에서도 유휴시간/이벤트 개수로 나뉜 "스텝"
// 단위로 코드가 바뀌는 족족 요약한다. 스텝당 배치 호출은 틱당 1회로 제한(RPM 방어).
const STEP_BATCH_SIZE = 3
const POLL_INTERVAL_MS = 5000
const FAILURE_COOLDOWN_MS = 60_000
// "지금 하는 중" 표시는 Gemini 요약(POLL_INTERVAL_MS, 실패 시 쿨다운까지 늘어남)을
// 기다리면 실시간감이 사라지므로, 훨씬 빠른 별도 주기로 로컬 규칙만 돌린다.
const LIVE_STATUS_POLL_INTERVAL_MS = 1500
const LIVE_STATUS_ARG_MAX_LENGTH = 50

interface StepRow {
  id: string
  status: 'success' | 'failed'
  summary: string
  keyCodeSnippet: string | null
  keyCodeLang: string | null
  keyCodeFile: string | null
  keyCodeOtherFiles: string[]
  keyCodeExplanation: string | null
  keyCodeImportance: string | null
  keyCodeApplication: string | null
  errorDetail: string | null
  conceptTags: string[]
}

export interface StepWorkerHandle {
  stop: () => void
  // 렌더러 마운트 캐치업용 — push는 워커가 이 모듈 로드 시점(BrowserWindow가 아직
  // 없을 때) 곧바로 한 번 쏘는 최초 상태를 유실할 수 있다. 그 뒤로는 상태가 그대로면
  // dedupe 때문에 재전송이 안 되므로, pull로 현재값을 한 번 당겨와야 한다.
  getLiveStatus: () => LiveStatus
}

function stepStatus(step: Pick<Step, 'events'>): 'success' | 'failed' {
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

function truncateForLiveStatus(text: string): string {
  return text.length > LIVE_STATUS_ARG_MAX_LENGTH ? text.slice(0, LIVE_STATUS_ARG_MAX_LENGTH) + '…' : text
}

// db:getSteps(main/index.ts)의 "진행 중" 판정은 completed_at/세션 종료 외에도 마지막
// 이벤트 유휴시간(STEP_IDLE_GAP_MS)을 이미 폴백으로 본다 — 그런데 이 워커의 "요약
// 대상에서 제외할 진행 중 스텝" 판정(tick의 inProgress)과 "지금 하는 중" 판정
// (computeLiveStatus의 inProgress)은 이 폴백이 빠져 있었다. 그 결과 promptId가
// null인 orphan 스텝(수동 수정)이나, Stop 훅/idle 완료 처리가 이 세션엔 아직 안
// 온(세션이 계속 관찰 중이라 ended_at도 없는) 스텝은, 화면엔 이미 "진행 중" 표시가
// 사라졌는데도(index.ts는 idle 폴백이 있어서) 워커는 계속 "아직 안 끝났다"고 보고
// 영원히 요약을 안 만들어 "요약 생성 중…"이 안 풀리는 문제가 있었다. 두 판정 기준을
// 동일하게 맞춘다.
function isLastStepStale(step: Step | undefined, gapMs: number): boolean {
  const lastEvent = step?.events[step.events.length - 1]
  if (!lastEvent?.created_at) return false
  return Date.now() - Date.parse(lastEvent.created_at) > gapMs
}

export interface StepWorkerOptions {
  /** 스텝 요약이 새로 저장될 때마다 Main이 렌더러로 push(kind: 'explanation') */
  onExplanationSaved?: () => void
  /** "지금 하는 중" 한 줄 상태가 바뀔 때마다 Main이 렌더러로 push (빠른 별도 주기) */
  onLiveUpdate?: (status: LiveStatus) => void
}

export function startStepWorker(
  db: Database.Database,
  aiProvider: AIProvider,
  options: StepWorkerOptions = {}
): StepWorkerHandle {
  // 파이프라인 인스턴스가 프로세스에 하나뿐이라(SPEC 4.6) "지금 관찰 중인 세션"은
  // 항상 가장 최근 세션 하나다 — 프로젝트로 스코프할 필요 없이 전역 latest로 충분.
  // 재개(resume)로 발급된 논리 id는 원본 세션의 started_at을 그대로 물려받아 값이
  // 같을 수 있어(resolveLogicalSessionId) rowid DESC를 2차 정렬 기준으로 둔다 —
  // 안 그러면 동점 처리 순서가 쿼리 플래너에 좌우돼 실제로 관찰 중인 세션이 아니라
  // 이미 오래전에 끝난 세션이 "최신"으로 잘못 뽑힐 수 있다.
  const getLatestSession = db.prepare(`
    SELECT id, ended_at FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT 1
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

  // Stop 훅(턴 종료) 신호 — 마지막 스텝이 속한 턴이 이미 완료 처리됐으면, 90초 유휴시간
  // (STEP_IDLE_GAP_MS)을 기다리지 않고 바로 "끝난 스텝"으로 취급한다(요약 대상 포함,
  // "지금 하는 중" 상태도 즉시 idle로).
  const getCompletedPromptIds = db.prepare(`
    SELECT id FROM prompts WHERE session_id = @session_id AND completed_at IS NOT NULL
  `)

  const upsertStep = db.prepare(`
    INSERT INTO ai_explanations (
      id, target_type, target_id, skill_level, content,
      key_code_snippet, key_code_lang, key_code_file, key_code_other_files,
      key_code_explanation, key_code_importance, key_code_application,
      error_detail, status, concept_tags, created_at
    )
    VALUES (
      @id, 'step', @target_id, @skill_level, @content,
      @key_code_snippet, @key_code_lang, @key_code_file, @key_code_other_files,
      @key_code_explanation, @key_code_importance, @key_code_application,
      @error_detail, @status, @concept_tags, @created_at
    )
    ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
      content = excluded.content,
      key_code_snippet = excluded.key_code_snippet,
      key_code_lang = excluded.key_code_lang,
      key_code_file = excluded.key_code_file,
      key_code_other_files = excluded.key_code_other_files,
      key_code_explanation = excluded.key_code_explanation,
      key_code_importance = excluded.key_code_importance,
      key_code_application = excluded.key_code_application,
      error_detail = excluded.error_detail,
      status = excluded.status,
      concept_tags = excluded.concept_tags,
      created_at = excluded.created_at
  `)

  const saveSteps = db.transaction((rows: StepRow[], skillLevel: SkillLevel) => {
    const now = new Date().toISOString()
    for (const row of rows) {
      upsertStep.run({
        id: randomUUID(),
        target_id: row.id,
        skill_level: skillLevel,
        content: row.summary,
        key_code_snippet: row.keyCodeSnippet,
        key_code_lang: row.keyCodeLang,
        key_code_file: row.keyCodeFile,
        key_code_other_files: row.keyCodeOtherFiles.length > 0 ? JSON.stringify(row.keyCodeOtherFiles) : null,
        key_code_explanation: row.keyCodeExplanation,
        key_code_importance: row.keyCodeImportance,
        key_code_application: row.keyCodeApplication,
        error_detail: row.errorDetail,
        status: row.status,
        concept_tags: JSON.stringify(row.conceptTags),
        created_at: now
      })
    }
  })

  let running = false
  const retryAfterByStep = new Map<string, number>()
  let geminiCooldownUntil = 0

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
      const completedPromptIds = new Set(
        (getCompletedPromptIds.all({ session_id: session.id }) as { id: string }[]).map((r) => r.id)
      )

      // 세션이 끝나지 않았으면 마지막 스텝은 "아직 진행 중"일 수 있어 요약 대상에서
      // 제외한다(유휴시간이 지나기 전엔 실제로 끝난 스텝인지 알 수 없다) — 단, Stop 훅이
      // 이미 그 턴을 완료 처리했으면(completedPromptIds) 유휴시간을 기다릴 필요 없이 바로
      // "끝난 스텝"으로 본다.
      const lastStep = steps[steps.length - 1]
      const lastStepTurnCompleted = lastStep?.promptId != null && completedPromptIds.has(lastStep.promptId)
      const inProgress =
        session.ended_at != null ||
        steps.length === 0 ||
        lastStepTurnCompleted ||
        isLastStepStale(lastStep, STEP_IDLE_GAP_MS)
          ? null
          : lastStep

      const summarized = new Set(
        (getSummarizedStepIds.all({ skill_level: skillLevel }) as { target_id: string }[]).map(
          (r) => r.target_id
        )
      )

      const eligible = steps
        .filter((step) => step.events.length > 0 && step !== inProgress && !summarized.has(step.id))
        .filter((step) => (retryAfterByStep.get(step.id) ?? 0) <= Date.now())
        .slice(0, STEP_BATCH_SIZE)

      if (eligible.length === 0) return
      if (Date.now() < geminiCooldownUntil) return

      const stepInputs: StepInput[] = eligible.map((step) => ({
        stepId: step.id,
        noteText: step.note?.text ?? null,
        events: step.events,
        codeCandidate: pickCodeCandidate(step.events)
      }))
      const candidateByStepId = new Map(stepInputs.map((s) => [s.stepId, s.codeCandidate]))

      try {
        const summaries = await aiProvider.summarizeSteps(stepInputs, skillLevel)
        const summarizedIds = new Set(summaries.map((s) => s.stepId))

        const rows: StepRow[] = summaries.map((item) => {
          const step = eligible.find((s) => s.id === item.stepId)!
          const candidate = candidateByStepId.get(item.stepId) ?? null
          return {
            id: item.stepId,
            status: stepStatus(step),
            summary: item.summary,
            keyCodeSnippet: candidate?.snippet ?? null,
            keyCodeLang: candidate?.lang ?? null,
            keyCodeFile: candidate?.filePath ?? null,
            keyCodeOtherFiles: candidate?.otherFiles ?? [],
            keyCodeExplanation: item.keyCode?.explanation ?? null,
            keyCodeImportance: item.keyCode?.importance ?? null,
            keyCodeApplication: item.keyCode?.application ?? null,
            errorDetail: errorDetailOf(step.events),
            conceptTags: item.keyCode?.conceptTags ?? []
          }
        })
        if (rows.length > 0) {
          saveSteps(rows, skillLevel)
          options.onExplanationSaved?.()
        }

        // AI가 이번 배치의 일부 스텝에 대해 응답을 안 준 경우(파싱 실패 등) 로컬
        // 폴백으로 채워 다음 틱에 무한 재시도하지 않게 한다.
        for (const step of eligible) {
          if (summarizedIds.has(step.id)) continue
          fallbackSave(step)
        }
      } catch (error) {
        console.error('[step-worker] failed to summarize steps:', error)
        if (isRateLimitError(error)) {
          geminiCooldownUntil = Date.now() + FAILURE_COOLDOWN_MS
        }
        // Gemini가 완전히 실패해도 로컬 폴백으로 진행 로그는 계속 채운다.
        for (const step of eligible) fallbackSave(step)
      }

      function fallbackSave(step: Step): void {
        retryAfterByStep.set(step.id, Date.now() + FAILURE_COOLDOWN_MS)
        const candidate = candidateByStepId.get(step.id) ?? null
        const status = stepStatus(step)
        saveSteps(
          [
            {
              id: step.id,
              status,
              summary: fallbackSummaryFromNote(step.note?.text),
              keyCodeSnippet: candidate?.snippet ?? null,
              keyCodeLang: candidate?.lang ?? null,
              keyCodeFile: candidate?.filePath ?? null,
              keyCodeOtherFiles: candidate?.otherFiles ?? [],
              keyCodeExplanation: candidate ? `${candidate.filePath}에서 코드가 바뀌었어요.` : null,
              keyCodeImportance: candidate
                ? status === 'failed'
                  ? '이 부분이 방금 실패의 원인이 된 지점이에요.'
                  : '앞으로 이 코드 형태를 다른 곳에서도 다시 쓰게 되니 기억해두세요.'
                : null,
              keyCodeApplication: candidate ? '비슷한 변경을 할 때 이 코드 형태를 참고해보세요.' : null,
              errorDetail: errorDetailOf(step.events),
              conceptTags: candidate ? [candidate.lang] : []
            }
          ],
          skillLevel
        )
        options.onExplanationSaved?.()
      }
    } catch (error) {
      console.error('[step-worker] tick failed:', error)
    } finally {
      running = false
    }
  }

  // "지금 하는 중" — Gemini 요약을 거치지 않는 로컬 규칙(최근 tool_event의 도구명+파일)만
  // 사용해 훨씬 빠른 주기로 갱신한다. 완료된 스텝(위 tick)과 달리 아직 유휴/개수 cap으로
  // 닫히지 않은 진행 중 스텝만 본다 — 세션 종료나 진행 중 스텝이 없으면 idle.
  const computeLiveStatus = (): LiveStatus => {
    const session = getLatestSession.get() as { id: string; ended_at: string | null } | undefined
    if (!session) return { text: '', idle: true }

    const events = getEventsBySession.all({ session_id: session.id }) as ToolEvent[]
    const notes = getNotesBySession.all({ session_id: session.id }) as AssistantNote[]
    const steps = groupIntoSteps(notes, events)
    const lastStep = steps[steps.length - 1]
    const completedPromptIds = new Set(
      (getCompletedPromptIds.all({ session_id: session.id }) as { id: string }[]).map((r) => r.id)
    )
    const lastStepTurnCompleted = lastStep?.promptId != null && completedPromptIds.has(lastStep.promptId)
    const inProgress =
      session.ended_at != null ||
      steps.length === 0 ||
      lastStepTurnCompleted ||
      isLastStepStale(lastStep, TURN_IDLE_GAP_MS)
        ? null
        : lastStep
    if (!inProgress) return { text: '', idle: true }

    const lastEvent = inProgress.events[inProgress.events.length - 1]
    if (lastEvent) {
      const target =
        lastEvent.file_path ??
        (() => {
          const argSummary = summarizeRawPayload(lastEvent.tool_name, lastEvent.raw_payload)
          return argSummary ? truncateForLiveStatus(argSummary) : '파일 미지정'
        })()
      return { text: `${lastEvent.tool_name} · ${target}`, idle: false }
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
      console.error('[step-worker] live-status tick failed:', error)
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
