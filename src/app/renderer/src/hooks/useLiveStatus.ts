import { useEffect, useRef, useState } from 'react'
import type { LiveStatus } from '@shared/progress'

const IDLE_STATUS: LiveStatus = { text: '', idle: true }

// progress:live-status도 push라 워커가 이 모듈 로드 시점(BrowserWindow가 아직 없을 때)
// 곧바로 쏘는 최초 상태는 브로드캐스트할 창이 없어 유실된다 — 그 뒤로 DB 상태가 안
// 바뀌면 워커 쪽 dedupe 때문에 재전송도 안 되니(progress-worker.ts computeLiveStatus 참고),
// progress:update와 동일하게 마운트 시 한 번 db:getLiveStatus로 당겨와 초기화해야 한다.
export function useLiveStatus(): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(IDLE_STATUS)
  const receivedLiveUpdateRef = useRef(false)

  useEffect(() => {
    const unsubscribe = window.factcoding.onLiveStatus((next) => {
      receivedLiveUpdateRef.current = true
      setStatus(next)
    })

    window.factcoding.getLiveStatus().then((state) => {
      if (receivedLiveUpdateRef.current) return
      setStatus(state)
    })

    return unsubscribe
  }, [])

  return status
}
