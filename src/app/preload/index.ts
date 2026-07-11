import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  LectureNote,
  Prompt,
  SkillLevel,
  ToolEvent
} from '@shared/types'

const factcodingApi = {
  getLatestSessionId: (): Promise<string | null> => ipcRenderer.invoke('db:getLatestSessionId'),
  getToolEvents: (sessionId: string): Promise<ToolEvent[]> =>
    ipcRenderer.invoke('db:getToolEvents', sessionId),
  getPrompts: (sessionId: string): Promise<Prompt[]> =>
    ipcRenderer.invoke('db:getPrompts', sessionId),
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
    ipcRenderer.invoke('db:answerQuestion', sessionId, question, skillLevel)
}

export type FactcodingApi = typeof factcodingApi

contextBridge.exposeInMainWorld('factcoding', factcodingApi)
