import { useState } from 'react'
import type { QnaExchange } from '../hooks/useQna'

interface QnaChatProps {
  open: boolean
  onToggle: () => void
  exchanges: QnaExchange[]
  pending: boolean
  disabled: boolean
  onAsk: (question: string) => void
}

// SPEC 4.3.3 / 4.5 Q&A 챗 버튼: 헤더에서 여닫는 패널로 구현 — 트레이스/타임라인의
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
        className="qna-toggle"
        onClick={onToggle}
        disabled={disabled}
        title={disabled ? '세션이 있어야 질문할 수 있어요' : '진행 상황에 대해 질문하기'}
      >
        질문하기
      </button>
      {open && (
        <div className="qna-panel">
          <div className="qna-panel__history">
            {exchanges.length === 0 && (
              <div className="qna-panel__empty">지금까지의 진행 상황에 대해 무엇이든 물어보세요.</div>
            )}
            {exchanges.map((exchange) => (
              <div key={exchange.id} className="qna-exchange">
                <div className="qna-exchange__question">Q. {exchange.question}</div>
                <div className="qna-exchange__answer">{exchange.answer}</div>
              </div>
            ))}
            {pending && <div className="qna-panel__pending">답변 생성 중…</div>}
          </div>
          <div className="qna-panel__input-row">
            <input
              className="qna-panel__input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit()
              }}
              placeholder="예: 지금까지 뭘 했는지 요약해줘"
              disabled={pending}
            />
            <button type="button" onClick={submit} disabled={pending || !draft.trim()}>
              보내기
            </button>
          </div>
        </div>
      )}
    </>
  )
}
