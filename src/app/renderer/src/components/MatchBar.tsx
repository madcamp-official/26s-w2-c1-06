import { useEffect, useState } from 'react'
import type { MatchStats, Prompt, Session } from '@shared/types'
import { elapsedMinutes, formatElapsedMinutes } from '@shared/match'

interface MatchBarProps {
  session: Session | null
  prompts: Prompt[]
  matchStats: MatchStats
}

// 세션 상태 바: 진행 중 여부 + 경과 시간 + 요청/성공/실패/신규 + 지금 지시.
export function MatchBar({ session, prompts, matchStats }: MatchBarProps) {
  const [nowTick, setNowTick] = useState(0)

  useEffect(() => {
    if (session?.ended_at) return
    const timer = setInterval(() => setNowTick((n) => n + 1), 15_000)
    return () => clearInterval(timer)
  }, [session?.ended_at])

  if (!session && prompts.length === 0) return null

  const isActive = Boolean(session && !session.ended_at)
  // nowTick으로 진행 중 경과 시간 표시 갱신
  void nowTick
  const minute = elapsedMinutes(session?.started_at ?? null)
  const currentTurn = prompts.length > 0 ? prompts[prompts.length - 1] : null

  return (
    <div className="match-bar">
      <div className="match-bar__score">
        <span className={`match-bar__status ${isActive ? 'match-bar__status--active' : 'match-bar__status--ended'}`}>
          {isActive ? '진행 중' : session?.ended_at ? '종료' : '—'}
        </span>
        <span className="match-bar__minute">{formatElapsedMinutes(minute)}</span>
        <span className="match-bar__chip">요청 {prompts.length}</span>
        <span className="match-bar__chip match-bar__chip--ok">성공 {matchStats.success}</span>
        <span className="match-bar__chip match-bar__chip--bad">실패 {matchStats.error}</span>
        <span className="match-bar__chip match-bar__chip--goal">신규 {matchStats.created}</span>
      </div>
      {currentTurn && (
        <div className="match-bar__request">
          <span className="match-bar__label">지시</span>
          <span className="match-bar__request-text">
            {currentTurn.turn_index + 1}/{prompts.length} · {currentTurn.user_text ?? '—'}
          </span>
        </div>
      )}
    </div>
  )
}
