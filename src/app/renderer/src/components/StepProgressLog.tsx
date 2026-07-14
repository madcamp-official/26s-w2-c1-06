import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { StepWithExplanation } from '@shared/types'
import { formatTime, parseConceptTags } from '@shared/format'

interface StepProgressLogProps {
  steps: StepWithExplanation[]
}

// 활동 탭 "바뀐 구조와 변경사항"의 실시간 진행 로그: 턴이 끝나길 기다리는 기존
// TurnChanges(코드 유닛 diff)와 달리, 턴 진행 중에도 유휴시간/이벤트 개수로 나뉜
// "스텝"이 끝나는 족족 카드가 하나씩 늘어난다. 각 카드는 결정론적으로 뽑힌 실제
// 코드 스니펫 + AI가 채운 설명/중요도/학습포인트 3줄을 보여준다.
export function StepProgressLog({ steps }: StepProgressLogProps) {
  if (steps.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">
        이 프롬프트에서는 아직 진행 로그가 없어요.
      </p>
    )
  }

  return (
    <ol className="space-y-2.5">
      {steps.map((step) => {
        const explanation = step.explanation
        const failed = explanation?.status === 'failed'
        const otherFiles = explanation?.key_code_other_files
          ? parseConceptTags(explanation.key_code_other_files)
          : []
        const conceptTags = explanation?.concept_tags ? parseConceptTags(explanation.concept_tags) : []

        return (
          <li
            key={step.stepId}
            className={`rounded-xl border p-3.5 ${
              failed ? 'border-[#f0cec8] bg-[#fdf4f2]' : 'border-border bg-[#f6f5f1]'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {step.inProgress ? (
                <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-[#3c7566]" />
              ) : failed ? (
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#c65c52]" />
              ) : (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#3c7566]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] leading-relaxed text-[#21221f]">
                    {step.inProgress
                      ? '진행 중…'
                      : (explanation?.content ?? (
                          <span className="font-mono text-[11px] text-[#3c7566]">요약 생성 중…</span>
                        ))}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-[#9a9a92]">
                    {formatTime(step.startedAt)}
                  </span>
                </div>

                {explanation?.key_code_snippet && (
                  <div className="mt-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-[#6d7069]">
                      <span className="truncate">{explanation.key_code_file}</span>
                      {otherFiles.length > 0 && (
                        <span className="text-[#9a9a92]">외 {otherFiles.length}개 파일</span>
                      )}
                    </div>
                    <pre className="mt-1.5 overflow-x-auto rounded-lg border border-[#e6e4dd] bg-white p-3 font-mono text-[10.5px] leading-5 text-[#3f514c]">
                      {explanation.key_code_snippet}
                    </pre>
                    <div className="mt-2 space-y-1 text-[11.5px] leading-relaxed text-[#3f514c]">
                      {explanation.key_code_explanation && <p>{explanation.key_code_explanation}</p>}
                      {explanation.key_code_importance && (
                        <p className="text-[#6d7069]">💡 {explanation.key_code_importance}</p>
                      )}
                      {explanation.key_code_application && (
                        <p className="text-[#3c7566]">📌 {explanation.key_code_application}</p>
                      )}
                    </div>
                    {conceptTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {conceptTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-[#cfe3d8] bg-[#eef6f1] px-2 py-0.5 font-mono text-[10px] text-[#3c7566]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {failed && explanation?.error_detail && (
                  <details className="group mt-2.5">
                    <summary className="cursor-pointer list-none font-mono text-[10px] tracking-[0.08em] text-[#c65c52] transition hover:text-[#a3453a] [&::-webkit-details-marker]:hidden">
                      ▸ 에러 원문 보기
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg border border-[#f0cec8] bg-white p-3 font-mono text-[10.5px] leading-5 text-[#a3453a]">
                      {explanation.error_detail}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
