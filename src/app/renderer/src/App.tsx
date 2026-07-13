import { useState } from 'react'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { OnboardingModal } from './components/OnboardingModal'
import { QnaChat } from './components/QnaChat'
import { SessionContextBar } from './components/SessionContextBar'
import { SkillLevelToggle } from './components/SkillLevelToggle'
import { StructureOverview } from './components/StructureOverview'
import { TracePanel } from './components/TracePanel'
import { UnitTimeline } from './components/UnitTimeline'
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
    prompts,
    events,
    notes: assistantNotes,
    explanations,
    stepExplanations,
    loading
  } = useSessionTrace(skillLevel)
  const timeline = useUnitTimeline(skillLevel)
  const { notes, regenerate } = useLectureNotes()
  const { needsOnboarding, complete } = useOnboarding(setSkillLevel)
  const qna = useQna(sessionId, skillLevel)
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
        <span className="app__session">{sessionId ? `session: ${sessionId}` : '세션 없음'}</span>
      </header>
      <SessionContextBar prompts={prompts} />
      <main className="app__main app__main--split">
        <section className="app__pane">
          <h2 className="app__pane-title">실시간 트레이스</h2>
          <TracePanel
            prompts={prompts}
            events={events}
            notes={assistantNotes}
            explanations={explanations}
            stepExplanations={stepExplanations}
            loading={loading}
          />
        </section>
        <section className="app__pane">
          <h2 className="app__pane-title">구조도</h2>
          <StructureOverview
            units={timeline.units}
            edges={timeline.edges}
            selectedUnitId={timeline.selectedUnitId}
            onSelectUnit={timeline.selectUnit}
          />
          <h2 className="app__pane-title app__pane-title--spaced">코드 유닛 타임라인</h2>
          <UnitTimeline versions={timeline.versions} explanations={timeline.explanations} />
        </section>
      </main>
      <section className="app__pane app__pane--full">
        <h2 className="app__pane-title">강의노트</h2>
        <LectureNotesViewer notes={notes} onRegenerate={regenerate} />
      </section>
    </div>
  )
}

export default App
