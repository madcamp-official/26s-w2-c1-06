import type { AiExplanation, AssistantNote, Prompt, ToolEvent } from '@shared/types'
import { parseConceptTags, parseStepExplanation } from '@shared/format'
import { groupIntoSteps } from '@shared/steps'

interface SessionContextBarProps {
  prompts: Prompt[]
  notes: AssistantNote[]
  events: ToolEvent[]
  stepExplanations: Map<string, AiExplanation>
}

// SPEC 5장 Level 0: 세션/목표 컨텍스트. 개별 액션이 "왜 되는지" 항상 해석
// 가능하게 하는 최상위 앵커라서 화면 상단에 고정 표시한다.
// AI 추가 호출 없이 최신 스텝 캡션(title)을 재사용해 "지금 배우는 것"을 보여준다.
export function SessionContextBar({
  prompts,
  notes,
  events,
  stepExplanations
}: SessionContextBarProps) {
  if (prompts.length === 0 && notes.length === 0 && events.length === 0) return null

  const currentTurn = prompts.length > 0 ? prompts[prompts.length - 1] : null
  const steps = groupIntoSteps(notes, events)

  let learningTitle = ''
  let learningTags: string[] = []
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]
    if (!step.id) continue
    const explanation = stepExplanations.get(step.id)
    if (!explanation) continue
    const parsed = parseStepExplanation(explanation.content)
    if (parsed.title || parsed.body) {
      learningTitle = parsed.title || parsed.body.slice(0, 40)
      learningTags = parseConceptTags(explanation.concept_tags).slice(0, 3)
      break
    }
  }

  if (!learningTitle && currentTurn?.plan_text) {
    learningTitle = currentTurn.plan_text.split('\n')[0].slice(0, 60)
  }
  if (!learningTitle && currentTurn?.user_text) {
    learningTitle = currentTurn.user_text.slice(0, 60)
  }
  if (!learningTitle) {
    learningTitle = '세션 진행 중'
  }

  return (
    <div className="context-bar">
      <div className="context-bar__row">
        <span className="context-bar__label">지금</span>
        <span className="context-bar__learning">
          {learningTitle}
          {learningTags.map((tag) => (
            <span key={tag} className="context-bar__tag">
              {tag}
            </span>
          ))}
        </span>
      </div>
      {currentTurn && (
        <div className="context-bar__row">
          <span className="context-bar__label">요청</span>
          <span className="context-bar__text">
            <span className="context-bar__progress">
              {currentTurn.turn_index + 1}/{prompts.length}
            </span>{' '}
            {currentTurn.user_text ?? '—'}
          </span>
        </div>
      )}
    </div>
  )
}
