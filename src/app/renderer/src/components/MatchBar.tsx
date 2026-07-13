import { useEffect, useState } from 'react'
import type { MatchStats, Prompt, Session } from '@shared/types'
import { formatMatchMinute, matchMinute } from '@shared/match'

interface MatchBarProps {
  session: Session | null
  prompts: Prompt[]
  matchStats: MatchStats
}

// FM식 스코어보드: LIVE/FT + 경과 분 + 요청/성공·실패/created + 지금 지시.
// "지금 배우는 것"/티커는 ProgressTurtleBar+StepLog로 이전됐다(터틀 진행상황 패널).
export function MatchBar({ session, prompts, matchStats }: MatchBarProps) {
  const [nowTick, setNowTick] = useState(0)

  useEffect(() => {
    if (session?.ended_at) return
    const timer = setInterval(() => setNowTick((n) => n + 1), 15_000)
    return () => clearInterval(timer)
  }, [session?.ended_at])

  if (!session && prompts.length === 0) return null

  const isLive = Boolean(session && !session.ended_at)
  // nowTick으로 LIVE 중 분 표시 갱신
  void nowTick
  const minute = matchMinute(session?.started_at ?? null)
  const currentTurn = prompts.length > 0 ? prompts[prompts.length - 1] : null

  return (
    <div className="match-bar">
      <div className="match-bar__score">
        <span className={`match-bar__status ${isLive ? 'match-bar__status--live' : 'match-bar__status--ft'}`}>
          {isLive ? 'LIVE' : session?.ended_at ? 'FT' : '—'}
        </span>
        <span className="match-bar__minute">{formatMatchMinute(minute)}</span>
        <span className="match-bar__chip">요청 {prompts.length}</span>
        <span className="match-bar__chip match-bar__chip--ok">성공 {matchStats.success}</span>
        <span className="match-bar__chip match-bar__chip--bad">실패 {matchStats.error}</span>
        <span className="match-bar__chip match-bar__chip--goal">NEW {matchStats.created}</span>
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
