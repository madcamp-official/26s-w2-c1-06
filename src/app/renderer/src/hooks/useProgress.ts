import { useEffect, useRef, useState } from 'react'
import type { ProgressUpdate } from '@shared/progress'

const MAX_HISTORY = 6
// 사이클이 100%를 찍고 리셋될 때, 다음 사이클 값을 곧장 덮어써버리면 결승선
// 애니메이션을 볼 틈이 없다 — 이 시간만큼 100%를 유지했다가 다음 값을 적용한다.
const FINISH_HOLD_MS = 900

export interface ProgressLogEntry {
  stepId: string
  summary: string
  keyCode: ProgressUpdate['keyCode']
  receivedAt: number
}

interface UseProgressResult {
  percent: number
  cycleId: string | null
  history: ProgressLogEntry[]
  justCompleted: boolean
}

export function useProgress(): UseProgressResult {
  const [percent, setPercent] = useState(0)
  const [cycleId, setCycleId] = useState<string | null>(null)
  const [history, setHistory] = useState<ProgressLogEntry[]>([])
  const [justCompleted, setJustCompleted] = useState(false)
  const lastAppliedPercentRef = useRef(0)
  // progress:update는 push라 이 컴포넌트가 마운트되어 구독을 걸기 전에 끝난 스텝의
  // 업데이트는 영영 유실된다(Electron IPC는 버퍼링 안 함) — 마운트 시
  // db:getProgressState로 "지금까지 쌓인 상태"를 한 번 당겨와 보충한다. 이 플래그로
  // 그 사이 실시간 업데이트가 먼저 도착했으면 캐치업 응답이 최신 값을 덮어쓰지 않게 한다.
  const receivedLiveUpdateRef = useRef(false)

  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = window.factcoding.onProgressUpdate((update) => {
      receivedLiveUpdateRef.current = true
      setHistory((prev) =>
        [
          { stepId: update.stepId, summary: update.summary, keyCode: update.keyCode, receivedAt: Date.now() },
          ...prev
        ].slice(0, MAX_HISTORY)
      )

      if (resetTimer) clearTimeout(resetTimer)

      const wasAtFinish = lastAppliedPercentRef.current >= 100
      if (wasAtFinish && update.percent < 100) {
        setJustCompleted(true)
        resetTimer = setTimeout(() => {
          setJustCompleted(false)
          setPercent(update.percent)
          setCycleId(update.cycleId)
          lastAppliedPercentRef.current = update.percent
        }, FINISH_HOLD_MS)
        return
      }

      setPercent(update.percent)
      setCycleId(update.cycleId)
      lastAppliedPercentRef.current = update.percent
    })

    window.factcoding.getProgressState().then((state) => {
      if (receivedLiveUpdateRef.current) return
      setPercent(state.percent)
      setHistory(state.history.map((entry) => ({ ...entry, receivedAt: Date.now() })))
      lastAppliedPercentRef.current = state.percent
    })

    return () => {
      unsubscribe()
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [])

  return { percent, cycleId, history, justCompleted }
}
