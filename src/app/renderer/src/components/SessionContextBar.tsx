import type { Prompt } from '@shared/types'

interface SessionContextBarProps {
  prompts: Prompt[]
}

// SPEC 5장 Level 0: 세션/목표 컨텍스트. 개별 액션이 "왜 되는지" 항상 해석
// 가능하게 하는 최상위 앵커라서 화면 상단에 고정 표시한다.
export function SessionContextBar({ prompts }: SessionContextBarProps) {
  if (prompts.length === 0) return null

  const currentTurn = prompts[prompts.length - 1]

  return (
    <div className="context-bar">
      <div className="context-bar__row">
        <span className="context-bar__label">진행률</span>
        <span className="context-bar__progress">
          turn {currentTurn.turn_index + 1} / {prompts.length}
        </span>
      </div>
      <div className="context-bar__row">
        <span className="context-bar__label">요청</span>
        <span className="context-bar__text">{currentTurn.user_text ?? '—'}</span>
      </div>
      {currentTurn.plan_text && (
        <div className="context-bar__row context-bar__row--plan">
          <span className="context-bar__label">계획</span>
          <pre className="context-bar__plan">{currentTurn.plan_text}</pre>
        </div>
      )}
    </div>
  )
}
