import { useEffect, useRef, useState } from 'react'
import type { ProgressLogEntry } from '../hooks/useProgress'
import type { ProgressKeyCode } from '@shared/progress'

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

// snippet은 extractDiffSnippetLines가 "- 줄들" 다음 "+ 줄들" 순서로(섞이지 않게)
// 만들어준다(explainBatchPrompt.ts) — 그래서 마커로 필터링만 해도 좌(빨강, 변경 전)/
// 우(초록, 변경 후) 두 블록으로 정확히 갈린다. Write처럼 변경 전이 없는 스텝은
// removed가 비어 side 자체가 안 뜬다.
function splitDiffLines(text: string): { removed: string[]; added: string[] } {
  const removed: string[] = []
  const added: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^([+-]) (.*)$/)
    if (!match) continue
    ;(match[1] === '+' ? added : removed).push(match[2])
  }
  return { removed, added }
}

// 진행상황 카드의 "핵심 코드" 블록 — 변경 전/후를 좌우 두 패널로 완전히 갈라
// 빨강/초록으로 보여주고, 설명/중요한 이유/학습 포인트/해시태그를 함께 붙인다.
function KeyCodeCard({ keyCode }: { keyCode: ProgressKeyCode }) {
  const { removed, added } = splitDiffLines(keyCode.snippet)

  return (
    <div className="step-log__keycode">
      <div className="step-log__keycode-file">
        {keyCode.filePath}
        {keyCode.otherFiles.length > 0 && (
          <span className="step-log__other-files"> 외 {keyCode.otherFiles.length}개 파일 변경</span>
        )}
      </div>
      <div className="step-log__diff">
        {removed.length > 0 && (
          <div className="step-log__diff-side step-log__diff-side--remove">
            <div className="step-log__diff-label">− 변경 전</div>
            <pre>
              <code>{truncateLines(removed.join('\n'), 5)}</code>
            </pre>
          </div>
        )}
        {added.length > 0 && (
          <div className="step-log__diff-side step-log__diff-side--add">
            <div className="step-log__diff-label">+ 변경 후</div>
            <pre>
              <code>{truncateLines(added.join('\n'), 5)}</code>
            </pre>
          </div>
        )}
      </div>
      {keyCode.conceptTags.length > 0 && (
        <ul className="step-log__tags">
          {keyCode.conceptTags.map((tag) => (
            <li key={tag} className="step-log__tag">
              #{tag}
            </li>
          ))}
        </ul>
      )}
      <dl className="step-log__explain">
        <dt>설명</dt>
        <dd>{keyCode.explanation}</dd>
        <dt>중요한 이유</dt>
        <dd>{keyCode.importance}</dd>
        <dt>학습 포인트</dt>
        <dd>{keyCode.application}</dd>
      </dl>
    </div>
  )
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
            {entry.keyCode && <KeyCodeCard keyCode={entry.keyCode} />}
            {entry.errorDetail && <pre className="step-log__error">{entry.errorDetail}</pre>}
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
