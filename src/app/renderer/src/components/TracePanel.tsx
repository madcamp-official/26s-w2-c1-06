import type { AiExplanation, Prompt, ToolEvent, ToolStatus } from '@shared/types'
import { formatDuration, formatTime, parseConceptTags } from '@shared/format'

interface TracePanelProps {
  prompts: Prompt[]
  events: ToolEvent[]
  explanations: Map<string, AiExplanation>
  loading: boolean
}

interface TurnGroup {
  prompt: Prompt | null
  events: ToolEvent[]
}

const STATUS_LABEL: Record<ToolStatus, string> = {
  pending: '진행 중',
  success: '성공',
  error: '실패'
}

// SPEC 5장 Level 2: tool_events를 턴(prompt) 단위로 묶어 "이 액션이 어느
// 요청/계획에서 나왔는지"를 항상 같이 보여준다. prompt_id가 없는(=fallback
// manual 수정 등, SPEC 4.1) 이벤트는 별도 그룹으로 맨 뒤에 모은다.
function groupByTurn(prompts: Prompt[], events: ToolEvent[]): TurnGroup[] {
  const promptIds = new Set(prompts.map((prompt) => prompt.id))
  const eventsByPrompt = new Map<string, ToolEvent[]>()
  const orphanEvents: ToolEvent[] = []

  for (const event of events) {
    if (event.prompt_id && promptIds.has(event.prompt_id)) {
      const bucket = eventsByPrompt.get(event.prompt_id) ?? []
      bucket.push(event)
      eventsByPrompt.set(event.prompt_id, bucket)
    } else {
      orphanEvents.push(event)
    }
  }

  const groups: TurnGroup[] = prompts.map((prompt) => ({
    prompt,
    events: eventsByPrompt.get(prompt.id) ?? []
  }))

  if (orphanEvents.length > 0) {
    groups.push({ prompt: null, events: orphanEvents })
  }

  return groups
}

export function TracePanel({ prompts, events, explanations, loading }: TracePanelProps) {
  if (loading) {
    return <div className="trace-panel trace-panel--empty">세션을 불러오는 중…</div>
  }

  if (events.length === 0) {
    return (
      <div className="trace-panel trace-panel--empty">
        아직 표시할 활동이 없습니다. 헤더의 &quot;시작하기&quot;를 눌러 모니터링을 시작하세요
        (개발용 목업 데이터가 필요하면 `npm run db:init && npm run db:seed`).
      </div>
    )
  }

  const turns = groupByTurn(prompts, events).filter((turn) => turn.events.length > 0)

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
          <ul className="trace-turn__events">
            {turn.events.map((event) => {
              const explanation = explanations.get(event.id)
              return (
                <li key={event.id} className={`trace-item trace-item--${event.status}`}>
                  <div className="trace-item__row">
                    <span className="trace-item__time">{formatTime(event.created_at)}</span>
                    <span className="trace-item__tool">{event.tool_name}</span>
                    <span className="trace-item__file">{event.file_path ?? '—'}</span>
                    <span className="trace-item__duration">{formatDuration(event.duration_ms)}</span>
                    <span className="trace-item__status">{STATUS_LABEL[event.status]}</span>
                    {event.source === 'manual' && <span className="trace-item__badge">manual</span>}
                  </div>
                  <div className="trace-item__caption">
                    {explanation ? (
                      <>
                        <span className="trace-item__caption-text">{explanation.content}</span>
                        {parseConceptTags(explanation.concept_tags).map((tag) => (
                          <span key={tag} className="trace-item__tag">
                            {tag}
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="trace-item__caption-text trace-item__caption-text--pending">
                        해설 생성 중…
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
