import { useCallback, useEffect, useState } from 'react'
import { useDataChanged } from './useDataChanged'

// push('data-changed')가 기본 갱신 경로라 폴링은 안전망으로만 남기고 주기를 늘렸다.
const POLL_INTERVAL_MS = 8000

interface UseMonitoringResult {
  isMonitoring: boolean
  sessionId: string | null
  monitoringProjectId: string | null
  start: () => Promise<void>
  complete: () => Promise<void>
  pending: boolean
}

// 사용자가 여러 AI 에이전트/프로젝트를 오갈 수 있어, 앱 실행 자체가 관찰 시작을
// 뜻하지 않는다 — "시작하기"를 눌러야 그 시점부터만 관찰하고(과거 트랜스크립트는
// 스킵), "완료"를 누르면 관찰을 멈추고 세션을 종료 처리해 강의노트를 트리거한다.
// 파이프라인은 프로세스 전체에 하나뿐이라, 지금 보고 있는 프로젝트가 아닌 다른
// 프로젝트를 관찰 중일 수도 있다(monitoringProjectId로 구분해 UI가 안내한다).
export function useMonitoring(projectId: string | null): UseMonitoringResult {
  const [isMonitoring, setIsMonitoring] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [monitoringProjectId, setMonitoringProjectId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const poll = useCallback(async (): Promise<void> => {
    const status = await window.factcoding.getMonitoringStatus()
    setIsMonitoring(status.isMonitoring)
    setSessionId(status.sessionId)
    setMonitoringProjectId(status.projectId)
  }, [])

  useEffect(() => {
    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [poll])

  // 세션이 시작/종료되면(다른 곳에서 트리거됐더라도) 즉시 반영.
  useDataChanged(['session'], poll)

  const start = async (): Promise<void> => {
    if (!projectId) return
    setPending(true)
    try {
      await window.factcoding.startMonitoring(projectId)
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

  return { isMonitoring, sessionId, monitoringProjectId, start, complete, pending }
}
