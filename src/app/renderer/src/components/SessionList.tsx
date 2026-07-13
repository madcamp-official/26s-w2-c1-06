import type { Session } from '@shared/types'
import { formatTime } from '@shared/format'

interface SessionListProps {
  sessions: Session[]
  selectedSessionId: string | null
  onSelect: (sessionId: string | null) => void
}

// 세션 목록: sessions 테이블을 최신순으로 나열. selectedSessionId가 null이면
// "실시간(가장 최근 세션 자동 추적)" 모드 — 과거 세션을 클릭하면 그 세션에 고정되고,
// 맨 앞의 "실시간으로" 칩을 눌러 다시 라이브 추적으로 돌아갈 수 있다.
export function SessionList({ sessions, selectedSessionId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return <div className="session-list session-list--empty">아직 관찰된 세션이 없습니다.</div>
  }

  return (
    <div className="session-list">
      {selectedSessionId !== null && (
        <button type="button" className="session-chip session-chip--live" onClick={() => onSelect(null)}>
          ◀ 실시간으로
        </button>
      )}
      {sessions.map((session, index) => {
        const isLive = selectedSessionId === null && index === 0
        const isSelected = selectedSessionId === session.id || isLive
        return (
          <button
            key={session.id}
            type="button"
            className={`session-chip ${isSelected ? 'session-chip--selected' : ''}`}
            onClick={() => onSelect(session.id)}
          >
            <span className={`session-chip__dot ${session.ended_at ? '' : 'session-chip__dot--active'}`} />
            <span className="session-chip__id">{session.id.slice(0, 8)}</span>
            <span className="session-chip__time">{formatTime(session.started_at)}</span>
            <span className="session-chip__badge">{session.ended_at ? '완료' : '진행 중'}</span>
          </button>
        )
      })}
    </div>
  )
}
