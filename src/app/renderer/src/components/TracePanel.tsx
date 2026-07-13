import type { AiExplanation, AssistantNote, Prompt, ToolEvent, ToolStatus } from '@shared/types'
import {
  formatDuration,
  formatTime,
  parseConceptTags,
  parseStepExplanation,
  truncateText
} from '@shared/format'
import { formatMatchMinute, matchMinute } from '@shared/match'
import { groupIntoSteps, type Step } from '@shared/steps'

interface TracePanelProps {
  prompts: Prompt[]
  events: ToolEvent[]
  notes: AssistantNote[]
  stepExplanations: Map<string, AiExplanation>
  loading: boolean
  sessionStartedAt?: string | null
  createdEventIds?: Set<string>
  onConceptClick?: (tag: string) => void
  /** 지금 캐스터 음성이 낭독 중인 stepId — 해당 스텝 카드를 강조 표시. */
  speakingStepId?: string | null
}

interface TurnGroup {
  prompt: Prompt | null
  steps: Step[]
}

const STATUS_LABEL: Record<ToolStatus, string> = {
  pending: '진행 중',
  success: '성공',
  error: '실패'
}

function groupStepsByTurn(prompts: Prompt[], steps: Step[]): TurnGroup[] {
  const stepsByPrompt = new Map<string, Step[]>()
  const orphanSteps: Step[] = []

  for (const step of steps) {
    if (step.promptId) {
      const bucket = stepsByPrompt.get(step.promptId) ?? []
      bucket.push(step)
      stepsByPrompt.set(step.promptId, bucket)
    } else {
      orphanSteps.push(step)
    }
  }

  const groups: TurnGroup[] = prompts.map((prompt) => ({
    prompt,
    steps: stepsByPrompt.get(prompt.id) ?? []
  }))
  if (orphanSteps.length > 0) groups.push({ prompt: null, steps: orphanSteps })

  return groups.filter((group) => group.steps.length > 0)
}

function turnLearningTitle(steps: Step[], stepExplanations: Map<string, AiExplanation>): string | null {
  for (const step of steps) {
    if (!step.id) continue
    const summary = stepExplanations.get(step.id)
    if (!summary) continue
    const title = parseStepExplanation(summary.content).title
    if (title) return title
  }
  return null
}

function stepBadge(
  step: Step,
  createdEventIds: Set<string> | undefined
): { kind: 'new' | 'warn' | 'play'; label: string } {
  if (step.events.some((e) => e.status === 'error')) return { kind: 'warn', label: 'WARN' }
  if (createdEventIds && step.events.some((e) => createdEventIds.has(e.id))) {
    return { kind: 'new', label: 'NEW' }
  }
  return { kind: 'play', label: 'PLAY' }
}

interface EventRowProps {
  event: ToolEvent
}

function EventRow({ event }: EventRowProps) {
  return (
    <li className={`trace-item trace-item--${event.status}`}>
      <div className="trace-item__row">
        <span className="trace-item__tool">{event.tool_name}</span>
        <span className="trace-item__file">{event.file_path ?? '—'}</span>
        <span className="trace-item__status">{STATUS_LABEL[event.status]}</span>
        <span className="trace-item__duration">{formatDuration(event.duration_ms)}</span>
        <span className="trace-item__time">{formatTime(event.created_at)}</span>
        {event.source === 'manual' && <span className="trace-item__badge">manual</span>}
      </div>
      {event.status === 'error' && event.result_content && (
        <pre className="trace-item__error">{event.result_content}</pre>
      )}
    </li>
  )
}

interface StepBlockProps {
  step: Step
  summary: AiExplanation | undefined
  sessionStartedAt?: string | null
  createdEventIds?: Set<string>
  onConceptClick?: (tag: string) => void
  speaking?: boolean
}

