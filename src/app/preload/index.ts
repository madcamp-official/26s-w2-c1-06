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
import type { TtsSettings, TtsUtterance } from '@shared/tts'

const factcodingApi = {
  getLatestSessionId: (): Promise<string | null> => ipcRenderer.invoke('db:getLatestSessionId'),
  getLatestSession: (): Promise<Session | null> => ipcRenderer.invoke('db:getLatestSession'),
  getMatchStats: (sessionId: string): Promise<MatchStats> =>
    ipcRenderer.invoke('db:getMatchStats', sessionId),
  getUnitMatchStats: (): Promise<UnitMatchStat[]> => ipcRenderer.invoke('db:getUnitMatchStats'),
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
  getStepExplanations: (sessionId: string, skillLevel: SkillLevel): Promise<AiExplanation[]> =>
    ipcRenderer.invoke('db:getStepExplanations', sessionId, skillLevel),
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

  getTtsSettings: (): Promise<TtsSettings> => ipcRenderer.invoke('tts:getSettings'),
  setTtsEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('tts:setEnabled', enabled),
  setTtsVoice: (voice: TtsSettings['voice']): Promise<void> =>
    ipcRenderer.invoke('tts:setVoice', voice),
  speakTts: (payload: {
    id: string
    text: string
    priority?: TtsUtterance['priority']
  }): Promise<TtsUtterance | null> => ipcRenderer.invoke('tts:speak', payload),
  onTtsUtterance: (callback: (utterance: TtsUtterance) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, utterance: TtsUtterance): void => {
      callback(utterance)
    }
    ipcRenderer.on('tts:utterance', listener)
    return () => {
      ipcRenderer.removeListener('tts:utterance', listener)
    }
  }
}

export type FactcodingApi = typeof factcodingApi

contextBridge.exposeInMainWorld('factcoding', factcodingApi)
