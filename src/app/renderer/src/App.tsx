import { useState } from 'react'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { LiveStatusLine } from './components/LiveStatusLine'
import { MatchBar } from './components/MatchBar'
import { OnboardingModal } from './components/OnboardingModal'
import { ProgressTurtleBar } from './components/ProgressTurtleBar'
import { QnaChat } from './components/QnaChat'
import { QuizModal } from './components/QuizModal'
import { SkillLevelToggle } from './components/SkillLevelToggle'
import { StepLog } from './components/StepLog'
import { StructureOverview } from './components/StructureOverview'
import { UnitTimeline } from './components/UnitTimeline'
import { useLectureNotes } from './hooks/useLectureNotes'
import { useLiveStatus } from './hooks/useLiveStatus'
import { useOnboarding } from './hooks/useOnboarding'
import { useProgress } from './hooks/useProgress'
import { useQna } from './hooks/useQna'
import { useQuiz } from './hooks/useQuiz'
import { useSessionTrace } from './hooks/useSessionTrace'
import { useSkillLevel } from './hooks/useSkillLevel'
import { useUnitTimeline } from './hooks/useUnitTimeline'

function App() {
  const { skillLevel, setSkillLevel } = useSkillLevel()
  const { sessionId, session, matchStats, prompts } = useSessionTrace(skillLevel)
  const timeline = useUnitTimeline(skillLevel)
  const { notes, regenerate } = useLectureNotes()
  const { needsOnboarding, complete } = useOnboarding(setSkillLevel)
  const qna = useQna(sessionId, skillLevel)
  const quiz = useQuiz(sessionId, skillLevel)
  const progress = useProgress()
  const liveStatus = useLiveStatus()
  const [qnaOpen, setQnaOpen] = useState(false)
  const [highlightStepId, setHighlightStepId] = useState<string | null>(null)

  // 구조도 노드 클릭 → 그 유닛의 최신 버전을 만든 스텝(진행상황 카드)으로 스크롤 이동
  // (SPEC 패치 v2 #6). 유닛 선택 자체(오른쪽 타임라인 표시)는 그대로 timeline이 담당.
  const handleSelectUnit = (unitId: string): void => {
    timeline.selectUnit(unitId)
    setHighlightStepId(timeline.unitStats.get(unitId)?.latestStepId ?? null)
  }

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
        <button
          type="button"
          className="quiz-toggle"
          onClick={quiz.toggle}
          disabled={!sessionId}
          title={sessionId ? '이번 세션에서 바뀐 코드로 복습 퀴즈 풀기' : '세션이 있어야 퀴즈를 풀 수 있어요'}
        >
          퀴즈
        </button>
        <span className="app__session">{sessionId ? `세션: ${sessionId.slice(0, 8)}` : '세션 없음'}</span>
      </header>
      {quiz.open && (
        <QuizModal
          loading={quiz.loading}
          lessons={quiz.lessons}
          onClose={quiz.toggle}
          onRetry={quiz.regenerate}
        />
      )}
      <MatchBar session={session} prompts={prompts} matchStats={matchStats} />
      <section className="app__pane app__pane--full">
        <h2 className="app__pane-title">진행상황</h2>
        <LiveStatusLine status={liveStatus} />
        <ProgressTurtleBar
          percent={progress.percent}
          justCompleted={progress.justCompleted}
          cycleNumber={progress.cycleNumber}
          stepsInCycle={progress.stepsInCycle}
          cycleSize={progress.cycleSize}
          failMarks={progress.failMarks}
        />
        <StepLog history={progress.history} highlightStepId={highlightStepId} />
      </section>
      <main className="app__main">
        <section className="app__pane app__pane--full">
          <h2 className="app__pane-title">코드 구조도</h2>
          <StructureOverview
            units={timeline.units}
            edges={timeline.edges}
            selectedUnitId={timeline.selectedUnitId}
            onSelectUnit={handleSelectUnit}
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
