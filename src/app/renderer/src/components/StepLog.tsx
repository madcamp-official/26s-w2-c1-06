import type { ProgressLogEntry } from '../hooks/useProgress'

interface StepLogProps {
  history: ProgressLogEntry[]
}

function truncateLines(text: string, max: number): string {
  const lines = text.split('\n')
  if (lines.length <= max) return text
  return lines.slice(0, max).join('\n') + '\n…'
}

// 거북이 진행바 옆에 붙는 로그 — 방금 한 일 한 줄 + (있으면) 지금 봐두면 좋은
// 핵심 코드. 길게 설명하지 않는다: 카드 하나는 항상 짧아야 한다(SPEC 주의사항).
export function StepLog({ history }: StepLogProps) {
  if (history.length === 0) {
    return <div className="step-log step-log--empty">아직 완료된 스텝이 없습니다.</div>
  }

  return (
    <ul className="step-log">
      {history.map((entry) => (
        <li key={entry.stepId} className="step-log__card">
          <p className="step-log__summary">{entry.summary}</p>
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
  )
}
