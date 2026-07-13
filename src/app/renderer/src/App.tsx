import { useState } from 'react'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { MonitoringControl } from './components/MonitoringControl'
import { OnboardingModal } from './components/OnboardingModal'
import { QnaChat } from './components/QnaChat'
import { SessionContextBar } from './components/SessionContextBar'
import { SessionList } from './components/SessionList'
import { SkillLevelToggle } from './components/SkillLevelToggle'
import { StructureOverview } from './components/StructureOverview'
import { TracePanel } from './components/TracePanel'
import { UnitTimeline } from './components/UnitTimeline'
import { useLectureNotes } from './hooks/useLectureNotes'
import { useMonitoring } from './hooks/useMonitoring'
import { useOnboarding } from './hooks/useOnboarding'
import { useQna } from './hooks/useQna'
import { useSessions } from './hooks/useSessions'
import { useSessionTrace } from './hooks/useSessionTrace'
import { useSkillLevel } from './hooks/useSkillLevel'
import { useUnitTimeline } from './hooks/useUnitTimeline'

function App() {
  const { skillLevel, setSkillLevel } = useSkillLevel()
  const monitoring = useMonitoring()
  const sessions = useSessions()
  // null = 실시간(가장 최근 세션 자동 추적), 값이 있으면 세션 목록에서 고른 과거 세션 고정.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const { sessionId, prompts, events, explanations, loading } = useSessionTrace(
    skillLevel,
    selectedSessionId
  )
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
        <MonitoringControl
          isMonitoring={monitoring.isMonitoring}
          pending={monitoring.pending}
          onStart={monitoring.start}
          onComplete={monitoring.complete}
        />
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
      <SessionList sessions={sessions} selectedSessionId={selectedSessionId} onSelect={setSelectedSessionId} />
      <SessionContextBar prompts={prompts} />
      <main className="app__main app__main--split">
        <section className="app__pane">
          <h2 className="app__pane-title">실시간 트레이스</h2>
          <TracePanel prompts={prompts} events={events} explanations={explanations} loading={loading} />
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
