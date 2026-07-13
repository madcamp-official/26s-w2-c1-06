import { useState } from 'react'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { MatchBar } from './components/MatchBar'
import { OnboardingModal } from './components/OnboardingModal'
import { ProgressTurtleBar } from './components/ProgressTurtleBar'
import { QnaChat } from './components/QnaChat'
import { SkillLevelToggle } from './components/SkillLevelToggle'
import { StepLog } from './components/StepLog'
import { StructureOverview } from './components/StructureOverview'
import { TracePanel } from './components/TracePanel'
import { UnitTimeline } from './components/UnitTimeline'
import { useLectureNotes } from './hooks/useLectureNotes'
import { useOnboarding } from './hooks/useOnboarding'
import { useProgress } from './hooks/useProgress'
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
    loading
  } = useSessionTrace(skillLevel)
  const timeline = useUnitTimeline(skillLevel)
  const { notes, regenerate } = useLectureNotes()
  const { needsOnboarding, complete } = useOnboarding(setSkillLevel)
  const qna = useQna(sessionId, skillLevel)
  const progress = useProgress()
  const [qnaOpen, setQnaOpen] = useState(false)

  return (
    <div className="app">
      {needsOnboarding && <OnboardingModal onSelect={complete} />}
      <header className="app__header">
        <h1>Factcoding</h1>
        <SkillLevelToggle value={skillLevel} onChange={setSkillLevel} />
        <QnaChat
          open={qnaOpen}
          onToggle={() => setQnaOpen((prev) => !prev)}
          exchanges={qna.exchanges}
          pending={qna.pending}
          disabled={!sessionId}
          onAsk={qna.ask}
        />
        <span className="app__session">{sessionId ? `세션: ${sessionId.slice(0, 8)}` : '세션 없음'}</span>
      </header>
      <MatchBar session={session} prompts={prompts} matchStats={matchStats} />
      <section className="app__pane app__pane--full">
        <h2 className="app__pane-title">진행상황</h2>
        <ProgressTurtleBar percent={progress.percent} justCompleted={progress.justCompleted} />
        <StepLog history={progress.history} />
      </section>
      <main className="app__main app__main--split">
        <section className="app__pane">
          <h2 className="app__pane-title">실행 로그</h2>
          <TracePanel
            prompts={prompts}
            events={events}
            notes={assistantNotes}
            loading={loading}
            sessionStartedAt={session?.started_at}
            createdEventIds={createdEventIds}
          />
        </section>
        <section className="app__pane">
          <h2 className="app__pane-title">코드 구조도</h2>
          <StructureOverview
            units={timeline.units}
            edges={timeline.edges}
            selectedUnitId={timeline.selectedUnitId}
            onSelectUnit={timeline.selectUnit}
            unitStats={timeline.unitStats}
          />
          <h2 className="app__pane-title app__pane-title--spaced">유닛 히스토리</h2>
          <UnitTimeline versions={timeline.versions} explanations={timeline.explanations} />
        </section>
      </main>
      <section className="app__pane app__pane--full">
        <h2 className="app__pane-title">세션 리포트</h2>
        <LectureNotesViewer notes={notes} onRegenerate={regenerate} />
      </section>
    </div>
  )
}

export default App
