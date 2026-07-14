import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BookOpen,
  BrainCircuit,
  ChevronRight,
  Code2,
  FolderKanban,
  FolderTree,
  GraduationCap,
  LayoutDashboard,
  Terminal,
  type LucideIcon
} from 'lucide-react'
import { DifficultySlider } from './components/DifficultySlider'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { MonitoringControl } from './components/MonitoringControl'
import { OnboardingModal } from './components/OnboardingModal'
import { ProjectsView } from './components/ProjectsView'
import { QnaChat } from './components/QnaChat'
import { SessionContextBar } from './components/SessionContextBar'
import { SessionList } from './components/SessionList'
import { StructureOverview } from './components/StructureOverview'
import { TurnDetailPanel } from './components/TurnDetailPanel'
import { buildTurnList, ORPHAN_TURN_ID, TurnList } from './components/TurnList'
import { UnitTimeline } from './components/UnitTimeline'
import { useLectureNotes } from './hooks/useLectureNotes'
import { useMonitoring } from './hooks/useMonitoring'
import { useOnboarding } from './hooks/useOnboarding'
import { useProjects } from './hooks/useProjects'
import { useQna } from './hooks/useQna'
import { useSessions } from './hooks/useSessions'
import { useSessionTrace } from './hooks/useSessionTrace'
import { useSkillLevel } from './hooks/useSkillLevel'
import { useTurnDetail } from './hooks/useTurnDetail'
import { useUnitTimeline } from './hooks/useUnitTimeline'
import { parseConceptTags } from '@shared/format'

type ViewKey = 'projects' | 'dashboard' | 'structure' | 'notes'

const NAV_ITEMS: Array<{ key: ViewKey; label: string; icon: LucideIcon }> = [
  { key: 'projects', label: '프로젝트', icon: FolderKanban },
  { key: 'dashboard', label: '관제실', icon: LayoutDashboard },
  { key: 'structure', label: '구조도', icon: FolderTree },
  { key: 'notes', label: '강의노트', icon: BookOpen }
]

const VIEW_TITLE: Record<ViewKey, { title: string; desc: string }> = {
  projects: { title: '프로젝트', desc: '작업할 코드베이스를 고르거나 새로 등록하세요.' },
  dashboard: { title: '에이전트 관제실', desc: 'AI 작업을 읽고, 이해하고, 내 지식으로 남기세요.' },
  structure: { title: '코드 구조도', desc: '에이전트가 만든 코드 유닛과 의존 관계를 살펴보세요.' },
  notes: { title: '강의노트', desc: '끝난 세션이 복습 가능한 노트로 자동 정리됩니다.' }
}

// 관제실/구조도/강의노트는 프로젝트 단위로 스코프되므로, 프로젝트를 고르기 전에는
// 대신 이 안내를 보여준다.
function NoProjectPrompt({ onGoToProjects }: { onGoToProjects: () => void }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card px-6 py-20 text-center">
      <FolderKanban size={28} className="mb-3 text-[#40545e]" />
      <p className="mb-4 max-w-[360px] text-[13px] leading-6 text-muted-foreground">
        먼저 프로젝트를 선택하거나 새로 등록해야 이 화면을 볼 수 있어요.
      </p>
      <button
        type="button"
        onClick={onGoToProjects}
        className="rounded-lg bg-[#9fe2c4] px-4 py-2 text-[12px] font-semibold text-[#0d251b] transition hover:bg-[#b4edcf]"
      >
        프로젝트 선택하러 가기
      </button>
    </div>
  )
}

