import type { Prompt, ToolEvent } from '@shared/types'

// 프롬프트에 연결되지 않은 이벤트(수동 수정 등, SPEC 4.1 fallback)를 가리키는 고정 키 —
// 실제 prompt.id(UUID)와 충돌하지 않는다.
export const ORPHAN_TURN_ID = '__orphan__'

export interface TurnListItem {
  turnId: string
  turnIndex: number | null
  userText: string | null
  eventCount: number
  isLastTurn: boolean
}

// tool_events를 프롬프트 단위로 묶어 "코딩 수정이 완료된 단위"만 뽑아낸다 — 개별
// Read/Write/Bash를 나열하지 않고 프롬프트 하나하나를 가리키는 데이터만 만든다.
// 실제 목록 UI는 RecentTurns(개요 탭 "직전 실행의 과정")가 담당하고, App.tsx는 이
// 결과로 "기본으로 보여줄 프롬프트"를 계산한다 — 여기는 순수 데이터 가공만 한다
// (예전엔 이 파일이 "턴 목록" 패널 자체도 그렸지만, 사이드바 "지난 프롬프트" 목록과
// 겹쳐 보여서 그 UI는 제거했다).
export function buildTurnList(prompts: Prompt[], events: ToolEvent[]): TurnListItem[] {
  const promptIds = new Set(prompts.map((p) => p.id))
  const countByPrompt = new Map<string, number>()
  let orphanCount = 0

  for (const event of events) {
    if (event.prompt_id && promptIds.has(event.prompt_id)) {
      countByPrompt.set(event.prompt_id, (countByPrompt.get(event.prompt_id) ?? 0) + 1)
    } else {
      orphanCount += 1
    }
  }

  const lastPromptId = prompts.length > 0 ? prompts[prompts.length - 1].id : null

  const items: TurnListItem[] = prompts
    .filter((p) => (countByPrompt.get(p.id) ?? 0) > 0)
    .map((p) => ({
      turnId: p.id,
      turnIndex: p.turn_index,
      userText: p.user_text,
      eventCount: countByPrompt.get(p.id) ?? 0,
      isLastTurn: p.id === lastPromptId
    }))

  if (orphanCount > 0) {
    items.push({
      turnId: ORPHAN_TURN_ID,
      turnIndex: null,
      userText: null,
      eventCount: orphanCount,
      isLastTurn: false
    })
  }

  return items
}
