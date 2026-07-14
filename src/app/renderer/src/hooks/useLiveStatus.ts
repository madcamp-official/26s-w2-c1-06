import { useEffect, useState } from 'react'
import type { LiveStatus } from '@shared/stepProgress'

const IDLE: LiveStatus = { text: '', idle: true }

// "지금 하는 중" 한 줄 상태(step-worker.ts) — DB 폴링이 아니라 훨씬 빠른 별도 push
// 주기(step:live-status)로 갱신된다. 마운트 시 getLiveStatus로 한 번 당겨오는 이유는
// push가 이 컴포넌트가 아직 구독하기 전(또는 창이 없던 시점)에 이미 지나갔을 수
// 있어서다 — 이후로는 상태가 안 바뀌면 dedupe 때문에 재전송이 없다.
export function useLiveStatus(): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(IDLE)

  useEffect(() => {
    let cancelled = false
    window.factcoding.getLiveStatus().then((initial) => {
      if (!cancelled) setStatus(initial)
    })
    const unsubscribe = window.factcoding.onStepLiveStatus((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return status
}
