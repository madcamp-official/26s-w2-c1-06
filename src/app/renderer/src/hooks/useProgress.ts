import { useEffect, useRef, useState } from 'react'
import type { ProgressUpdate, StepStatus } from '@shared/progress'

// 6에서 늘림: StepLog가 "이전 진행상황 더 보기"로 접어서 보여주므로(SPEC 패치 v2 #7),
// 화면에 다 펼치지 않아도 히스토리 자체는 넉넉히 들고 있어야 구조도 노드 클릭 시
// 오래된 스텝도 스크롤 대상으로 찾을 수 있다(SPEC 패치 v2 #6).
const MAX_HISTORY = 100
// 사이클이 100%를 찍고 리셋될 때, 다음 사이클 값을 곧장 덮어써버리면 결승선
// 애니메이션을 볼 틈이 없다 — 이 시간만큼 100%를 유지했다가 다음 값을 적용한다.
const FINISH_HOLD_MS = 900

export interface ProgressLogEntry {
  stepId: string
  summary: string
  keyCode: ProgressUpdate['keyCode']
  errorDetail: string | null
  status: StepStatus
  receivedAt: number
}

interface UseProgressResult {
  percent: number
  cycleId: string | null
  cycleNumber: number | null
  stepsInCycle: number
  cycleSize: number
  history: ProgressLogEntry[]
  justCompleted: boolean
  // 이번 사이클에서 실패로 판정된 스텝들이 완료된 시점의 percent — 로딩바에 실패 지점을
  // 눈금으로 표시하는 데 쓴다(SPEC 패치 v2 #5). 사이클이 롤오버되면 함께 비워진다.
  failMarks: number[]
}

export function useProgress(): UseProgressResult {
  const [percent, setPercent] = useState(0)
  const [cycleId, setCycleId] = useState<string | null>(null)
  const [cycleNumber, setCycleNumber] = useState<number | null>(null)
  const [stepsInCycle, setStepsInCycle] = useState(0)
  const [cycleSize, setCycleSize] = useState(8)
  const [history, setHistory] = useState<ProgressLogEntry[]>([])
  const [justCompleted, setJustCompleted] = useState(false)
  const [failMarks, setFailMarks] = useState<number[]>([])
  const lastAppliedPercentRef = useRef(0)
  // onProgressUpdate 구독은 마운트 시 한 번만 걸리므로(아래 useEffect deps: []) 콜백
  // 안에서 state를 직접 읽으면 마운트 시점 값에 고정된다(stale closure) — 사이클 전환
  // 판정에 쓰는 "지금 cycleId"는 항상 최신값을 봐야 하므로 ref로 따로 들고 다닌다.
  const cycleIdRef = useRef<string | null>(null)
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
          {
            stepId: update.stepId,
            summary: update.summary,
            keyCode: update.keyCode,
            errorDetail: update.errorDetail,
            status: update.status,
            receivedAt: Date.now()
          },
          ...prev
        ].slice(0, MAX_HISTORY)
      )

      setCycleNumber(update.cycleNumber)
      setStepsInCycle(update.stepsInCycle)
      setCycleSize(update.cycleSize)

      // 새 사이클로 넘어가면(직전 cycleId와 다르면) 이전 사이클의 실패 눈금은 더 이상
      // 의미가 없으니 비우고 시작한다.
      const isNewCycle = update.cycleId !== cycleIdRef.current
      cycleIdRef.current = update.cycleId
      setFailMarks((prev) => {
        const carried = isNewCycle ? [] : prev
        return update.status === 'failed' ? [...carried, update.percent] : carried
      })

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { percent, cycleId, cycleNumber, stepsInCycle, cycleSize, history, justCompleted, failMarks }
}
