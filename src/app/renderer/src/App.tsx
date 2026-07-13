import { useCallback, useState } from 'react'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { MatchBar } from './components/MatchBar'
import { OnboardingModal } from './components/OnboardingModal'
import { QnaChat } from './components/QnaChat'
import { SkillLevelToggle } from './components/SkillLevelToggle'
import { StructureOverview } from './components/StructureOverview'
import { TracePanel } from './components/TracePanel'
import { UnitTimeline } from './components/UnitTimeline'
import { useCasterAudio } from './hooks/useCasterAudio'
import { useLectureNotes } from './hooks/useLectureNotes'
import { useOnboarding } from './hooks/useOnboarding'
import { useQna } from './hooks/useQna'
import { useSessionTrace } from './hooks/useSessionTrace'
import { useSkillLevel } from './hooks/useSkillLevel'
import { useUnitTimeline } from './hooks/useUnitTimeline'

function App() {
  const { skillLevel, setSkillLevel } = useSkillLevel()
  const {
    sessionId,
    session,
    matchStats,
    createdEventIds,
    prompts,
    events,
    notes: assistantNotes,
    stepExplanations,
    loading
  } = useSessionTrace(skillLevel)
  const timeline = useUnitTimeline(skillLevel)
  const { notes, regenerate } = useLectureNotes()
  const { needsOnboarding, complete } = useOnboarding(setSkillLevel)
  const qna = useQna(sessionId, skillLevel)
  const { enabled: ttsEnabled, setEnabled: setTtsEnabled, speakingStepId } = useCasterAudio()
  const [qnaOpen, setQnaOpen] = useState(false)
  const [qnaPrefill, setQnaPrefill] = useState<string | null>(null)

  const clearPrefill = useCallback(() => setQnaPrefill(null), [])

  const handleConceptClick = useCallback((tag: string) => {
    setQnaPrefill(`"${tag}"이(가) 뭐야? 이번 세션 기준으로 짧게 설명해줘`)
    setQnaOpen(true)
  }, [])

  return (
    <div className="app">
      {needsOnboarding && <OnboardingModal onSelect={complete} />}
      <header className="app__header">
        <h1>Factcoding</h1>
        <SkillLevelToggle value={skillLevel} onChange={setSkillLevel} />
        <button
          type="button"
          className={`tts-toggle ${ttsEnabled ? 'tts-toggle--on' : ''}`}
          onClick={() => setTtsEnabled(!ttsEnabled)}
          title={
            ttsEnabled
              ? '캐스터 중계 끄기 (매니저 지시)'
              : '캐스터 중계 켜기 (매니저 지시)'
          }
        >
          {ttsEnabled ? '중계 ON' : '중계 OFF'}
        </button>
        <QnaChat
          open={qnaOpen}
          onToggle={() => setQnaOpen((prev) => !prev)}
          exchanges={qna.exchanges}
          pending={qna.pending}
          disabled={!sessionId}
          onAsk={qna.ask}
          prefill={qnaPrefill}
          onPrefillConsumed={clearPrefill}
        />
        <span className="app__session">{sessionId ? `match: ${sessionId.slice(0, 8)}` : '경기 없음'}</span>
      </header>
      <MatchBar
        session={session}
        prompts={prompts}
        notes={assistantNotes}
        events={events}
        stepExplanations={stepExplanations}
        matchStats={matchStats}
        speakingStepId={speakingStepId}
      />
      <main className="app__main app__main--split">
        <section className="app__pane">
          <h2 className="app__pane-title">라이브 중계</h2>
          <TracePanel
            prompts={prompts}
            events={events}
            notes={assistantNotes}
            stepExplanations={stepExplanations}
            loading={loading}
            sessionStartedAt={session?.started_at}
            createdEventIds={createdEventIds}
            onConceptClick={handleConceptClick}
            speakingStepId={speakingStepId}
          />
        </section>
        <section className="app__pane">
          <h2 className="app__pane-title">전술판</h2>
          <StructureOverview
            units={timeline.units}
            edges={timeline.edges}
            selectedUnitId={timeline.selectedUnitId}
            onSelectUnit={timeline.selectUnit}
            unitStats={timeline.unitStats}
          />
          <h2 className="app__pane-title app__pane-title--spaced">선수 상세</h2>
          <UnitTimeline versions={timeline.versions} explanations={timeline.explanations} />
        </section>
      </main>
      <section className="app__pane app__pane--full">
        <h2 className="app__pane-title">풀타임 리포트</h2>
        <LectureNotesViewer notes={notes} onRegenerate={regenerate} />
      </section>
    </div>
  )
}

export default App