function StepBlock({
  step,
  summary,
  sessionStartedAt,
  createdEventIds,
  onConceptClick,
  speaking
}: StepBlockProps) {
  const parsed = summary ? parseStepExplanation(summary.content) : null
  const tags = summary ? parseConceptTags(summary.concept_tags) : []
  const fallbackTitle = step.note
    ? truncateText(step.note.text.replace(/\s+/g, ' ').trim(), 40)
    : '플레이 진행 중'
  const title = parsed?.title || fallbackTitle
  const minute = matchMinute(
    sessionStartedAt,
    step.note?.created_at ?? step.events[0]?.created_at ?? null
  )
  const badge = stepBadge(step, createdEventIds)
  const expectsSummary = step.id !== null && step.events.length > 0

  const eventList =
    step.events.length > 0 ? (
      <ul className="trace-step__events">
        {step.events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ul>
    ) : null

  return (
    <li
      className={`trace-step match-event match-event--${badge.kind} ${
        speaking ? 'match-event--speaking' : ''
      }`}
    >
      <div className="match-event__meta">
        <span className="match-event__minute">{formatMatchMinute(minute)}</span>
        <span className={`match-event__badge match-event__badge--${badge.kind}`}>{badge.label}</span>
        {speaking && <span className="match-event__onair">🔊</span>}
      </div>
      <div className="match-event__body">
        <h4 className="trace-step__title">{title}</h4>

        {expectsSummary ? (
          parsed && parsed.body ? (
            <div className="trace-step__summary">
              <p className="trace-step__body">{parsed.body}</p>
              {parsed.why && (
                <p className="trace-step__why">
                  <span className="trace-step__why-label">왜</span>
                  {parsed.why}
                </p>
              )}
              {tags.length > 0 && (
                <div className="trace-step__tags">
                  {tags.map((tag) =>
                    onConceptClick ? (
                      <button
                        key={tag}
                        type="button"
                        className="trace-item__tag trace-item__tag--clickable"
                        onClick={() => onConceptClick(tag)}
                      >
                        {tag}
                      </button>
                    ) : (
                      <span key={tag} className="trace-item__tag">
                        {tag}
                      </span>
                    )
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="trace-step__summary trace-step__summary--pending">중계 준비 중…</div>
          )
        ) : (
          step.note && <p className="trace-step__body">{step.note.text}</p>
        )}

        {step.note && expectsSummary && (
          <details className="trace-step__details">
            <summary className="trace-step__details-toggle">에이전트 원문</summary>
            <p className="trace-note">{step.note.text}</p>
          </details>
        )}

        {eventList && (
          <details className="trace-step__details">
            <summary className="trace-step__details-toggle">세부 동작 {step.events.length}개</summary>
            {eventList}
          </details>
        )}
      </div>
    </li>
  )
}

export function TracePanel({
  prompts,
  events,
  notes,
  stepExplanations,
  loading,
  sessionStartedAt,
  createdEventIds,
  onConceptClick,
  speakingStepId
}: TracePanelProps) {
  if (loading) {
    return <div className="trace-panel trace-panel--empty">경기를 불러오는 중…</div>
  }

  if (events.length === 0 && notes.length === 0) {
    return (
      <div className="trace-panel trace-panel--empty">
        아직 라이브 이벤트가 없습니다. 에이전트 세션이 시작되면 중계가 뜹니다.
      </div>
    )
  }

  const steps = groupIntoSteps(notes, events)
  const turns = groupStepsByTurn(prompts, steps)

  return (
    <div className="trace-panel">
      {turns.map((turn) => {
        const learningTitle = turnLearningTitle(turn.steps, stepExplanations)
        return (
          <section key={turn.prompt?.id ?? 'orphan'} className="trace-turn">
            <h3 className="trace-turn__header">
              {turn.prompt ? (
                <>
                  <span className="trace-turn__index">구간 {turn.prompt.turn_index + 1}</span>
                  {learningTitle && <span className="trace-turn__learning">{learningTitle}</span>}
                  <span className="trace-turn__text">{turn.prompt.user_text ?? '—'}</span>
                </>
              ) : (
                <span className="trace-turn__text">연결된 지시 없음 (수동 수정 등)</span>
              )}
            </h3>
            <ul className="trace-turn__steps">
              {turn.steps.map((step, i) => (
                <StepBlock
                  key={step.id ?? `${turn.prompt?.id ?? 'orphan'}:lead:${i}`}
                  step={step}
                  summary={step.id ? stepExplanations.get(step.id) : undefined}
                  sessionStartedAt={sessionStartedAt}
                  createdEventIds={createdEventIds}
                  onConceptClick={onConceptClick}
                  speaking={step.id !== null && step.id === speakingStepId}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
