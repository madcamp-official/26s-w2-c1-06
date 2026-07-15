import { ChevronDown, ListTodo } from 'lucide-react'
import Markdown from 'react-markdown'
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
  // TodoWrite가 없으면 plan_text는 AI가 pending_plan_source_text(의도 선언문)를
  // 단계별 계획으로 정리할 때까지 비어있다(caption-worker.ts의 plan-worker 블록 참조) —
  // 둘 다 없으면 이 턴은 아직 계획으로 삼을 만한 게 아무것도 안 왔다는 뜻이라 숨긴다.
  if (!currentTurn.plan_text && !currentTurn.pending_plan_source_text) return null

  return (
    <details className="group mb-4 overflow-hidden rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[12px] text-[#6d7069] transition hover:bg-[#f1f0eb] [&::-webkit-details-marker]:hidden">
        <ListTodo size={14} className="text-[#5b8fae]" />
        <span className="font-medium text-[#373832]">이번 프롬프트의 계획</span>
        {/* currentTurn.turn_index가 아니라 prompts.length를 쓴다 — turn_index는 "완료 →
            시작하기"로 재개된 세션마다 0부터 다시 세는 DB 카운터라, 재개 직후 첫 프롬프트도
            "PROMPT 1"로 잘못 표시된다. prompts는 재개 사슬 전체를 시간순으로 담고 있으므로
            (main/index.ts getPromptsBySession), 마지막 원소의 실제 순번은 배열 길이 그대로다. */}
        <span className="font-mono text-[10px] text-[#6d7069]">PLAN · PROMPT {prompts.length}</span>
        <ChevronDown size={14} className="ml-auto text-[#6d7069] transition group-open:rotate-180" />
      </summary>
      <div className="markdown-body border-t border-border bg-[#f6f5f1] px-4 py-3">
        {currentTurn.plan_text ? (
          <Markdown>{currentTurn.plan_text}</Markdown>
        ) : (
          <span className="font-mono text-[12px] text-[#3c7566]">계획 정리 중…</span>
        )}
      </div>
    </details>
  )
}
