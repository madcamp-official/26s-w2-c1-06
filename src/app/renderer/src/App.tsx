import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Clock3,
  FolderKanban,
  Menu,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X
} from 'lucide-react'
import { LectureNotesViewer } from './components/LectureNotesViewer'
import { MonitoringControl } from './components/MonitoringControl'
import { OnboardingModal } from './components/OnboardingModal'
import { ProjectsView } from './components/ProjectsView'
import { PromptTimeline } from './components/PromptTimeline'
import { QnaChat } from './components/QnaChat'
import { RecentTurns } from './components/RecentTurns'
import { SessionContextBar } from './components/SessionContextBar'
import { SkillSettingsModal } from './components/SkillSettingsModal'
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
import type { OnboardingProfile, Project, SkillLevel } from '@shared/types'
import { formatRelativeTime, stripMarkdownFence, stripSystemContextTags } from '@shared/format'
import { SKILL_LEVEL_LABEL } from '@shared/skillProfile'

// 'notes'는 프로젝트 안의 탭이 아니라 최상위 뷰다 — 강의노트가 프로젝트 단위로 스코프되지
// 않고(useLectureNotes가 전 프로젝트 목록을 반환) 모든 프로젝트의 노트를 한 화면에서
// 프로젝트 필터로 골라 보는 화면이라, 특정 프로젝트를 골라야 진입되는 ProjectPage 아래에
// 두면 "프로젝트를 먼저 고르세요" 안내에 막히는 모순이 있었다.
type ViewKey = 'projects' | 'project' | 'notes'
type ProjectTab = 'overview' | 'activity'

