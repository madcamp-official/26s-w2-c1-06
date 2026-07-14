import { ChevronDown, ListTodo } from 'lucide-react'
import type { Prompt } from '@shared/types'

interface SessionContextBarProps {
  prompts: Prompt[]
}

// SPEC 5장 Level 0: 세션/목표 컨텍스트. 개별 액션이 "왜 되는지" 항상 해석
// 가능하게 하는 최상위 앵커. 히어로 아래에 계획(plan_text)만 접이식으로 노출한다
// (현재 요청/턴 진행률은 히어로 헤딩이 이미 보여줌).
export function SessionContextBar({ prompts }: SessionContextBarProps) {
  if (prompts.length === 0) return null

  const currentTurn = prompts[prompts.length - 1]
  if (!currentTurn.plan_text) return null

  return (
    <details className="group mb-4 overflow-hidden rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[12px] text-[#9db0ba] transition hover:bg-[#141f28] [&::-webkit-details-marker]:hidden">
        <ListTodo size={14} className="text-[#8cc8e6]" />
        <span className="font-medium text-[#c3d2da]">이번 턴의 계획</span>
        <span className="font-mono text-[10px] text-[#5f7682]">PLAN · TURN {currentTurn.turn_index + 1}</span>
        <ChevronDown size={14} className="ml-auto text-[#5f7682] transition group-open:rotate-180" />
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border bg-[#0d151c] px-4 py-3 font-mono text-[11px] leading-6 text-[#a9bdc7]">
        {currentTurn.plan_text}
      </pre>
    </details>
  )
}
