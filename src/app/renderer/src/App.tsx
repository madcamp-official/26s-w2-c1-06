import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Clock3,
  FolderKanban,
  Menu,
  Plus,
  Sparkles,
  Terminal,
  X
} from 'lucide-react'
import { DifficultySlider } from './components/DifficultySlider'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { MonitoringControl } from './components/MonitoringControl'
import { OnboardingModal } from './components/OnboardingModal'
import { ProjectsView } from './components/ProjectsView'
import { PromptTimeline } from './components/PromptTimeline'
import { QnaChat } from './components/QnaChat'
import { RecentTurns } from './components/RecentTurns'
import { SessionContextBar } from './components/SessionContextBar'
import { StructureOverview } from './components/StructureOverview'
import { TurnDetailPanel } from './components/TurnDetailPanel'
import { buildTurnList, ORPHAN_TURN_ID } from './components/TurnList'
import { useLectureNotes } from './hooks/useLectureNotes'
import { useLiveStatus } from './hooks/useLiveStatus'
import { useMonitoring } from './hooks/useMonitoring'
import { useOnboarding } from './hooks/useOnboarding'
import { useProjects } from './hooks/useProjects'
import { useQna } from './hooks/useQna'
import { useSessionTrace } from './hooks/useSessionTrace'
import { useSkillLevel } from './hooks/useSkillLevel'
import { useSteps } from './hooks/useSteps'
import { useTurnDetail } from './hooks/useTurnDetail'
import { useUnitTimeline } from './hooks/useUnitTimeline'
import type { Project } from '@shared/types'
import { formatRelativeTime, stripSystemContextTags } from '@shared/format'
import { SKILL_LEVEL_LABEL } from '@shared/skillProfile'

type ViewKey = 'projects' | 'project'
type ProjectTab = 'overview' | 'activity' | 'notes'

const TABS: Array<{ key: ProjectTab; label: string }> = [
  { key: 'overview', label: '개요' },
  { key: 'activity', label: '활동' },
  { key: 'notes', label: '노트' }
]

// 사이드바/프로젝트 헤더의 아바타 색은 데모처럼 프로젝트마다 고정 팔레트에서 하나씩
// 고르되, 데모의 하드코딩된 값 대신 project.id 해시로 결정해 프로젝트가 늘어나도
// 항상 같은 색이 나오게 한다.
const PROJECT_PALETTE = [
  { bg: '#e3f1ec', text: '#2f7467' },
  { bg: '#f0e9f4', text: '#876a98' },
  { bg: '#f8eee0', text: '#b27645' },
  { bg: '#e7eef6', text: '#3f6b86' },
  { bg: '#fbe9e7', text: '#af5b52' },
  { bg: '#eef2df', text: '#6b7d3a' }
]

function projectAccent(id: string): { bg: string; text: string } {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PROJECT_PALETTE[hash % PROJECT_PALETTE.length]
}

function projectInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed.slice(0, 2).toUpperCase() || '??'
}

function pathLeaf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || trimmed
}

