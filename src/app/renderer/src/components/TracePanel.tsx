import type { AssistantNote, Prompt, ToolEvent, ToolStatus } from '@shared/types'
import { formatDuration, formatTime, truncateText } from '@shared/format'
import { elapsedMinutes, formatElapsedMinutes } from '@shared/match'
import { groupIntoSteps, type Step } from '@shared/steps'

interface TracePanelProps {
  prompts: Prompt[]
  events: ToolEvent[]
  notes: AssistantNote[]
  loading: boolean
  sessionStartedAt?: string | null
  createdEventIds?: Set<string>
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

function stepBadge(
  step: Step,
  createdEventIds: Set<string> | undefined
): { kind: 'new' | 'warn' | 'default'; label: string } {
  if (step.events.some((e) => e.status === 'error')) return { kind: 'warn', label: 'WARN' }
  if (createdEventIds && step.events.some((e) => createdEventIds.has(e.id))) {
    return { kind: 'new', label: 'NEW' }
  }
  return { kind: 'default', label: '' }
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
  sessionStartedAt?: string | null
  createdEventIds?: Set<string>
}

// 원시 트레이스 로그 — AI 요약/핵심 코드는 ProgressTurtleBar+StepLog(진행상황 패널)가
// 전담한다. 여기서는 실제로 일어난 일(시각/도구/상태/에이전트 원문)만 보여준다.
function StepBlock({ step, sessionStartedAt, createdEventIds }: StepBlockProps) {
  const title = step.note
    ? truncateText(step.note.text.replace(/\s+/g, ' ').trim(), 40)
    : '진행 중'
  const minute = elapsedMinutes(
    sessionStartedAt,
    step.note?.created_at ?? step.events[0]?.created_at ?? null
  )
  const badge = stepBadge(step, createdEventIds)

  const eventList =
    step.events.length > 0 ? (
      <ul className="trace-step__events">
        {step.events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ul>
    ) : null

  return (
    <li className={`trace-step match-event match-event--${badge.kind}`}>
      <div className="match-event__meta">
        <span className="match-event__minute">{formatElapsedMinutes(minute)}</span>
        {badge.label && (
          <span className={`match-event__badge match-event__badge--${badge.kind}`}>{badge.label}</span>
        )}
      </div>
      <div className="match-event__body">
        <h4 className="trace-step__title">{title}</h4>

        {step.note && <p className="trace-step__body">{step.note.text}</p>}

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
  loading,
  sessionStartedAt,
  createdEventIds
}: TracePanelProps) {
  if (loading) {
    return <div className="trace-panel trace-panel--empty">불러오는 중…</div>
  }

  if (events.length === 0 && notes.length === 0) {
    return (
      <div className="trace-panel trace-panel--empty">
        아직 이벤트가 없습니다. 에이전트 세션이 시작되면 여기에 표시됩니다.
      </div>
    )
  }

  const steps = groupIntoSteps(notes, events)
  const turns = groupStepsByTurn(prompts, steps)

  return (
    <div className="trace-panel">
      {turns.map((turn) => (
        <section key={turn.prompt?.id ?? 'orphan'} className="trace-turn">
          <h3 className="trace-turn__header">
            {turn.prompt ? (
              <>
                <span className="trace-turn__index">요청 {turn.prompt.turn_index + 1}</span>
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
                sessionStartedAt={sessionStartedAt}
                createdEventIds={createdEventIds}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
