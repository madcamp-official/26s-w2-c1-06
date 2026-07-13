// Main → Renderer TTS 재생 페이로드 (IPC tts:utterance / tts:speak 응답)
export type TtsPriority = 'normal' | 'high'
export type TtsSource = 'step' | 'version_override' | 'manual'

export interface TtsUtterance {
  id: string
  mimeType: string
  audioBase64: string
  priority: TtsPriority
  source: TtsSource
}

export interface TtsSettings {
  enabled: boolean
  voice: 'ko-KR-InJoonNeural' | 'ko-KR-SunHiNeural'
}