function noteTitle(markdown: string): string {
  const line = markdown.split('\n').find((l) => l.trim().length > 0) ?? '학습 노트'
  return line.replace(/^#+\s*/, '').slice(0, 44)
}

// 관제실/구조도/강의노트는 project_id로 스코프되므로, 프로젝트를 고르거나 새로
// 등록해야 이 화면들을 볼 수 있다 — 그 전까지는 이 안내를 대신 보여준다.
function NoProjectPrompt({ onGoToProjects }: { onGoToProjects: () => void }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card px-6 py-20 text-center">
      <FolderKanban size={28} className="mb-3 text-[#9a9a92]" />
      <p className="mb-4 max-w-[360px] text-[13px] leading-6 text-muted-foreground">
        먼저 프로젝트를 선택하거나 새로 등록해야 이 화면을 볼 수 있어요.
      </p>
      <button
        type="button"
        onClick={onGoToProjects}
        className="rounded-lg bg-[#285c52] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[#1f4a41]"
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
  // 개요/활동/노트가 그 프로젝트로 스코프돼 보인다.
  const [view, setView] = useState<ViewKey>('projects')
  const [activeTab, setActiveTab] = useState<ProjectTab>('overview')
  const [sideOpen, setSideOpen] = useState(false)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const currentProject = projects.projects.find((p) => p.id === currentProjectId) ?? null
  const [deletingProject, setDeletingProject] = useState(false)

  const monitoring = useMonitoring(currentProjectId)
  // null = 실시간(가장 최근 세션 자동 추적), 값이 있으면 세션 목록에서 고른 과거 세션 고정.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const { sessionId, prompts, events, explanations, loading } = useSessionTrace(
    skillLevel,
    currentProjectId,
    selectedSessionId
  )
  const timeline = useUnitTimeline(skillLevel, currentProjectId)
  // 실시간 진행 로그(활동 탭 "바뀐 구조와 변경사항") — 턴이 끝나길 기다리지 않고
  // 스텝 단위로 채워진다. liveStatus는 "지금 하는 중" 한 줄, DB 폴링보다 훨씬 빠르다.
  const steps = useSteps(sessionId, skillLevel)
  const liveStatus = useLiveStatus()
  const { notes, regenerate } = useLectureNotes(currentProjectId)
  const { needsOnboarding, complete } = useOnboarding(setSkillLevel)
  const qna = useQna(sessionId, skillLevel)
  const [qnaOpen, setQnaOpen] = useState(false)
  // null = 아직 명시적으로 고른 프롬프트가 없음 → 기본값(가장 최근 프롬프트)을 계산해서 보여준다.
  // 개요 탭의 "직전 실행의 과정"에서 펼치는 행위와 활동 탭의 TurnDetailPanel은 이 상태를
  // 그대로 공유한다 — 같은 프롬프트 하나를 서로 다른 화면에서 각각 다시 계산할 이유가 없다.
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedTurnId(null)
  }, [sessionId])

  const goToProjects = (): void => setView('projects')
  const selectProject = (projectId: string): void => {
    setCurrentProjectId(projectId)
    setSelectedSessionId(null)
    setActiveTab('overview')
    setView('project')
    setSideOpen(false)
  }

  // 지금 화면에 있는 프로젝트를 파이프라인이 관찰 중이면(다른 프로젝트가 아니라
  // 바로 이 프로젝트) 삭제를 막는다 — 지우고 나면 파이프라인이 죽은 project_id로
  // 계속 쓰게 된다(main의 deleteProject도 같은 조건으로 한 번 더 막아둠).
  const isMonitoringCurrentProject =
    monitoring.isMonitoring && monitoring.monitoringProjectId === currentProjectId

  const deleteCurrentProject = async (): Promise<void> => {
    if (!currentProject || isMonitoringCurrentProject) return
    const confirmed = window.confirm(
      `"${currentProject.name}" 프로젝트를 삭제할까요?\n관찰 기록·강의노트를 포함해 모두 지워지고 되돌릴 수 없어요.`
    )
    if (!confirmed) return
    setDeletingProject(true)
    try {
      await projects.deleteProject(currentProject.id)
      setCurrentProjectId(null)
      setView('projects')
    } finally {
      setDeletingProject(false)
    }
  }

  const currentTurn = prompts.length > 0 ? prompts[prompts.length - 1] : null
  const currentTurnExplained = currentTurn ? explanations.has(currentTurn.id) : false

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
  const turnUnitIds = useMemo(
    () => new Set(turnDetail.versions.map((v) => v.unit_id)),
    [turnDetail.versions]
  )
  const turnUnits = useMemo(
    () => timeline.units.filter((u) => turnUnitIds.has(u.id)),
    [timeline.units, turnUnitIds]
  )
  const turnEdges = useMemo(
    () =>
      timeline.edges.filter((e) => turnUnitIds.has(e.from_unit_id) && turnUnitIds.has(e.to_unit_id)),
    [timeline.edges, turnUnitIds]
  )
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

  const recentNotes = useMemo(
    () => [...notes].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 3),
    [notes]
  )

  const monitoringDisabled =
    !currentProjectId || (monitoring.isMonitoring && monitoring.monitoringProjectId !== currentProjectId)
  const monitoringDisabledReason = !currentProjectId
    ? '프로젝트를 먼저 선택하세요'
    : monitoring.isMonitoring && monitoring.monitoringProjectId !== currentProjectId
      ? '다른 프로젝트를 이미 관찰 중이에요'
      : undefined

  return (
    <main className="min-h-screen bg-background font-sans text-foreground">
      {needsOnboarding && <OnboardingModal onSelect={complete} />}

      <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border bg-[#fbfaf7]/90 px-5 backdrop-blur-lg md:px-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-[#61635d] lg:hidden"
            onClick={() => setSideOpen(true)}
            aria-label="프로젝트 목록 열기"
          >
            <Menu size={20} />
          </button>
          <button
            type="button"
            onClick={goToProjects}
            className="flex items-center gap-2.5"
            aria-label="프로젝트 홈으로 이동"
          >
            <div className="grid size-7 place-items-center rounded-[9px] bg-[#285c52] text-white">
              <Sparkles size={15} />
            </div>
            <span className="text-[17px] font-semibold tracking-[-.04em]">factcoding</span>
          </button>
        </div>
      </header>

      {sideOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/20 lg:hidden"
          onClick={() => setSideOpen(false)}
        />
      )}

      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[258px_minmax(0,1fr)]">
        {/* ── 사이드바 ───────────────────────────────────────────── */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-[280px] flex-col overflow-y-auto border-r border-border bg-white px-5 pb-5 pt-6 transition-transform lg:sticky lg:top-[72px] lg:h-[calc(100vh-72px)] lg:w-auto lg:translate-x-0 lg:border-r-0 lg:bg-transparent ${
            sideOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-7 flex items-center justify-between lg:hidden">
            <span className="font-semibold">프로젝트</span>
            <button type="button" onClick={() => setSideOpen(false)} aria-label="닫기">
              <X size={18} />
            </button>
          </div>

          <div className="mb-3">
            <span className="text-[12px] font-semibold text-[#6d7069]">프로젝트</span>
          </div>
          <div className="space-y-1.5">
            {projects.loading && (
              <p className="px-3 text-[12px] text-muted-foreground">불러오는 중…</p>
            )}
            {!projects.loading && projects.projects.length === 0 && (
              <p className="px-3 text-[12px] leading-5 text-muted-foreground">
                등록된 프로젝트가 없어요. 아래에서 새로 만들어보세요.
              </p>
            )}
            {projects.projects.map((project) => {
              const isSelected = view === 'project' && project.id === currentProjectId
              const accent = projectAccent(project.id)
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => selectProject(project.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                    isSelected
                      ? 'bg-white shadow-[0_3px_14px_rgba(42,46,38,.07)] ring-1 ring-[#e9e7e0]'
                      : 'hover:bg-[#f5f4ef]'
                  }`}
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-[10px] text-[11px] font-bold"
                    style={{ color: accent.text, background: accent.bg }}
                  >
                    {projectInitial(project.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{project.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {pathLeaf(project.workspace_path)}
                    </span>
                  </span>
                  {isSelected && (
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: accent.text }} />
                  )}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              setView('projects')
              setSideOpen(false)
            }}
            className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[12px] text-[#777871] hover:bg-[#f1f0eb]"
          >
            <Plus size={15} />
            프로젝트 만들기
          </button>

          <div className="mt-auto space-y-4 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => {
                setView('project')
                setActiveTab('notes')
                setSideOpen(false)
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition ${
                view === 'project' && activeTab === 'notes'
                  ? 'bg-[#eaf4ef] font-medium text-[#285c52]'
                  : 'text-[#686b64] hover:bg-[#f1f0eb]'
              }`}
            >
              <BookOpen size={17} />
              학습 노트
            </button>

            <div>
              <p className="mb-2 px-1 text-[11px] font-semibold text-[#6d7069]">난이도 조절</p>
              <DifficultySlider value={skillLevel} onChange={setSkillLevel} />
            </div>
          </div>
        </aside>

        {/* ── 메인 ──────────────────────────────────────────────── */}
        <section className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-11">
          {view === 'projects' && (
            <div>
              <div className="mb-6">
                <h1 className="text-[22px] font-semibold tracking-[-.03em]">프로젝트</h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  작업할 코드베이스를 고르거나 새로 등록하세요.
                </p>
              </div>
              <ProjectsView
                projects={projects.projects}
                loading={projects.loading}
                currentProjectId={currentProjectId}
                onSelect={selectProject}
                onSelectFolder={projects.selectFolder}
                onCreate={projects.createProject}
              />
            </div>
          )}

          {view === 'project' &&
            (!currentProject ? (
              <NoProjectPrompt onGoToProjects={goToProjects} />
            ) : (
              <ProjectPage
                project={currentProject}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                monitoring={monitoring}
                monitoringDisabled={monitoringDisabled}
                monitoringDisabledReason={monitoringDisabledReason}
                onDeleteProject={deleteCurrentProject}
                deletingProject={deletingProject}
                deleteProjectDisabled={isMonitoringCurrentProject}
                deleteProjectDisabledReason="관찰 중에는 삭제할 수 없어요. 먼저 완료를 눌러주세요"
                sessionId={sessionId}
                prompts={prompts}
                events={events}
                explanations={explanations}
                loading={loading}
                currentTurn={currentTurn}
                currentTurnExplained={currentTurnExplained}
                effectiveTurnId={effectiveTurnId}
                turnItems={turnItems}
                selectedTurnItem={selectedTurnItem}
                onSelectTurn={setSelectedTurnId}
                turnUnits={turnUnits}
                turnEdges={turnEdges}
                turnDetail={turnDetail}
                timeline={timeline}
                steps={steps}
                liveStatus={liveStatus}
                filesTouched={filesTouched}
                notes={notes}
                recentNotes={recentNotes}
                onRegenerateNote={regenerate}
                qna={qna}
                qnaOpen={qnaOpen}
                onToggleQna={() => setQnaOpen((prev) => !prev)}
              />
            ))}
        </section>
      </div>
    </main>
  )
}

interface ProjectPageProps {
  project: Project
  activeTab: ProjectTab
  onTabChange: (tab: ProjectTab) => void
  monitoring: ReturnType<typeof useMonitoring>
  monitoringDisabled: boolean
  monitoringDisabledReason: string | undefined
  onDeleteProject: () => void
  deletingProject: boolean
  deleteProjectDisabled: boolean
  deleteProjectDisabledReason: string
  sessionId: string | null
  prompts: ReturnType<typeof useSessionTrace>['prompts']
  events: ReturnType<typeof useSessionTrace>['events']
  explanations: ReturnType<typeof useSessionTrace>['explanations']
  loading: boolean
  currentTurn: ReturnType<typeof useSessionTrace>['prompts'][number] | null
  currentTurnExplained: boolean
  effectiveTurnId: string | null
  turnItems: ReturnType<typeof buildTurnList>
  selectedTurnItem: ReturnType<typeof buildTurnList>[number] | null
  onSelectTurn: (turnId: string) => void
  turnUnits: ReturnType<typeof useUnitTimeline>['units']
  turnEdges: ReturnType<typeof useUnitTimeline>['edges']
  turnDetail: ReturnType<typeof useTurnDetail>
  timeline: ReturnType<typeof useUnitTimeline>
  steps: ReturnType<typeof useSteps>
  liveStatus: ReturnType<typeof useLiveStatus>
  filesTouched: Array<[string, number]>
  notes: ReturnType<typeof useLectureNotes>['notes']
  recentNotes: ReturnType<typeof useLectureNotes>['notes']
  onRegenerateNote: ReturnType<typeof useLectureNotes>['regenerate']
  qna: ReturnType<typeof useQna>
  qnaOpen: boolean
  onToggleQna: () => void
}

function ProjectPage({
  project,
  activeTab,
  onTabChange,
  monitoring,
  monitoringDisabled,
  monitoringDisabledReason,
  onDeleteProject,
  deletingProject,
  deleteProjectDisabled,
  deleteProjectDisabledReason,
  sessionId,
  prompts,
  events,
  explanations,
  loading,
  currentTurn,
  currentTurnExplained,
  effectiveTurnId,
  turnItems,
  selectedTurnItem,
  onSelectTurn,
  turnUnits,
  turnEdges,
  turnDetail,
  timeline,
  steps,
  liveStatus,
  filesTouched,
  notes,
  recentNotes,
  onRegenerateNote,
  qna,
  qnaOpen,
  onToggleQna
}: ProjectPageProps) {
  const accent = projectAccent(project.id)

  return (
    <>
      <div className="mb-9 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <div
            className="grid size-14 shrink-0 place-items-center rounded-[18px] text-[15px] font-bold sm:size-16"
            style={{ color: accent.text, background: accent.bg }}
          >
            {projectInitial(project.name)}
          </div>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-.045em] sm:text-[32px]">{project.name}</h1>
            <p className="text-[14px] text-muted-foreground">{project.workspace_path}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: accent.text }}>
              <span
                className="size-2 rounded-full"
                style={{ background: monitoring.isMonitoring ? accent.text : '#a9aaa4' }}
              />
              <span className="font-medium">{monitoring.isMonitoring ? '관찰 중' : '관찰 꺼짐'}</span>
              {sessionId && (
                <>
                  <span className="text-[#aaa9a2]">·</span>
                  <span className="font-mono text-muted-foreground">{sessionId.slice(0, 8)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <MonitoringControl
            isMonitoring={monitoring.isMonitoring}
            pending={monitoring.pending}
            disabled={monitoringDisabled}
            disabledReason={monitoringDisabledReason}
            onStart={monitoring.start}
            onComplete={monitoring.complete}
            onDelete={onDeleteProject}
            deleting={deletingProject}
            deleteDisabled={deleteProjectDisabled}
            deleteDisabledReason={deleteProjectDisabledReason}
          />
        </div>
      </div>

      <div className="mb-8 flex gap-6 border-b border-border">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`border-b-2 pb-3 text-[13px] font-medium transition ${
              activeTab === key ? 'border-[#285c52] text-[#285c52]' : 'border-transparent text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.38fr)_320px]">
          <div className="space-y-8">
            <section>
              <div className="mb-3">
                <h2 className="text-[17px] font-semibold tracking-[-.025em]">프로젝트 구조</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  현재 프로젝트의 전체 코드 구조를 간단히 보여줘요.
                </p>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_3px_12px_rgba(40,45,34,.04)]">
                <StructureOverview
                  units={timeline.units}
                  edges={timeline.edges}
                  selectedUnitId={timeline.selectedUnitId}
                  onSelectUnit={timeline.selectUnit}
                  heightClassName="h-[220px]"
                />
              </div>
            </section>

            <RecentTurns
              prompts={prompts}
              events={events}
              explanations={explanations}
              loading={loading}
              expandedTurnId={effectiveTurnId}
              onToggleTurn={onSelectTurn}
              detailUnits={turnUnits}
              detailEdges={turnEdges}
              detailVersions={turnDetail.versions}
              detailVersionExplanations={turnDetail.explanations}
              steps={steps}
              selectedUnitId={timeline.selectedUnitId}
              onSelectUnit={timeline.selectUnit}
              unitVersions={timeline.versions}
              unitVersionExplanations={timeline.explanations}
              onViewAll={() => onTabChange('activity')}
            />
          </div>

          <aside className="space-y-6">
            <section>
              <div className="mb-3">
                <h2 className="text-[15px] font-semibold">현재 프롬프트</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">AI가 지금 실행하고 있는 작업이에요.</p>
              </div>
              <div className="w-full rounded-xl border border-[#dce8e2] bg-white p-3.5 shadow-[0_3px_12px_rgba(40,45,34,.04)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[.08em] text-[#55786d]">
                    <span
                      className={`size-1.5 rounded-full ${
                        monitoring.isMonitoring ? 'bg-[#4f9c84]' : 'bg-[#a9aaa4]'
                      }`}
                    />
                    {monitoring.isMonitoring ? '실시간 진행' : '트래킹 꺼짐'}
                  </span>
                  {monitoring.isMonitoring && (
                    <span className="text-[11px] font-semibold text-[#285c52]">
                      {currentTurnExplained ? '완료' : '실행 중'}
                    </span>
                  )}
                </div>
                <p className="mt-2 truncate text-[12px] font-medium text-[#3f514c]">
                  {monitoring.isMonitoring
                    ? stripSystemContextTags(currentTurn?.user_text ?? null) || '에이전트의 첫 작업을 기다리고 있어요'
                    : '트래킹을 켜면 실행 상태를 볼 수 있어요'}
                </p>
                <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-[#efeee9]">
                  {monitoring.isMonitoring && currentTurnExplained && (
                    <div className="h-full w-full rounded-full bg-[#285c52] transition-all duration-700" />
                  )}
                  {monitoring.isMonitoring && !currentTurnExplained && (
                    <div className="progress-bar--indeterminate" />
                  )}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                  <span>
                    {monitoring.isMonitoring ? (currentTurnExplained ? '요약 완료' : '실행 중') : '업데이트 없음'}
                  </span>
                  <span>{monitoring.isMonitoring ? `프롬프트 ${prompts.length}개 관찰됨` : '트래킹을 켜세요'}</span>
                </div>
              </div>
            </section>

            <section>
              <div className="mb-3">
                <h2 className="text-[15px] font-semibold">도움이 될 만한 내용</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">현재 작업과 연결해 읽어보세요.</p>
              </div>
              <div className="space-y-2">
                {recentNotes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-card px-3.5 py-4 text-center text-[12px] leading-5 text-muted-foreground">
                    세션이 끝나면 강의노트가 여기 쌓여요.
                  </p>
                ) : (
                  recentNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => onTabChange('notes')}
                      className="w-full rounded-xl border border-border bg-card p-3.5 text-left transition hover:border-[#bfd8ce] hover:shadow-sm"
                    >
                      <div className="mb-2 flex justify-between">
                        <span className="rounded-md bg-[#f0f4f1] px-1.5 py-0.5 text-[10px] font-medium text-[#527a6e]">
                          {SKILL_LEVEL_LABEL[note.skill_level]}
                        </span>
                        <Clock3 size={13} className="text-[#a1a19b]" />
                      </div>
                      <h3 className="text-[13px] font-medium">{noteTitle(note.markdown)}</h3>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatRelativeTime(note.created_at)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>

            <QnaChat
              open={qnaOpen}
              onToggle={onToggleQna}
              exchanges={qna.exchanges}
              pending={qna.pending}
              disabled={!sessionId}
              onAsk={qna.ask}
            />
          </aside>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-[#3c7566]">
              <span
                className={`inline-block size-1.5 rounded-full ${
                  monitoring.isMonitoring ? 'bg-[#4f9c84]' : 'bg-[#a9aaa4]'
                }`}
              />
              {monitoring.isMonitoring ? 'LIVE SESSION' : '관찰 꺼짐'}
              {currentTurn && (
                <>
                  <span className="text-[#c7c6bd]">·</span>
                  <span>
                    PROMPT {currentTurn.turn_index + 1} / {prompts.length}
                  </span>
                </>
              )}
              {monitoring.isMonitoring && !liveStatus.idle && liveStatus.text && (
                <>
                  <span className="text-[#c7c6bd]">·</span>
                  <span className="truncate font-mono text-[10px] font-normal tracking-normal text-[#6d7069]">
                    지금: {liveStatus.text}
                  </span>
                </>
              )}
            </div>
            <h2 className="max-w-[900px] text-[22px] font-semibold leading-tight tracking-[-0.03em] sm:text-[25px]">
              {stripSystemContextTags(currentTurn?.user_text ?? null) ||
                (monitoring.isMonitoring
                  ? '에이전트의 첫 작업을 기다리고 있어요'
                  : '헤더 옆 "시작하기"를 누르면 관찰이 시작돼요')}
            </h2>
          </div>

          <SessionContextBar prompts={prompts} />

          {/* 사이드바 "지난 프롬프트"(세션 목록)와 겹치지 않도록 세로 목록 대신 타임라인
              노드 형태로 프롬프트를 고른다 — 개요 탭 "직전 실행의 과정"과 같은
              selectedTurnId 상태를 공유해 어느 화면에서 골라도 서로 반영된다. */}
          <PromptTimeline
            items={turnItems}
            explanations={explanations}
            selectedTurnId={effectiveTurnId}
            onSelectTurn={onSelectTurn}
            liveStatus={liveStatus}
          />
          <TurnDetailPanel
            turn={selectedTurnItem}
            units={turnUnits}
            edges={turnEdges}
            versions={turnDetail.versions}
            versionExplanations={turnDetail.explanations}
            steps={steps}
            selectedUnitId={timeline.selectedUnitId}
            onSelectUnit={timeline.selectUnit}
            unitVersions={timeline.versions}
            unitVersionExplanations={timeline.explanations}
          />

          <section className="rounded-xl border border-border bg-card p-4 shadow-[0_3px_12px_rgba(40,45,34,.04)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold tracking-[.1em] text-[#6d7069]">FILES TOUCHED</p>
                <h3 className="mt-1 text-[14px] font-semibold">변경·조회된 파일</h3>
              </div>
              <Terminal className="text-[#5b8fae]" size={20} />
            </div>
            <div className="mt-4 space-y-2 font-mono text-[11px]">
              {filesTouched.map(([file, count]) => (
                <div key={file} className="flex justify-between gap-3">
                  <span className="truncate text-[#3f514c]">{file}</span>
                  <span className="shrink-0 text-[#3c7566]">×{count}</span>
                </div>
              ))}
              {filesTouched.length === 0 && (
                <span className="font-sans text-[11px] text-muted-foreground">아직 파일 작업이 없어요.</span>
              )}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'notes' && <LectureNotesViewer notes={notes} onRegenerate={onRegenerateNote} />}
    </>
  )
}

export default App
