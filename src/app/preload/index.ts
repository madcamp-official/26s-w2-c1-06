import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  DataChangeKind,
  LectureNote,
  OnboardingProfile,
  Project,
  Prompt,
  SessionWithPreview,
  SkillLevel,
  StepWithExplanation,
  ToolEvent
} from '@shared/types'
import type { LiveStatus } from '@shared/stepProgress'

export interface MonitoringStatus {
  isMonitoring: boolean
  sessionId: string | null
  projectId: string | null
}

const factcodingApi = {
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke('project:list'),
  createProject: (name: string, workspacePath: string): Promise<Project> =>
    ipcRenderer.invoke('project:create', name, workspacePath),
  selectProjectFolder: (): Promise<string | null> => ipcRenderer.invoke('project:selectFolder'),
  deleteProject: (projectId: string): Promise<void> => ipcRenderer.invoke('project:delete', projectId),
  getLatestSessionId: (projectId: string): Promise<string | null> =>
    ipcRenderer.invoke('db:getLatestSessionId', projectId),
  getToolEvents: (sessionId: string): Promise<ToolEvent[]> =>
    ipcRenderer.invoke('db:getToolEvents', sessionId),
  getPrompts: (sessionId: string): Promise<Prompt[]> =>
    ipcRenderer.invoke('db:getPrompts', sessionId),
  getSkillLevel: (): Promise<SkillLevel> => ipcRenderer.invoke('db:getSkillLevel'),
  setSkillLevel: (level: SkillLevel): Promise<void> => ipcRenderer.invoke('db:setSkillLevel', level),
  getExplanations: (sessionId: string, skillLevel: SkillLevel): Promise<AiExplanation[]> =>
    ipcRenderer.invoke('db:getExplanations', sessionId, skillLevel),
  getSteps: (sessionId: string, skillLevel: SkillLevel): Promise<StepWithExplanation[]> =>
    ipcRenderer.invoke('db:getSteps', sessionId, skillLevel),
  getCodeUnits: (projectId: string): Promise<CodeUnit[]> => ipcRenderer.invoke('db:getCodeUnits', projectId),
  getUnitVersions: (unitId: string): Promise<CodeUnitVersionWithUnit[]> =>
    ipcRenderer.invoke('db:getUnitVersions', unitId),
  getUnitVersionExplanations: (unitId: string, skillLevel: SkillLevel): Promise<AiExplanation[]> =>
    ipcRenderer.invoke('db:getUnitVersionExplanations', unitId, skillLevel),
  getUnitVersionsByPrompt: (promptId: string | null, sessionId: string): Promise<CodeUnitVersionWithUnit[]> =>
    ipcRenderer.invoke('db:getUnitVersionsByPrompt', promptId, sessionId),
  getUnitVersionExplanationsByPrompt: (
    promptId: string | null,
    sessionId: string,
    skillLevel: SkillLevel
  ): Promise<AiExplanation[]> =>
    ipcRenderer.invoke('db:getUnitVersionExplanationsByPrompt', promptId, sessionId, skillLevel),
  getCodeUnitEdges: (projectId: string): Promise<CodeUnitEdge[]> =>
    ipcRenderer.invoke('db:getCodeUnitEdges', projectId),
  getLectureNotes: (projectId: string): Promise<LectureNote[]> =>
    ipcRenderer.invoke('db:getLectureNotes', projectId),
  isOnboardingComplete: (): Promise<boolean> => ipcRenderer.invoke('db:isOnboardingComplete'),
  completeOnboarding: (): Promise<void> => ipcRenderer.invoke('db:completeOnboarding'),
  getOnboardingProfile: (): Promise<OnboardingProfile | null> =>
    ipcRenderer.invoke('db:getOnboardingProfile'),
  saveOnboardingProfile: (profile: OnboardingProfile): Promise<void> =>
    ipcRenderer.invoke('db:saveOnboardingProfile', profile),
  explainVersionOverride: (versionId: string, skillLevel: SkillLevel): Promise<AiExplanation | null> =>
    ipcRenderer.invoke('db:explainVersionOverride', versionId, skillLevel),
  regenerateLectureNote: (sessionId: string, skillLevel: SkillLevel): Promise<LectureNote | null> =>
    ipcRenderer.invoke('db:regenerateLectureNote', sessionId, skillLevel),
  answerQuestion: (sessionId: string, question: string, skillLevel: SkillLevel): Promise<string> =>
    ipcRenderer.invoke('db:answerQuestion', sessionId, question, skillLevel),
  getSessions: (projectId: string): Promise<SessionWithPreview[]> =>
    ipcRenderer.invoke('db:getSessions', projectId),
  startMonitoring: (projectId: string): Promise<void> =>
    ipcRenderer.invoke('pipeline:startMonitoring', projectId),
  completeMonitoring: (): Promise<void> => ipcRenderer.invoke('pipeline:completeMonitoring'),
  getMonitoringStatus: (): Promise<MonitoringStatus> => ipcRenderer.invoke('pipeline:getMonitoringStatus'),
  // SPEC 4.6: main이 DB를 갱신할 때마다 push하는 'data-changed'를 구독한다.
  // 렌더러 훅들은 이걸로 즉시 재조회하고, 놓친 경우에 대비한 폴링을 안전망으로 유지한다.
  // 반환값을 호출해 구독을 해제할 것(컴포넌트 unmount 시 리스너 누적 방지).
  onDataChanged: (callback: (kind: DataChangeKind) => void): (() => void) => {
    const listener = (_event: unknown, kind: DataChangeKind): void => callback(kind)
    ipcRenderer.on('data-changed', listener)
    return () => ipcRenderer.removeListener('data-changed', listener)
  },
  // 실시간 진행 로그의 "지금 하는 중" 한 줄 상태 — data-changed(ai_explanations 확정
  // 시점)보다 훨씬 빠른 별도 주기로 push된다(step-worker.ts). 마운트 캐치업은
  // getLiveStatus(pull)로 한 번 당겨온다.
  getLiveStatus: (): Promise<LiveStatus> => ipcRenderer.invoke('step:getLiveStatus'),
  onStepLiveStatus: (callback: (status: LiveStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: LiveStatus): void => callback(status)
    ipcRenderer.on('step-live-status', listener)
    return () => ipcRenderer.removeListener('step-live-status', listener)
  }
}

export type FactcodingApi = typeof factcodingApi

contextBridge.exposeInMainWorld('factcoding', factcodingApi)
