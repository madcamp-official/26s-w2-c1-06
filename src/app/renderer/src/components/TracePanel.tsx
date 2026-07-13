import type { AiExplanation, AssistantNote, Prompt, ToolEvent, ToolStatus } from '@shared/types'
import { formatDuration, formatTime, parseConceptTags } from '@shared/format'
import { groupIntoSteps, type Step } from '@shared/steps'

interface TracePanelProps {
  prompts: Prompt[]
  events: ToolEvent[]
  notes: AssistantNote[]
  explanations: Map<string, AiExplanation>
  stepExplanations: Map<string, AiExplanation>
  loading: boolean
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

// 학습 파이프라인 4단계: 스텝을 턴(prompt)별로 묶어 "이 스텝이 어느 요청에서
// 나왔는지"를 헤더로 보여준다. 턴 순서는 turn_index 순(= prompts 정렬 순),
// prompt_id 없는 스텝(수동 수정 등)은 맨 뒤 orphan 그룹.
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

interface EventRowProps {
  event: ToolEvent
  explanation: AiExplanation | undefined
}

// 개별 이벤트 캡션은 4단계 이후 자동생성하지 않는다(스텝 요약이 1차 설명). 대신
// 원시 데이터 + 실패 시 실제 에러 메시지(1단계 result_content)를 드릴다운으로 보여준다.
function EventRow({ event, explanation }: EventRowProps) {
  return (
    <li className={`trace-item trace-item--${event.status}`}>
      <div className="trace-item__row">
        <span className="trace-item__time">{formatTime(event.created_at)}</span>
        <span className="trace-item__tool">{event.tool_name}</span>
        <span className="trace-item__file">{event.file_path ?? '—'}</span>
        <span className="trace-item__duration">{formatDuration(event.duration_ms)}</span>
        <span className="trace-item__status">{STATUS_LABEL[event.status]}</span>
        {event.source === 'manual' && <span className="trace-item__badge">manual</span>}
      </div>
      {event.status === 'error' && event.result_content && (
        <pre className="trace-item__error">{event.result_content}</pre>
      )}
      {explanation && (
        <div className="trace-item__caption">
          <span className="trace-item__caption-text">{explanation.content}</span>
          {parseConceptTags(explanation.concept_tags).map((tag) => (
            <span key={tag} className="trace-item__tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}

interface StepBlockProps {
  step: Step
  summary: AiExplanation | undefined
  explanations: Map<string, AiExplanation>
}

function StepBlock({ step, summary, explanations }: StepBlockProps) {
  const eventList = (
    <ul className="trace-step__events">
      {step.events.map((event) => (
        <EventRow key={event.id} event={event} explanation={explanations.get(event.id)} />
      ))}
    </ul>
  )

  // 액션이 있는 note-led 스텝에만 요약을 보여준다 — 액션 0개(순수 맺음말)는
  // note 텍스트 자체가 내용이라 워커가 요약을 생성하지 않는다(영구 pending 방지).
  const showSummary = step.id !== null && step.events.length > 0

  return (
    <li className="trace-step">
      {step.note && <p className="trace-note">{step.note.text}</p>}

      {showSummary &&
        (summary ? (
          <div className="trace-step__summary">
            <span className="trace-step__summary-text">{summary.content}</span>
            {parseConceptTags(summary.concept_tags).map((tag) => (
              <span key={tag} className="trace-item__tag">
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <div className="trace-step__summary trace-step__summary--pending">요약 생성 중…</div>
        ))}

      {step.events.length > 0 &&
        (summary ? (
          // 요약이 있으면 세부 동작은 접어둔다(요약 먼저 읽고 필요할 때 펼침 = 페이싱).
          <details className="trace-step__details">
            <summary className="trace-step__details-toggle">세부 동작 {step.events.length}개</summary>
            {eventList}
          </details>
        ) : (
          // 요약 대기 중이거나 note 없는 스텝이면 원시 액션을 바로 보여준다.
          eventList
        ))}
    </li>
  )
}

export function TracePanel({
  prompts,
  events,
  notes,
  explanations,
  stepExplanations,
  loading
}: TracePanelProps) {
  if (loading) {
    return <div className="trace-panel trace-panel--empty">세션을 불러오는 중…</div>
  }

  if (events.length === 0) {
    return (
      <div className="trace-panel trace-panel--empty">
        표시할 tool_event가 없습니다. `npm run db:init && npm run db:seed`를 실행했는지 확인하세요.
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
                <span className="trace-turn__index">turn {turn.prompt.turn_index + 1}</span>
                <span className="trace-turn__text">{turn.prompt.user_text ?? '—'}</span>
              </>
            ) : (
              <span className="trace-turn__text">연결된 요청 없음 (수동 수정 등)</span>
            )}
          </h3>
          <ul className="trace-turn__steps">
            {turn.steps.map((step, i) => (
              <StepBlock
                key={step.id ?? `${turn.prompt?.id ?? 'orphan'}:lead:${i}`}
                step={step}
                summary={step.id ? stepExplanations.get(step.id) : undefined}
                explanations={explanations}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
