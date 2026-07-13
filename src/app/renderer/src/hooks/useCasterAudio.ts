import { useCallback, useEffect, useRef, useState } from 'react'
import type { TtsSettings, TtsUtterance } from '@shared/tts'
import { AudioQueueManager } from '../audio/AudioQueueManager'

interface UseCasterAudioResult {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  voice: TtsSettings['voice']
  /** 지금 캐스터 음성이 낭독 중인 스텝 id (utterance.id === stepId). 안 말하는 중이면 null. */
  speakingStepId: string | null
}

export function useCasterAudio(): UseCasterAudioResult {
  const [speakingStepId, setSpeakingStepId] = useState<string | null>(null)
  const queueRef = useRef(
    new AudioQueueManager({
      onSpeakStart: (id) => setSpeakingStepId(id),
      onSpeakEnd: (id) => setSpeakingStepId((current) => (current === id ? null : current))
    })
  )
  const [enabled, setEnabledState] = useState(true)
  const [voice, setVoice] = useState<TtsSettings['voice']>('ko-KR-InJoonNeural')
  const enabledRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    window.factcoding.getTtsSettings().then((settings) => {
      if (cancelled) return
      setEnabledState(settings.enabled)
      enabledRef.current = settings.enabled
      setVoice(settings.voice)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.factcoding.onTtsUtterance((utterance: TtsUtterance) => {
      if (!enabledRef.current) return
      queueRef.current.playSpeech(utterance)
    })
    return () => {
      unsubscribe()
      queueRef.current.stop()
    }
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    enabledRef.current = next
    setEnabledState(next)
    void window.factcoding.setTtsEnabled(next)
    if (!next) queueRef.current.stop()
  }, [])

  return { enabled, setEnabled, voice, speakingStepId }
}
