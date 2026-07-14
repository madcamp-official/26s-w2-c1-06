import type { AssistantNote, ToolEvent } from './types'

// 학습 파이프라인 4단계: tool_events를 "스텝" 단위로 묶는다. 예전에는 assistant_note
// (에이전트 서사 텍스트) 하나가 스텝 경계였는데, 이건 모델이 텍스트를 언제 쓰는지에
// 좌우돼 결정론적이지 않았다(같은 작업도 실행마다 다르게 잘림). 지금은 이벤트 스트림
// 자체의 유휴시간/개수만으로 정해지는 하이브리드 경계를 쓴다 — note는 이제 스텝
// 안에 우연히 들어온 부가 컨텍스트일 뿐, 경계가 아니다.

export const STEP_IDLE_GAP_MS = 90_000
export const MAX_EVENTS_PER_STEP = 6

export interface Step {
  id: string // 그 스텝의 첫 이벤트 id. 결정론적이고 재조회해도 항상 동일.
  promptId: string | null
  note: AssistantNote | null // 스텝의 시간 범위 안에 있던 note(가장 마지막 것). 없을 수 있음.
  events: ToolEvent[]
  startedAt: number // 정렬용 ms 타임스탬프
}

function timeMs(iso: string | null): number {
  return iso ? Date.parse(iso) : 0
}

// prompt_id(턴)로 먼저 버킷팅해 스텝이 턴 경계를 넘지 않게 한 뒤, 각 턴 안에서
// 이벤트를 시간순으로 훑으며 유휴시간(gap)/개수 cap을 넘을 때만 새 스텝을 연다.
// 결과는 스텝 시작 시각 오름차순.
export function groupIntoSteps(
  notes: AssistantNote[],
  events: ToolEvent[],
  opts: { idleGapMs?: number; maxEvents?: number } = {}
): Step[] {
  const idleGapMs = opts.idleGapMs ?? STEP_IDLE_GAP_MS
  const maxEvents = opts.maxEvents ?? MAX_EVENTS_PER_STEP
  const bucketKey = (promptId: string | null): string => promptId ?? '__orphan__'

  const eventsByBucket = new Map<string, ToolEvent[]>()
  for (const event of events) {
    const key = bucketKey(event.prompt_id)
    const bucket = eventsByBucket.get(key) ?? []
    bucket.push(event)
    eventsByBucket.set(key, bucket)
  }

  const notesByBucket = new Map<string, AssistantNote[]>()
  for (const note of notes) {
    const key = bucketKey(note.prompt_id)
    const bucket = notesByBucket.get(key) ?? []
    bucket.push(note)
    notesByBucket.set(key, bucket)
  }

  const steps: Step[] = []

  for (const [key, bucket] of eventsByBucket) {
    const sorted = [...bucket].sort((a, b) => timeMs(a.created_at) - timeMs(b.created_at))
    const bucketNotes = notesByBucket.get(key) ?? []

    let current: ToolEvent[] = []
    let lastEventTime = -Infinity
    const promptId = sorted[0]?.prompt_id ?? null

    const flush = (): void => {
      if (current.length === 0) return
      const startedAt = timeMs(current[0].created_at)
      const endedAt = timeMs(current[current.length - 1].created_at)
      // 스텝 시간 범위 안에 들어온 note 중 가장 마지막 것을 부가 컨텍스트로 붙인다.
      const noteInRange = bucketNotes
        .filter((n) => {
          const t = timeMs(n.created_at)
          return t >= startedAt && t <= endedAt
        })
        .sort((a, b) => timeMs(a.created_at) - timeMs(b.created_at))
        .at(-1)

      steps.push({
        id: current[0].id,
        promptId,
        note: noteInRange ?? null,
        events: current,
        startedAt
      })
      current = []
    }

    for (const event of sorted) {
      const t = timeMs(event.created_at)
      if (current.length > 0 && (t - lastEventTime > idleGapMs || current.length >= maxEvents)) {
        flush()
      }
      current.push(event)
      lastEventTime = t
    }
    flush()
  }

  steps.sort((a, b) => a.startedAt - b.startedAt)
  return steps
}
