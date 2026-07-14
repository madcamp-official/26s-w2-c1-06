import { useState } from 'react'
import { MessageCircleQuestion, SendHorizontal, X } from 'lucide-react'
import type { QnaExchange } from '../hooks/useQna'

interface QnaChatProps {
  open: boolean
  onToggle: () => void
  exchanges: QnaExchange[]
  pending: boolean
  disabled: boolean
  onAsk: (question: string) => void
}

// SPEC 4.3.3 / 4.5 Q&A 챗 버튼: 헤더에서 여닫는 플로팅 패널로 구현 — 트레이스/타임라인의
// "임의 지점"별 배치 대신 세션 전체 컨텍스트(session-trace.ts의 ContextBundle)로
// 단순화했다 (MVP 범위, 특정 항목에 질문을 고정하는 건 로드맵).
export function QnaChat({ open, onToggle, exchanges, pending, disabled, onAsk }: QnaChatProps) {
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    if (!draft.trim() || pending) return
    onAsk(draft.trim())
    setDraft('')
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        title={disabled ? '세션이 있어야 질문할 수 있어요' : '진행 상황에 대해 질문하기'}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] transition disabled:opacity-40 ${
          open
            ? 'border-[#326055] bg-[#11231f] text-[#c7f5e0]'
            : 'border-border bg-[#111b24] text-[#bdd0d8] hover:bg-[#1b2a33]'
        }`}
      >
        <MessageCircleQuestion size={14} className={open ? 'text-[#8ee4c0]' : undefined} />
        질문하기
      </button>

      {open && (
        <div className="fixed right-4 top-[80px] z-40 flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-[0_24px_60px_rgba(0,0,0,.4)]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-[13px] font-semibold">세션 Q&amp;A</h3>
              <p className="font-mono text-[10px] text-[#75909a]">ASK ABOUT THIS SESSION</p>
            </div>
            <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {exchanges.length === 0 && (
              <p className="py-6 text-center text-[12px] leading-6 text-[#7d93a0]">
                지금까지의 진행 상황에 대해
                <br />
                무엇이든 물어보세요.
              </p>
            )}
            {exchanges.map((exchange) => (
              <div key={exchange.id} className="space-y-2">
                <div className="ml-8 rounded-lg rounded-tr-sm bg-[#1e3540] px-3 py-2 text-[12px] leading-5 text-[#d5ece2]">
                  {exchange.question}
                </div>
                <div className="mr-4 rounded-lg rounded-tl-sm border border-border bg-[#121d25] px-3 py-2 text-[12px] leading-6 text-[#b9cad3]">
                  {exchange.answer}
                </div>
              </div>
            ))}
            {pending && (
              <div className="mr-4 rounded-lg border border-border bg-[#121d25] px-3 py-2 font-mono text-[11px] text-[#8fc9ae]">
                답변 생성 중…
              </div>
            )}
          </div>

          <div className="flex gap-2 border-t border-border p-3">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
              placeholder="예: 지금까지 뭘 했는지 요약해줘"
              disabled={pending}
              className="min-w-0 flex-1 rounded-lg border border-border bg-input-background px-3 py-2 text-[12px] text-foreground placeholder:text-[#5f7682] focus:outline-none focus:ring-1 focus:ring-ring/60"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending || !draft.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#9fe2c4] text-[#0b2219] transition hover:bg-[#b4edcf] disabled:opacity-40"
            >
              <SendHorizontal size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
