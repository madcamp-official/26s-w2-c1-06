import { useEffect, useRef, useState } from 'react'
import type { ProgressLogEntry } from '../hooks/useProgress'

interface StepLogProps {
  history: ProgressLogEntry[]
  // 코드 구조도에서 노드를 클릭했을 때 그 노드의 최신 버전을 만든 스텝 id가 내려온다 —
  // 목록에 있으면 그 카드로 스크롤 이동 + 잠깐 하이라이트한다(SPEC 패치 v2 #6).
  highlightStepId?: string | null
}

const VISIBLE_COUNT = 6
const HIGHLIGHT_HOLD_MS = 1500

function truncateLines(text: string, max: number): string {
  const lines = text.split('\n')
  if (lines.length <= max) return text
  return lines.slice(0, max).join('\n') + '\n…'
}

// 거북이 진행바 옆에 붙는 로그 — 방금 한 일 한 줄 + (있으면) 지금 봐두면 좋은
// 핵심 코드. 길게 설명하지 않는다: 카드 하나는 항상 짧아야 한다(SPEC 주의사항).
export function StepLog({ history, highlightStepId }: StepLogProps) {
  const [expanded, setExpanded] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLLIElement>())

  useEffect(() => {
    if (!highlightStepId) return
    // 접힌 상태에서 카드가 안 보이는 위치에 있으면 먼저 펼쳐야 스크롤 대상이 DOM에 존재한다.
    const indexInHistory = history.findIndex((entry) => entry.stepId === highlightStepId)
    if (indexInHistory >= VISIBLE_COUNT) setExpanded(true)

    const raf = requestAnimationFrame(() => {
      cardRefs.current.get(highlightStepId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    setHighlighted(highlightStepId)
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_HOLD_MS)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [highlightStepId, history])

  if (history.length === 0) {
    return <div className="step-log step-log--empty">아직 완료된 스텝이 없습니다.</div>
  }

  const visible = expanded ? history : history.slice(0, VISIBLE_COUNT)
  const hiddenCount = history.length - visible.length

  return (
    <div className="step-log-wrap">
      <ul className={`step-log ${expanded ? 'step-log--expanded' : ''}`}>
        {visible.map((entry) => (
          <li
            key={entry.stepId}
            ref={(el) => {
              if (el) cardRefs.current.set(entry.stepId, el)
              else cardRefs.current.delete(entry.stepId)
            }}
            className={[
              'step-log__card',
              entry.status === 'failed' ? 'step-log__card--failed' : '',
              highlighted === entry.stepId ? 'step-log__card--highlight' : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <p className="step-log__summary">
              {entry.status === 'failed' && <span className="step-log__status-tag">막힘</span>}
              {entry.summary}
            </p>
            {entry.keyCode && (
              <div className="step-log__keycode">
                <div className="step-log__keycode-file">{entry.keyCode.filePath}</div>
                <pre className="step-log__snippet">
                  <code>{truncateLines(entry.keyCode.snippet, 5)}</code>
                </pre>
                <p className="step-log__reason">{entry.keyCode.reason}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button type="button" className="step-log__more" onClick={() => setExpanded(true)}>
          이전 진행상황 {hiddenCount}개 더 보기
        </button>
      )}
      {expanded && history.length > VISIBLE_COUNT && (
        <button type="button" className="step-log__more" onClick={() => setExpanded(false)}>
          접기
        </button>
      )}
    </div>
  )
}
