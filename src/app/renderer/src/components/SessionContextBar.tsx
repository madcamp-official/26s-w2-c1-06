import { ChevronDown, ListTodo } from 'lucide-react'
import type { Prompt } from '@shared/types'

interface SessionContextBarProps {
  prompts: Prompt[]
}

// SPEC 5장 Level 0: 세션/목표 컨텍스트. 개별 액션이 "왜 되는지" 항상 해석
// 가능하게 하는 최상위 앵커. 히어로 아래에 계획(plan_text)만 접이식으로 노출한다
// (현재 요청/프롬프트 진행률은 히어로 헤딩이 이미 보여줌).
export function SessionContextBar({ prompts }: SessionContextBarProps) {
  if (prompts.length === 0) return null

  const currentTurn = prompts[prompts.length - 1]
  if (!currentTurn.plan_text) return null

  return (
    <details className="group mb-4 overflow-hidden rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[12px] text-[#6d7069] transition hover:bg-[#f1f0eb] [&::-webkit-details-marker]:hidden">
        <ListTodo size={14} className="text-[#5b8fae]" />
        <span className="font-medium text-[#373832]">이번 프롬프트의 계획</span>
        <span className="font-mono text-[10px] text-[#6d7069]">PLAN · PROMPT {currentTurn.turn_index + 1}</span>
        <ChevronDown size={14} className="ml-auto text-[#6d7069] transition group-open:rotate-180" />
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border bg-[#f6f5f1] px-4 py-3 font-mono text-[11px] leading-6 text-[#3f514c]">
        {currentTurn.plan_text}
      </pre>
    </details>
  )
}
