import type { TtsPriority, TtsUtterance } from '@shared/tts'

export interface AudioQueueListeners {
  onSpeakStart?: (utteranceId: string) => void
  onSpeakEnd?: (utteranceId: string) => void
}

/**
 * 실시간 캐스터 TTS용 interrupt/drop 컨트롤러.
 * normal이 재생 중이면 새 normal은 드롭하고, high는 현재 재생을 끊고 들어온다.
 * (이름에 Queue가 있지만 밀림 방지를 위해 실제로는 대기열을 쌓지 않는다.)
 */
export class AudioQueueManager {
  private currentAudio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private isPlaying = false
  private currentId: string | null = null

  constructor(private listeners: AudioQueueListeners = {}) {}

  playSpeech(utterance: TtsUtterance): void {
    const isHighPriority = utterance.priority === 'high'

    if (this.isPlaying && isHighPriority) {
      this.stopCurrent()
    } else if (this.isPlaying) {
      console.log('[tts] busy — dropping normal utterance', utterance.id)
      return
    }

    const dataUrl = `data:${utterance.mimeType};base64,${utterance.audioBase64}`
    const audio = new Audio(dataUrl)
    this.currentAudio = audio
    this.isPlaying = true
    this.currentId = utterance.id
    this.listeners.onSpeakStart?.(utterance.id)

    audio.onended = () => {
      this.clearCurrent(audio)
    }
    audio.onerror = () => {
      console.error('[tts] playback error', utterance.id)
      this.clearCurrent(audio)
    }

    void audio.play().catch((err) => {
      console.error('[tts] play() failed:', err)
      this.clearCurrent(audio)
    })
  }

  stop(): void {
    this.stopCurrent()
  }

  private stopCurrent(): void {
    if (!this.currentAudio) {
      this.isPlaying = false
      return
    }
    this.currentAudio.pause()
    this.currentAudio.src = ''
    this.clearCurrent(this.currentAudio)
  }

  private clearCurrent(audio: HTMLAudioElement): void {
    if (this.currentAudio !== audio) return
    const finishedId = this.currentId
    this.currentAudio = null
    this.isPlaying = false
    this.currentId = null
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    if (finishedId) this.listeners.onSpeakEnd?.(finishedId)
  }
}

export type { TtsPriority }