function App() {
  const { skillLevel, setSkillLevel } = useSkillLevel()
  const projects = useProjects()
  // 앱을 켜면 항상 프로젝트 탭에서 시작한다 — 프로젝트를 고르거나 새로 만들어야
  // 관제실/구조도/강의노트가 그 프로젝트로 스코프돼 보인다.
  const [view, setView] = useState<ViewKey>('projects')
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const currentProject = projects.projects.find((p) => p.id === currentProjectId) ?? null

  const monitoring = useMonitoring(currentProjectId)
  const sessions = useSessions(currentProjectId)
  // null = 실시간(가장 최근 세션 자동 추적), 값이 있으면 세션 목록에서 고른 과거 세션 고정.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const { sessionId, prompts, events, explanations, loading } = useSessionTrace(
    skillLevel,
    currentProjectId,
    selectedSessionId
  )
  const timeline = useUnitTimeline(skillLevel, currentProjectId)
  const { notes, regenerate } = useLectureNotes(currentProjectId)
  const { needsOnboarding, complete } = useOnboarding(setSkillLevel)
  const qna = useQna(sessionId, skillLevel)
  const [qnaOpen, setQnaOpen] = useState(false)
  // null = 아직 명시적으로 고른 턴이 없음 → 기본값(가장 최근 턴)을 계산해서 보여준다.
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  // 세션이 바뀌면(프로젝트 전환, 세션 목록 선택, 라이브 모드에서 새 세션 감지) 이전
  // 세션의 턴 id가 남아 "턴을 선택하세요" 빈 화면에 갇히지 않게 선택을 초기화한다.
  useEffect(() => {
    setSelectedTurnId(null)
  }, [sessionId])

  const goToProjects = (): void => setView('projects')
  const selectProject = (projectId: string): void => {
    setCurrentProjectId(projectId)
    setSelectedSessionId(null)
    setView('dashboard')
  }

  const currentTurn = prompts.length > 0 ? prompts[prompts.length - 1] : null

  // 타임라인에 턴을 전부 늘어놓는 대신, 왼쪽 TurnList에서 턴 하나를 고르면
  // 오른쪽 TurnDetailPanel이 그 턴의 구조도·변경사항·요약을 큰 화면에 보여준다.
  const turnItems = useMemo(() => buildTurnList(prompts, events), [prompts, events])
  const defaultTurnId = useMemo(() => {
    const realTurns = turnItems.filter((t) => t.turnIndex !== null)
    if (realTurns.length > 0) return realTurns[realTurns.length - 1].turnId
    return turnItems[0]?.turnId ?? null
  }, [turnItems])
  const effectiveTurnId = selectedTurnId ?? defaultTurnId
  const selectedTurnItem = turnItems.find((t) => t.turnId === effectiveTurnId) ?? null

  const turnDetail = useTurnDetail(
    sessionId,
    effectiveTurnId === ORPHAN_TURN_ID ? null : effectiveTurnId,
    skillLevel
  )
  // 턴 상세에는 미니 그래프 대신 전체 구조도를 그대로 주고, 이번 턴에서 바뀐
  // 유닛들만 하이라이트한다 — 강사가 전체 칠판에서 짚어주는 방식.
  const turnUnitIds = useMemo(
    () => new Set(turnDetail.versions.map((v) => v.unit_id)),
    [turnDetail.versions]
  )
  const turnExplanation =
    effectiveTurnId && effectiveTurnId !== ORPHAN_TURN_ID ? explanations.get(effectiveTurnId) : undefined

  const conceptTags = useMemo(() => {
    const tags = new Set<string>()
    for (const explanation of explanations.values()) {
      for (const tag of parseConceptTags(explanation.concept_tags)) tags.add(tag)
    }
    return Array.from(tags)
  }, [explanations])

  const filesTouched = useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of events) {
      if (!event.file_path) continue
      counts.set(event.file_path, (counts.get(event.file_path) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
  }, [events])

  const header = VIEW_TITLE[view]

  const monitoringDisabled = !currentProjectId || (monitoring.isMonitoring && monitoring.monitoringProjectId !== currentProjectId)
  const monitoringDisabledReason = !currentProjectId
    ? '프로젝트를 먼저 선택하세요'
    : monitoring.isMonitoring && monitoring.monitoringProjectId !== currentProjectId
      ? '다른 프로젝트를 이미 관찰 중이에요'
      : undefined

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground selection:bg-[#98dfc2]/30">
      {needsOnboarding && <OnboardingModal onSelect={complete} />}
      <div className="flex min-h-screen">
        {/* ── 사이드바 ───────────────────────────────────────────── */}
        <aside className="flex w-[248px] shrink-0 flex-col border-r border-border bg-[#0d151c]">
          <div className="flex h-[72px] items-center border-b border-border px-5">
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 place-items-center rounded-lg bg-[#a1e2c5] text-[#092018] shadow-[0_0_25px_rgba(161,226,197,.15)]">
                <BrainCircuit size={18} strokeWidth={2.3} />
              </div>
              <span className="text-[18px] font-semibold tracking-[-0.025em]">
                factcoding<span className="text-[#89a7a6]">.</span>
              </span>
            </div>
          </div>

          <div className="px-3 py-5">
            <p className="mb-2 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#66807d]">
              Workspace
            </p>
            <nav className="space-y-1">
              {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] transition ${
                    view === key
                      ? 'bg-[#1b2b32] text-[#c8f1dc]'
                      : 'text-[#96a7b0] hover:bg-[#152129] hover:text-white'
                  }`}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span className="flex-1">{label}</span>
                  {key === 'notes' && notes.length > 0 && (
                    <span className="rounded bg-[#31443f] px-1.5 py-0.5 font-mono text-[10px] text-[#bde9d1]">
                      {notes.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div className="mx-5 border-t border-border" />
          <div className="px-3 py-4">
            <p className="mb-2 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#66807d]">
              현재 프로젝트
            </p>
            <button
              type="button"
              onClick={goToProjects}
              className="flex w-full items-center gap-3 rounded-lg bg-[#14212a] px-3 py-3 text-left transition hover:bg-[#182631]"
            >
              <div className="grid size-7 shrink-0 place-items-center rounded-md bg-[#213b49] text-[#8ccce9]">
                <Code2 size={15} />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[#d7e3e9]">
                  {currentProject?.name ?? '프로젝트 없음'}
                </span>
                <span className="block truncate font-mono text-[10px] text-[#71909d]">
                  {currentProject?.workspace_path ?? '선택하려면 클릭'}
                </span>
              </span>
              <ChevronRight size={14} className="shrink-0 text-[#78909a]" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
            <p className="mb-2 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#66807d]">
              세션
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SessionList
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelect={setSelectedSessionId}
              />
            </div>
          </div>

          <div className="border-t border-border p-4">
            <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[#66807d]">
              난이도 조절
            </p>
            <DifficultySlider value={skillLevel} onChange={setSkillLevel} />
          </div>
        </aside>

        {/* ── 메인 ──────────────────────────────────────────────── */}
        <section className="min-w-0 flex-1">
          <header className="flex h-[72px] items-center justify-between border-b border-border bg-[#0b1117]/90 px-4 backdrop-blur lg:px-8">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-semibold tracking-[-0.015em]">{header.title}</h1>
                {view !== 'projects' && currentProject && (
                  <span className="hidden font-mono text-[10px] uppercase text-[#65818c] sm:block">
                    / {currentProject.name}
                    {sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}
                  </span>
                )}
              </div>
              <p className="hidden text-[11px] text-muted-foreground sm:block">{header.desc}</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <QnaChat
                open={qnaOpen}
                onToggle={() => setQnaOpen((prev) => !prev)}
                exchanges={qna.exchanges}
                pending={qna.pending}
                disabled={!sessionId}
                onAsk={qna.ask}
              />
              <MonitoringControl
                isMonitoring={monitoring.isMonitoring}
                pending={monitoring.pending}
                disabled={monitoringDisabled}
                disabledReason={monitoringDisabledReason}
                onStart={monitoring.start}
                onComplete={monitoring.complete}
              />
            </div>
          </header>

          <div className="mx-auto h-[calc(100vh-72px)] max-w-[1600px] overflow-y-auto p-4 lg:p-7">
            {view === 'projects' && (
              <ProjectsView
                projects={projects.projects}
                loading={projects.loading}
                currentProjectId={currentProjectId}
                onSelect={selectProject}
                onSelectFolder={projects.selectFolder}
                onCreate={projects.createProject}
              />
            )}

            {view === 'dashboard' &&
              (!currentProjectId ? (
                <NoProjectPrompt onGoToProjects={goToProjects} />
              ) : (
                <>
                  <div className="mb-6">
                    <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-medium tracking-[0.12em] text-[#76c9aa]">
                      <span
                        className={`inline-block size-1.5 rounded-full ${
                          monitoring.isMonitoring ? 'bg-[#79d8b4]' : 'bg-[#3d5560]'
                        }`}
                      />
                      {monitoring.isMonitoring ? 'LIVE SESSION' : 'MONITORING OFF'}
                      {currentTurn && (
                        <>
                          <span className="text-[#536872]">·</span>
                          <span>
                            TURN {currentTurn.turn_index + 1} / {prompts.length}
                          </span>
                        </>
                      )}
                    </div>
                    <h2 className="max-w-[900px] text-[25px] font-semibold leading-tight tracking-[-0.035em] text-[#f0f6f8] sm:text-[28px]">
                      {currentTurn?.user_text ??
                        (monitoring.isMonitoring
                          ? '에이전트의 첫 작업을 기다리고 있어요'
                          : '시작하기를 누르면 에이전트 관찰이 시작돼요')}
                    </h2>
                  </div>

                  <SessionContextBar prompts={prompts} />

                  <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <TurnList
                      prompts={prompts}
                      events={events}
                      explanations={explanations}
                      loading={loading}
                      selectedTurnId={effectiveTurnId}
                      onSelectTurn={setSelectedTurnId}
                    />
                    <TurnDetailPanel
                      turn={selectedTurnItem}
                      explanation={turnExplanation}
                      units={timeline.units}
                      edges={timeline.edges}
                      highlightUnitIds={turnUnitIds}
                      versions={turnDetail.versions}
                      versionExplanations={turnDetail.explanations}
                    />
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    <section className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono text-[10px] tracking-[.12em] text-[#6e8490]">
                            LEARNING PULSE
                          </p>
                          <h3 className="mt-1 text-[14px] font-semibold">이번 세션에서 쌓인 지식</h3>
                        </div>
                        <GraduationCap className="text-[#9ae0bf]" size={20} />
                      </div>
                      <div className="mt-5 flex items-end gap-2">
                        <span className="font-mono text-[28px] font-medium leading-none text-[#e7f5ec]">
                          {String(conceptTags.length).padStart(2, '0')}
                        </span>
                        <span className="pb-0.5 text-[11px] text-[#82949d]">개념 태그</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {conceptTags.slice(0, 6).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-[#2c4a41] bg-[#14251f] px-2 py-0.5 font-mono text-[10px] text-[#a9d3bd]"
                          >
                            {tag}
                          </span>
                        ))}
                        {conceptTags.length === 0 && (
                          <span className="text-[11px] text-[#5f7682]">
                            해설이 쌓이면 개념 태그가 모여요.
                          </span>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono text-[10px] tracking-[.12em] text-[#6e8490]">
                            FILES TOUCHED
                          </p>
                          <h3 className="mt-1 text-[14px] font-semibold">변경·조회된 파일</h3>
                        </div>
                        <Terminal className="text-[#91bfe0]" size={20} />
                      </div>
                      <div className="mt-4 space-y-2 font-mono text-[11px]">
                        {filesTouched.map(([file, count]) => (
                          <div key={file} className="flex justify-between gap-3">
                            <span className="truncate text-[#a9bdc7]">{file}</span>
                            <span className="shrink-0 text-[#8bd6b4]">×{count}</span>
                          </div>
                        ))}
                        {filesTouched.length === 0 && (
                          <span className="font-sans text-[11px] text-[#5f7682]">
                            아직 파일 작업이 없어요.
                          </span>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-mono text-[10px] tracking-[.12em] text-[#6e8490]">
                            SESSION PULSE
                          </p>
                          <h3 className="mt-1 text-[14px] font-semibold">세션 활동</h3>
                        </div>
                        <Activity className="text-[#dcb47b]" size={20} />
                      </div>
                      <div className="mt-5 flex items-end gap-4">
                        <div>
                          <span className="font-mono text-[28px] font-medium leading-none text-[#e7f5ec]">
                            {String(events.length).padStart(2, '0')}
                          </span>
                          <span className="ml-1.5 text-[11px] text-[#82949d]">이벤트</span>
                        </div>
                        <div>
                          <span className="font-mono text-[28px] font-medium leading-none text-[#e7f5ec]">
                            {String(prompts.length).padStart(2, '0')}
                          </span>
                          <span className="ml-1.5 text-[11px] text-[#82949d]">턴</span>
                        </div>
                      </div>
                      <div className="mt-3 flex h-1.5 gap-1">
                        {[1, 2, 3, 4, 5, 6].map((x) => (
                          <span
                            key={x}
                            className={`flex-1 rounded-full ${
                              x <= Math.min(6, Math.ceil(events.length / 3))
                                ? 'bg-[#7dcfaf]'
                                : 'bg-[#263941]'
                            }`}
                          />
                        ))}
                      </div>
                    </section>
                  </div>
                </>
              ))}

            {view === 'structure' &&
              (!currentProjectId ? (
                <NoProjectPrompt onGoToProjects={goToProjects} />
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,1fr)]">
                  <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_45px_rgba(0,0,0,.14)]">
                    <div className="border-b border-border px-5 py-3.5">
                      <h3 className="text-[13px] font-semibold">구조도</h3>
                      <p className="font-mono text-[10px] text-[#75909a]">
                        {timeline.units.length} UNITS · 클릭해서 타임라인 보기
                      </p>
                    </div>
                    <StructureOverview
                      units={timeline.units}
                      edges={timeline.edges}
                      selectedUnitId={timeline.selectedUnitId}
                      onSelectUnit={timeline.selectUnit}
                    />
                  </section>
                  <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_45px_rgba(0,0,0,.14)]">
                    <div className="border-b border-border px-5 py-3.5">
                      <h3 className="text-[13px] font-semibold">코드 유닛 타임라인</h3>
                      <p className="font-mono text-[10px] text-[#75909a]">
                        VERSION CHAIN · SUMMARY + DIFF
                      </p>
                    </div>
                    <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-4">
                      <UnitTimeline versions={timeline.versions} explanations={timeline.explanations} />
                    </div>
                  </section>
                </div>
              ))}

            {view === 'notes' &&
              (!currentProjectId ? (
                <NoProjectPrompt onGoToProjects={goToProjects} />
              ) : (
                <LectureNotesViewer notes={notes} onRegenerate={regenerate} />
              ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
