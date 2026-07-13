import type { AssistantNote, ToolEvent } from './types'

// 학습 파이프라인 4단계: tool_events를 "스텝" 단위로 묶는다. 스텝 = 에이전트가
// 남긴 서사 텍스트(assistant_note) 하나 + 그 뒤 다음 텍스트(또는 턴 끝)까지의
// 액션들. 개별 액션을 낱개로 캡션 다는 대신, 한 스텝을 하나의 읽을 수 있는
// 단위로 요약해 "무엇을 하려고 어떤 행동들을 했는지"를 보여주기 위함.
// main(캡션 생성)과 renderer(렌더링)가 동일한 그룹핑을 공유한다.

export interface Step {
  // note가 있는 스텝은 note.id(= 요약 캐시의 target_id). note 없는 선행 스텝은
  // null(요약하지 않고 원시 이벤트 행만 보여줌 — 요약할 서사가 애초에 없음).
  id: string | null
  promptId: string | null
  note: AssistantNote | null
  events: ToolEvent[]
  startedAt: number // 정렬용 ms 타임스탬프
}

function timeMs(iso: string | null): number {
  return iso ? Date.parse(iso) : 0
}

// prompt_id(턴)로 먼저 버킷팅해 스텝이 턴 경계를 넘지 않게 한 뒤, 각 턴 안에서
// note를 경계로 스텝을 만든다. 결과는 스텝 시작 시각 오름차순.
export function groupIntoSteps(notes: AssistantNote[], events: ToolEvent[]): Step[] {
  const bucketKey = (promptId: string | null): string => promptId ?? '__orphan__'

  interface Item {
    kind: 'note' | 'event'
    note?: AssistantNote
    event?: ToolEvent
    promptId: string | null
    at: number
  }

  const itemsByBucket = new Map<string, Item[]>()
  const pushItem = (item: Item): void => {
    const key = bucketKey(item.promptId)
    const bucket = itemsByBucket.get(key) ?? []
    bucket.push(item)
    itemsByBucket.set(key, bucket)
  }

  for (const note of notes)
    pushItem({ kind: 'note', note, promptId: note.prompt_id, at: timeMs(note.created_at) })
  for (const event of events)
    pushItem({ kind: 'event', event, promptId: event.prompt_id, at: timeMs(event.created_at) })

  const steps: Step[] = []

  for (const [, bucket] of itemsByBucket) {
    // note가 event보다 뒤 시각으로 들어와도 스텝 경계로 삼기 위해, 같은 시각이면
    // note가 event보다 먼저 오도록 안정 정렬한다(에이전트 메시지의 text 블록이
    // 같은 라인의 tool_use보다 논리적으로 앞서므로).
    bucket.sort((a, b) => a.at - b.at || (a.kind === 'note' ? -1 : 1) - (b.kind === 'note' ? -1 : 1))

    let current: Step | null = null
    const flush = (): void => {
      if (current && (current.note !== null || current.events.length > 0)) steps.push(current)
      current = null
    }

    for (const item of bucket) {
      if (item.kind === 'note') {
        flush()
        current = {
          id: item.note!.id,
          promptId: item.promptId,
          note: item.note!,
          events: [],
          startedAt: item.at
        }
      } else {
        if (!current) {
          // 턴의 첫 note 이전에 발생한 이벤트 → note 없는 선행 스텝
          current = { id: null, promptId: item.promptId, note: null, events: [], startedAt: item.at }
        }
        current.events.push(item.event!)
      }
    }
    flush()
  }

  steps.sort((a, b) => a.startedAt - b.startedAt)
  return steps
}