const TABS: Array<{ key: ProjectTab; label: string }> = [
  { key: 'overview', label: '개요' },
  { key: 'activity', label: '활동' }
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

// 강의노트 프롬프트가 요구하는 고정 섹션 제목들 — 문서에 진짜 제목이 없으면 첫 줄이
// 이 섹션 헤더라서, 예전엔 모든 노트 카드 제목이 "다룬 개념"으로 찍히는 문제가 있었다.
const GENERIC_NOTE_HEADINGS = new Set(['다룬 개념', '변경된 코드 유닛별 요약', '다음 학습 추천', '세션 요약', '학습 노트'])

// 제목으로 쓸 한 줄에서 리스트 마커/강조 기호를 걷어낸다 — 제목 자리가 없는 노트에서
// 본문 첫 줄(불릿일 수 있음)을 대신 쓸 때 "- **트레이드오프:** …"처럼 원문 마크업이
// 그대로 노출되지 않게.
function cleanNoteTitleLine(line: string): string {
  return line
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/[*_`]/g, '')
    .trim()
    .slice(0, 44)
}

function noteTitle(markdown: string): string {
  let firstBodyLine: string | null = null
  for (const raw of stripMarkdownFence(markdown).split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const headingMatch = line.match(/^#{1,6}\s+(.*)$/)
    if (headingMatch) {
      const heading = headingMatch[1].trim()
      // 고정 섹션 헤더("다룬 개념" 등)는 제목이 아니다 — 건너뛰고 계속 찾는다.
      if (!GENERIC_NOTE_HEADINGS.has(heading)) return cleanNoteTitleLine(heading)
      continue
    }
    // 헤딩이 아닌 첫 본문 줄은 "진짜 제목 헤딩이 뒤에 없을 때"의 폴백으로 기억해둔다
    // (예: 인트로 문장으로 시작하는 노트 — 그 문장이 섹션명보다 훨씬 나은 제목이다).
    if (firstBodyLine === null) firstBodyLine = line
  }
  return firstBodyLine ? cleanNoteTitleLine(firstBodyLine) : '학습 노트'
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
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const { notes } = useLectureNotes()
  const { needsOnboarding, complete } = useOnboarding(setSkillLevel)
  // 사이드바 "설정"에서 온보딩 위저드를 다시 열어 난이도를 조정할 때 — 온보딩 최초
  // 완료 때와 동일하게 난이도를 적용하고 원본 프로필을 저장해, 다음에 또 열면 방금
  // 답한 내용이 그대로 채워져 있게 한다.
  const applySkillProfile = (level: SkillLevel, profile: OnboardingProfile): void => {
    setSkillLevel(level)
    window.factcoding.saveOnboardingProfile(profile)
  }
  const qna = useQna(sessionId, skillLevel)
  const [qnaOpen, setQnaOpen] = useState(false)
  // null = 아직 명시적으로 고른 프롬프트가 없음 → 기본값(가장 최근 프롬프트)을 계산해서 보여준다.
  // 개요 탭의 "직전 실행의 과정"에서 펼치는 행위와 활동 탭의 TurnDetailPanel은 이 상태를
  // 그대로 공유한다 — 같은 프롬프트 하나를 서로 다른 화면에서 각각 다시 계산할 이유가 없다.
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedTurnId(null)
  }, [sessionId])

  // "오늘은 여기까지"로 방금 완료한 세션의 id — 노트 탭에서 그 세션의 요약을 찾아
  // 강조 배너로 보여주고 "계속하기"를 띄우는 데 쓴다. 강의노트는 completeMonitoring
  // 직후가 아니라 lecture-note-worker가 몇 초 뒤 비동기로 만들어(useLectureNotes가
  // 'lecture-note' push로 자동 반영) 채워지므로, 클릭 시점엔 아직 없을 수 있다 —
  // 그래서 세션 id만 기억해두고 노트 유무는 렌더링 시점에 매번 다시 확인한다.
  const [justCompletedSessionId, setJustCompletedSessionId] = useState<string | null>(null)

  // 학습 노트 뷰의 프로젝트 필터 — null이면 전체 프로젝트의 노트를 다 보여준다.
  const [notesProjectFilter, setNotesProjectFilter] = useState<string | null>(null)
  // 필터 칩은 등록된 프로젝트 목록이 아니라 실제로 노트가 있는 프로젝트에서만 만든다 —
  // 노트가 하나도 없는 프로젝트의 칩을 눌러 빈 화면을 보게 할 이유가 없다.
  const noteProjects = useMemo(() => {
    const seen = new Map<string, string>()
    for (const note of notes) {
      if (note.project_id && !seen.has(note.project_id)) {
        seen.set(note.project_id, note.project_name ?? '이름 없는 프로젝트')
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }))
  }, [notes])
  const filteredNotes = useMemo(
    () => (notesProjectFilter ? notes.filter((n) => n.project_id === notesProjectFilter) : notes),
    [notes, notesProjectFilter]
  )

  const goToProjects = (): void => setView('projects')
  const selectProject = (projectId: string): void => {
    setCurrentProjectId(projectId)
    setSelectedSessionId(null)
    setActiveTab('overview')
    setJustCompletedSessionId(null)
    setView('project')
    setSideOpen(false)
  }

  // "완료" 버튼("오늘은 여기까지"): 관찰을 끝내는 것에 더해, 자동으로 학습 노트 뷰로
  // 넘겨서 방금 끝난 이 세션의 요약을 바로 보여준다. 프로젝트 필터가 다른 프로젝트로
  // 걸려 있으면 방금 끝난 세션의 노트가 안 보이므로 전체 보기로 리셋한다.
  const completeSessionAndShowSummary = async (): Promise<void> => {
    const completedSessionId = monitoring.sessionId
    await monitoring.complete()
    if (completedSessionId) setJustCompletedSessionId(completedSessionId)
    setNotesProjectFilter(null)
    setView('notes')
  }

  // "계속하기": 노트 요약을 보다가 이어서 같은 프로젝트를 다시 관찰하고 싶을 때 —
  // 노트 뷰에서 그 프로젝트의 활동 탭으로 돌아간다(currentProjectId는 그대로 남아있음).
  // 강조 배너는 새 세션이 시작되면 더 이상 "방금 끝난 세션"이 아니므로 지운다.
  const continueMonitoring = async (): Promise<void> => {
    setJustCompletedSessionId(null)
    await monitoring.start()
    setView('project')
    setActiveTab('activity')
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
  // 진행률 클램프용 — 같은 턴 안에서 지금까지 보여준 최고 진행률(아래 currentTurnProgressPercent 참조).
  const progressFloorRef = useRef<{ turnId: string; percent: number } | null>(null)
  // Stop 훅(파이프라인)이 찍는 prompts.completed_at을 완료 판정의 근거로 쓴다 — 예전엔
  // AI 캡션(explanations)이 생겨야만 "완료"로 봤는데, 캡션은 5초 폴링+API 호출을 거쳐
  // 늦게 도착해서 에이전트가 실제로 멈춘 뒤에도 한참 "실행 중"으로 보이는 문제가 있었다.
  const currentTurnCompleted = currentTurn ? currentTurn.completed_at != null : false

  // "현재 프롬프트" 진행 상태 — 에이전트 작업은 오픈엔디드라 "전체 대비 몇 %"를 미리 알
  // 방법이 없다. 이 턴에서 닫힌 스텝 수(더 이상 이벤트가 안 붙는 단위) + 지금 열려 있는
  // 스텝(+0.5)을 90%로 포화하는 점근 곡선(1 - 0.7^n)에 넣어, 스텝이 쌓일수록 완만히
  // 차오르다가 완료 직전엔 이미 85~90%에 도달해 마지막 채움이 부드럽게 마무리되게 한다
  // (예전엔 스텝수/고정목표라 스텝이 적을 때 25%쯤에서 멈췄다가 완료 시 100%로 급히 튀었다).
  const currentTurnSteps = currentTurn
    ? steps.filter((s) => s.promptId === currentTurn.id)
    : []
  const currentTurnStepCount = currentTurnSteps.filter((s) => !s.inProgress).length
  const currentTurnHasActiveStep = currentTurnSteps.some((s) => s.inProgress)
  // "이 턴은 끝났다"는 completed_at(Stop 훅/idle 폴백)을 우선 근거로 삼되, Stop 훅이
  // 안 온 세션(흔하다 — 관찰 시작 전에 이미 열려 있던 Claude Code 세션은 훅이 하나도 안
  // 붙는다)에서도 하염없이 기다리지 않도록 liveStatus.idle(step-worker가 1.5초 주기로
  // 갱신하는 "지금 아무 도구도 안 쓰고 있다" 신호, idle 판정까지 45초)을 보조로 쓴다.
  // 단, 두 가지 오판 가드가 필요하다:
  // - 훅 마커가 관찰된 세션(liveStatus.hooksAlive)에선 idle 추측을 아예 쓰지 않는다 —
  //   완료는 Stop 훅이 즉시 찍어주므로 추측이 필요 없고, 도구 호출 없이 45초 넘게
  //   이어지는 thinking 구간을 완료로 오판해 진행바가 100%로 튀었다가 다음 tool_use에서
  //   되돌아오는 플리커(실제로 재현된 버그)의 원인만 된다.
  // - liveStatus는 세션 전체에서 가장 최근 스텝 하나만 보는 전역 신호라, 새 턴이 막
  //   시작해 이 턴의 스텝이 아직 하나도 없는 순간엔 "직전 턴의 마지막 스텝이 idle"이라는
  //   이유만으로 새 턴을 완료로 잘못 판정한다 — 이 턴 자신의 스텝이 하나라도 생긴
  //   뒤에만(currentTurnSteps.length > 0) 신뢰한다.
  // 캡션("직전 실행 과정") 생성은 completed_at 하나만 보고 뒤늦게 따라오므로, 이 빠른
  // 신호로 100%를 채워도 캡션 타이밍과는 무관하게 동작한다.
  const currentTurnLiveIdle =
    !liveStatus.hooksAlive && currentTurnSteps.length > 0 && liveStatus.idle
  const currentTurnDone = currentTurn != null && (currentTurnCompleted || currentTurnLiveIdle)
  // 완료 전 진행률은 같은 턴 안에서 절대 뒤로 가지 않게 클램프한다 — 스텝 경계는 새
  // 이벤트가 붙으면 재계산되는 파생값이라, 닫힌 줄 알았던 마지막 스텝이 다시 진행 중으로
  // 붙는 순간 effectiveSteps가 반 칸(0.5)씩 줄어 바가 미세하게 후퇴할 수 있다. 완료
  // 오판이 되돌려지는 경우(reopenPrompt)에도 100%에서 곧장 이전 최고치로 복귀해,
  // 낮은 값으로 뚝 떨어졌다가 다시 차오르는 모습을 보이지 않는다.
  const currentTurnProgressPercent = (() => {
    if (!monitoring.isMonitoring || currentTurn == null) return 0
    if (currentTurnDone) return 100
    const effectiveSteps = currentTurnStepCount + (currentTurnHasActiveStep ? 0.5 : 0)
    const raw = Math.round(5 + 85 * (1 - Math.pow(0.7, effectiveSteps)))
    const floor =
      progressFloorRef.current?.turnId === currentTurn.id ? progressFloorRef.current.percent : 0
    const percent = Math.max(raw, floor)
    progressFloorRef.current = { turnId: currentTurn.id, percent }
    return percent
  })()

  const turnItems = useMemo(() => buildTurnList(prompts, events), [prompts, events])
  const defaultTurnId = useMemo(() => {
    const realTurns = turnItems.filter((t) => t.turnIndex !== null)
    if (realTurns.length > 0) return realTurns[realTurns.length - 1].turnId
    return turnItems[0]?.turnId ?? null
  }, [turnItems])
  // selectedTurnId === ''(빈 문자열)은 "명시적으로 접음" 상태 — null(아직 아무것도
  // 안 골랐음, 기본값 사용)과 구분해야 접었던 항목이 defaultTurnId로 다시 살아나지 않는다.
  const effectiveTurnId = selectedTurnId === '' ? null : (selectedTurnId ?? defaultTurnId)
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

  // 개요 탭 "도움이 될 만한 내용"은 지금 보고 있는 프로젝트의 노트만 보여준다 —
  // useLectureNotes가 전 프로젝트 통합 목록을 반환하게 바뀐 뒤(학습 노트 뷰용),
  // 여기서 필터 없이 최신순만 자르면 어느 프로젝트를 열어도 똑같은 카드가 떠서
  // "현재 작업과 연결해 읽어보세요"라는 문구와 안 맞는 회귀가 있었다.
  const recentNotes = useMemo(
    () =>
      notes
        .filter((note) => note.project_id === currentProjectId)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .slice(0, 3),
    [notes, currentProjectId]
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
      <SkillSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSelect={applySkillProfile}
      />

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
            className="group flex items-center gap-2.5"
            aria-label="프로젝트 홈으로 이동"
          >
            <div className="grid size-7 place-items-center rounded-[9px] bg-[#285c52] text-white">
              <Sparkles
                size={15}
                className="transition-all duration-300 group-hover:fill-[#fde047] group-hover:text-[#fde047] group-hover:drop-shadow-[0_0_6px_rgba(253,224,71,.9)]"
              />
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
                setView('notes')
                setSideOpen(false)
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition ${
                view === 'notes'
                  ? 'bg-[#eaf4ef] font-medium text-[#285c52]'
                  : 'text-[#686b64] hover:bg-[#f1f0eb]'
              }`}
            >
              <BookOpen size={17} />
              학습 노트
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-[#686b64] transition hover:bg-[#f1f0eb]"
            >
              <SlidersHorizontal size={17} />
              <span className="min-w-0 flex-1">
                <span className="block">설정</span>
                <span className="block text-[11px] text-muted-foreground">
                  난이도: {SKILL_LEVEL_LABEL[skillLevel]}
                </span>
              </span>
            </button>
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

          {view === 'notes' && (
            <div>
              <div className="mb-6">
                <h1 className="text-[22px] font-semibold tracking-[-.03em]">학습 노트</h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  모든 프로젝트에서 만들어진 강의노트를 한곳에서 볼 수 있어요.
                </p>
              </div>
              {noteProjects.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setNotesProjectFilter(null)}
                    className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${
                      notesProjectFilter === null
                        ? 'bg-[#285c52] text-white'
                        : 'border border-border bg-white text-[#686b64] hover:bg-[#f1f0eb]'
                    }`}
                  >
                    전체
                  </button>
                  {noteProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setNotesProjectFilter(project.id)}
                      className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${
                        notesProjectFilter === project.id
                          ? 'bg-[#285c52] text-white'
                          : 'border border-border bg-white text-[#686b64] hover:bg-[#f1f0eb]'
                      }`}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
              )}
              <LectureNotesViewer
                notes={filteredNotes}
                justCompletedSessionId={justCompletedSessionId}
                onContinue={continueMonitoring}
                continuePending={monitoring.pending}
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
                onCompleteSession={completeSessionAndShowSummary}
                onOpenNotes={() => setView('notes')}
                onDeleteProject={deleteCurrentProject}
                deletingProject={deletingProject}
                deleteProjectDisabled={isMonitoringCurrentProject}
                deleteProjectDisabledReason="관찰 중에는 삭제할 수 없어요. 먼저 '오늘은 여기까지'를 눌러주세요"
                sessionId={sessionId}
                prompts={prompts}
                events={events}
                explanations={explanations}
                loading={loading}
                currentTurn={currentTurn}
                currentTurnDone={currentTurnDone}
                currentTurnStepCount={currentTurnStepCount}
                currentTurnProgressPercent={currentTurnProgressPercent}
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
                recentNotes={recentNotes}
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
  onCompleteSession: () => Promise<void>
  // 개요 탭 "도움이 될 만한 내용"의 노트 카드를 눌렀을 때 — 노트는 프로젝트 탭이 아니라
  // 최상위 학습 노트 뷰에 있으므로 App의 setView로 넘어가야 한다.
  onOpenNotes: () => void
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
  currentTurnDone: boolean
  currentTurnStepCount: number
  currentTurnProgressPercent: number
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
  recentNotes: ReturnType<typeof useLectureNotes>['notes']
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
  onCompleteSession,
  onOpenNotes,
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
  currentTurnDone,
  currentTurnStepCount,
  currentTurnProgressPercent,
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
  recentNotes,
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
            onComplete={onCompleteSession}
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
                  heightClassName="h-[420px]"
                />
              </div>
            </section>

            <RecentTurns
              prompts={prompts}
              events={events}
              explanations={explanations}
              loading={loading}
              expandedTurnId={effectiveTurnId}
              onToggleTurn={(turnId) => onSelectTurn(effectiveTurnId === turnId ? '' : turnId)}
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
                      {currentTurnDone ? '완료' : '실행 중'}
                    </span>
                  )}
                </div>
                <p className="mt-2 truncate text-[12px] font-medium text-[#3f514c]">
                  {monitoring.isMonitoring
                    ? stripSystemContextTags(currentTurn?.user_text ?? null) || '에이전트의 첫 작업을 기다리고 있어요'
                    : '트래킹을 켜면 실행 상태를 볼 수 있어요'}
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#efeee9]">
                  <div
                    className="h-full rounded-full bg-[#285c52] transition-all duration-700"
                    style={{ width: monitoring.isMonitoring ? `${currentTurnProgressPercent}%` : '0%' }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                  <span>
                    {monitoring.isMonitoring
                      ? currentTurnDone
                        ? '작업 완료 · 100%'
                        : `스텝 ${currentTurnStepCount}개 진행됨 · ${currentTurnProgressPercent}%`
                      : '업데이트 없음'}
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
                      onClick={onOpenNotes}
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
            {/* 이 배지 줄은 "지금 실제로 살아있는" 세션 상태(현재 프롬프트/진행 상황)를
                보여주는 자리 — 아래 큰 제목은 타임라인에서 고른 프롬프트를 보여주므로
                (선택 안 했으면 기본으로 최신 턴), 라이브 상태는 여기로 분리해뒀다. */}
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-[#3c7566]">
              <span
                className={`inline-block size-1.5 rounded-full ${
                  monitoring.isMonitoring ? 'bg-[#4f9c84]' : 'bg-[#a9aaa4]'
                }`}
              />
              {monitoring.isMonitoring ? 'LIVE SESSION' : '관찰 꺼짐'}
              {selectedTurnItem && selectedTurnItem.turnIndex !== null && (
                <>
                  <span className="text-[#c7c6bd]">·</span>
                  <span>
                    PROMPT {selectedTurnItem.turnIndex + 1} / {prompts.length}
                  </span>
                </>
              )}
              {monitoring.isMonitoring && currentTurn && (
                <>
                  <span className="text-[#c7c6bd]">·</span>
                  <span className="max-w-[260px] truncate font-mono text-[10px] font-normal tracking-normal text-[#6d7069]">
                    현재: {stripSystemContextTags(currentTurn.user_text) || '대기 중'}
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
            <h2 className="max-w-[900px] truncate text-[22px] font-semibold leading-tight tracking-[-0.03em] sm:text-[25px]">
              {selectedTurnItem
                ? selectedTurnItem.turnId === ORPHAN_TURN_ID
                  ? '수동으로 수정된 파일들'
                  : selectedTurnItem.userText || '(내용 없음)'
                : monitoring.isMonitoring
                  ? '에이전트의 첫 작업을 기다리고 있어요'
                  : '헤더 옆 "시작하기"를 누르면 관찰이 시작돼요'}
            </h2>
          </div>

          <SessionContextBar prompts={prompts} />

          {/* 사이드바 "지난 프롬프트"(세션 목록)와 겹치지 않도록 세로 목록 대신 타임라인
              노드 형태로 프롬프트를 고른다 — 개요 탭 "직전 실행의 과정"과 같은
              selectedTurnId 상태를 공유해 어느 화면에서 골라도 서로 반영된다. */}
          <PromptTimeline
            items={turnItems}
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
    </>
  )
}

export default App
