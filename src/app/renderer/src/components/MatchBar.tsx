import { useEffect, useState } from 'react'
import type { AiExplanation, AssistantNote, MatchStats, Prompt, Session, ToolEvent } from '@shared/types'
import { formatMatchMinute, headlineForStep, latestLiveHeadline, matchMinute } from '@shared/match'

interface MatchBarProps {
  session: Session | null
  prompts: Prompt[]
  notes: AssistantNote[]
  events: ToolEvent[]
  stepExplanations: Map<string, AiExplanation>
  matchStats: MatchStats
  /** 지금 캐스터 음성이 낭독 중인 stepId — 있으면 그 스텝 헤드라인을 화면에 우선 표시. */
  speakingStepId?: string | null
}

// FM식 스코어보드: LIVE/FT + 경과 분 + 요청/성공·실패/created + 지금 배우는 것 + 티커.
export function MatchBar({
  session,
  prompts,
  notes,
  events,
  stepExplanations,
  matchStats,
  speakingStepId
}: MatchBarProps) {
  const [nowTick, setNowTick] = useState(0)

  useEffect(() => {
    if (session?.ended_at) return
    const timer = setInterval(() => setNowTick((n) => n + 1), 15_000)
    return () => clearInterval(timer)
  }, [session?.ended_at])

  if (!session && prompts.length === 0 && notes.length === 0 && events.length === 0) return null

  const isLive = Boolean(session && !session.ended_at)
  // nowTick으로 LIVE 중 분 표시 갱신
  void nowTick
  const minute = matchMinute(session?.started_at ?? null)
  const speakingHeadline = speakingStepId
    ? headlineForStep(speakingStepId, notes, events, stepExplanations, session?.started_at ?? null)
    : null
  const isSpeaking = speakingHeadline !== null
  const headline =
    speakingHeadline ??
    latestLiveHeadline(prompts, notes, events, stepExplanations, session?.started_at ?? null)
  const currentTurn = prompts.length > 0 ? prompts[prompts.length - 1] : null
  const ticker = headline.title ? `${formatMatchMinute(headline.minute)} — ${headline.title}` : null

  return (
    <div className="match-bar">
      <div className="match-bar__score">
        <span className={`match-bar__status ${isLive ? 'match-bar__status--live' : 'match-bar__status--ft'}`}>
          {isLive ? 'LIVE' : session?.ended_at ? 'FT' : '—'}
        </span>
        {isSpeaking && <span className="match-bar__onair">🔊 ON AIR</span>}
        <span className="match-bar__minute">{formatMatchMinute(minute)}</span>
        <span className="match-bar__chip">요청 {prompts.length}</span>
        <span className="match-bar__chip match-bar__chip--ok">성공 {matchStats.success}</span>
        <span className="match-bar__chip match-bar__chip--bad">실패 {matchStats.error}</span>
        <span className="match-bar__chip match-bar__chip--goal">NEW {matchStats.created}</span>
      </div>
      <div className={`match-bar__learning ${isSpeaking ? 'match-bar__learning--speaking' : ''}`}>
        <span className="match-bar__label">지금</span>
        <span className="match-bar__title">{headline.title}</span>
        {headline.tags.map((tag) => (
          <span key={tag} className="match-bar__tag">
            {tag}
          </span>
        ))}
      </div>
      {currentTurn && (
        <div className="match-bar__request">
          <span className="match-bar__label">지시</span>
          <span className="match-bar__request-text">
            {currentTurn.turn_index + 1}/{prompts.length} · {currentTurn.user_text ?? '—'}
          </span>
        </div>
      )}
      {ticker && (
        <div className="match-bar__ticker" key={ticker}>
          <span className="match-bar__ticker-label">TICKER</span>
          <span className="match-bar__ticker-text">{ticker}</span>
        </div>
      )}
    </div>
  )
}
