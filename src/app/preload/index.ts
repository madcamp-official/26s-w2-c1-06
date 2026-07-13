import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AiExplanation,
  AssistantNote,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  LectureNote,
  MatchStats,
  Prompt,
  Session,
  SkillLevel,
  ToolEvent,
  UnitMatchStat
} from '@shared/types'
import type { LiveStatus, ProgressState, ProgressUpdate } from '@shared/progress'

const factcodingApi = {
  getLatestSessionId: (): Promise<string | null> => ipcRenderer.invoke('db:getLatestSessionId'),
  getLatestSession: (): Promise<Session | null> => ipcRenderer.invoke('db:getLatestSession'),
  getMatchStats: (sessionId: string): Promise<MatchStats> =>
    ipcRenderer.invoke('db:getMatchStats', sessionId),
  getUnitMatchStats: (): Promise<UnitMatchStat[]> => ipcRenderer.invoke('db:getUnitMatchStats'),
  getProgressState: (): Promise<ProgressState> => ipcRenderer.invoke('db:getProgressState'),
  getLiveStatus: (): Promise<LiveStatus> => ipcRenderer.invoke('db:getLiveStatus'),
  getCreatedToolEventIds: (sessionId: string): Promise<string[]> =>
    ipcRenderer.invoke('db:getCreatedToolEventIds', sessionId),
  getToolEvents: (sessionId: string): Promise<ToolEvent[]> =>
    ipcRenderer.invoke('db:getToolEvents', sessionId),
  getPrompts: (sessionId: string): Promise<Prompt[]> =>
    ipcRenderer.invoke('db:getPrompts', sessionId),
  getAssistantNotes: (sessionId: string): Promise<AssistantNote[]> =>
    ipcRenderer.invoke('db:getAssistantNotes', sessionId),
  getSkillLevel: (): Promise<SkillLevel> => ipcRenderer.invoke('db:getSkillLevel'),
  setSkillLevel: (level: SkillLevel): Promise<void> => ipcRenderer.invoke('db:setSkillLevel', level),
  getExplanations: (sessionId: string, skillLevel: SkillLevel): Promise<AiExplanation[]> =>
    ipcRenderer.invoke('db:getExplanations', sessionId, skillLevel),
  getCodeUnits: (): Promise<CodeUnit[]> => ipcRenderer.invoke('db:getCodeUnits'),
  getUnitVersions: (unitId: string): Promise<CodeUnitVersionWithUnit[]> =>
    ipcRenderer.invoke('db:getUnitVersions', unitId),
  getUnitVersionExplanations: (unitId: string, skillLevel: SkillLevel): Promise<AiExplanation[]> =>
    ipcRenderer.invoke('db:getUnitVersionExplanations', unitId, skillLevel),
  getCodeUnitEdges: (): Promise<CodeUnitEdge[]> => ipcRenderer.invoke('db:getCodeUnitEdges'),
  getLectureNotes: (): Promise<LectureNote[]> => ipcRenderer.invoke('db:getLectureNotes'),
  isOnboardingComplete: (): Promise<boolean> => ipcRenderer.invoke('db:isOnboardingComplete'),
  completeOnboarding: (): Promise<void> => ipcRenderer.invoke('db:completeOnboarding'),
  explainVersionOverride: (versionId: string, skillLevel: SkillLevel): Promise<AiExplanation | null> =>
    ipcRenderer.invoke('db:explainVersionOverride', versionId, skillLevel),
  regenerateLectureNote: (sessionId: string, skillLevel: SkillLevel): Promise<LectureNote | null> =>
    ipcRenderer.invoke('db:regenerateLectureNote', sessionId, skillLevel),
  answerQuestion: (sessionId: string, question: string, skillLevel: SkillLevel): Promise<string> =>
    ipcRenderer.invoke('db:answerQuestion', sessionId, question, skillLevel),

  onProgressUpdate: (callback: (update: ProgressUpdate) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, update: ProgressUpdate): void => {
      callback(update)
    }
    ipcRenderer.on('progress:update', listener)
    return () => {
      ipcRenderer.removeListener('progress:update', listener)
    }
  },

  onLiveStatus: (callback: (status: LiveStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: LiveStatus): void => {
      callback(status)
    }
    ipcRenderer.on('progress:live-status', listener)
    return () => {
      ipcRenderer.removeListener('progress:live-status', listener)
    }
  }
}

export type FactcodingApi = typeof factcodingApi

contextBridge.exposeInMainWorld('factcoding', factcodingApi)
