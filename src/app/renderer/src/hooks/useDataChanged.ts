import { useEffect, useRef } from 'react'
import type { DataChangeKind } from '@shared/types'

// SPEC 4.6: main이 DB를 갱신할 때 push하는 'data-changed'를 구독해 즉시 재조회를
// 트리거한다. onChanged는 매 렌더마다 새 함수가 와도 괜찮도록 ref로 최신 값만
// 유지하고, 구독 자체는 kinds 집합이 바뀔 때만 다시 건다(사실상 마운트 1회).
// 각 훅의 기존 폴링은 이 push를 놓친 경우(리스너 등록 전 이벤트 등)의 안전망으로 남겨둔다.
export function useDataChanged(kinds: DataChangeKind[], onChanged: () => void): void {
  const callbackRef = useRef(onChanged)
  callbackRef.current = onChanged

  const kindsKey = kinds.join(',')

  useEffect(() => {
    const relevant = new Set(kindsKey.split(',') as DataChangeKind[])
    return window.factcoding.onDataChanged((kind) => {
      if (relevant.has(kind)) callbackRef.current()
    })
  }, [kindsKey])
}
