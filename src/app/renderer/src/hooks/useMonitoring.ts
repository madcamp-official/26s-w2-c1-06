import { useCallback, useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 2000

interface UseMonitoringResult {
  isMonitoring: boolean
  sessionId: string | null
  start: () => Promise<void>
  complete: () => Promise<void>
  pending: boolean
}

// 사용자가 여러 AI 에이전트/프로젝트를 오갈 수 있어, 앱 실행 자체가 관찰 시작을
// 뜻하지 않는다 — "시작하기"를 눌러야 그 시점부터만 관찰하고(과거 트랜스크립트는
// 스킵), "완료"를 누르면 관찰을 멈추고 세션을 종료 처리해 강의노트를 트리거한다.
export function useMonitoring(): UseMonitoringResult {
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const poll = useCallback(async (): Promise<void> => {
    const status = await window.factcoding.getMonitoringStatus()
    setIsMonitoring(status.isMonitoring)
    setSessionId(status.sessionId)
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      const status = await window.factcoding.getMonitoringStatus()
      if (!cancelled) {
        setIsMonitoring(status.isMonitoring)
        setSessionId(status.sessionId)
      }
    }
    tick()
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const start = async (): Promise<void> => {
    setPending(true)
    try {
      await window.factcoding.startMonitoring()
      await poll()
    } finally {
      setPending(false)
    }
  }

  const complete = async (): Promise<void> => {
    setPending(true)
    try {
      await window.factcoding.completeMonitoring()
      await poll()
    } finally {
      setPending(false)
    }
  }

  return { isMonitoring, sessionId, start, complete, pending }
}
