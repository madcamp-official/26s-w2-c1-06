import type { Prompt, ToolEvent } from '@shared/types'
import { stripSystemContextTags } from '@shared/format'

// 프롬프트에 연결되지 않은 이벤트(수동 수정 등, SPEC 4.1 fallback)를 가리키는 고정 키 —
// 실제 prompt.id(UUID)와 충돌하지 않는다.
export const ORPHAN_TURN_ID = '__orphan__'

export interface TurnListItem {
  turnId: string
  turnIndex: number | null
  userText: string | null
  eventCount: number
  isLastTurn: boolean
  // Stop 훅(파이프라인)이 찍는 prompts.completed_at — null이면 이 턴은 아직 진행
  // 중이거나 훅 신호를 못 받은 상태. ORPHAN_TURN_ID 항목은 프롬프트가 아니므로 항상 null.
  completedAt: string | null
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

  // tool_event가 없는 턴(순수 대화, 또는 도구 호출 전에 중단된 요청 등)은 목록에서
  // 아예 빠지므로, "마지막 턴"도 그 필터링 이후 기준으로 잡아야 한다. 원래 코드는
  // 필터링 전 prompts 배열에서 lastPromptId를 골랐는데, 정작 그 마지막 프롬프트가
  // tool_event 0개라 필터에 걸러지면 items 안 어떤 항목도 lastPromptId와 안 맞아
  // isLastTurn이 전부 false가 된다 — 그러면 실제로 아직 캡션이 안 붙은, 진짜
  // "진행 중"인 마지막 코딩 턴도 진행중 스피너 대신 완료 아이콘으로 잘못 표시된다.
  const codeTurns = prompts.filter((p) => (countByPrompt.get(p.id) ?? 0) > 0)
  const lastPromptId = codeTurns.length > 0 ? codeTurns[codeTurns.length - 1].id : null

  // 화면 표시용 턴 번호는 DB의 prompts.turn_index를 그대로 쓰지 않고 이 목록 안에서의
  // 위치로 다시 매긴다 — turn_index는 "재개 사슬"의 논리 세션마다 0부터 다시 세는
  // 카운터라(pipeline/index.ts turnIndexBySession), "완료 → 시작하기"로 세션이 갈렸을
  // 때 그대로 쓰면 "프롬프트 1"이 두 번 나오는 등 번호가 꼬인다. prompts 배열은 이미
  // 시간순으로 정렬돼 들어오므로(main/index.ts의 getPromptsBySession, created_at ASC)
  // 여기서의 인덱스가 곧 사슬 전체를 통틀은 올바른 순번이다.
  const items: TurnListItem[] = codeTurns.map((p, index) => ({
    turnId: p.id,
    turnIndex: index,
    // 원본 user_text는 <ide_opened_file> 등 자동 삽입 컨텍스트 태그를 그대로 담고
    // 있어서(캡션 생성 시엔 필요) 화면 제목으로 쓸 땐 사람이 실제로 쓴 부분만 남긴다.
    userText: stripSystemContextTags(p.user_text) || null,
    eventCount: countByPrompt.get(p.id) ?? 0,
    isLastTurn: p.id === lastPromptId,
    completedAt: p.completed_at
  }))

  if (orphanCount > 0) {
    items.push({
      turnId: ORPHAN_TURN_ID,
      turnIndex: null,
      userText: null,
      eventCount: orphanCount,
      isLastTurn: false,
      completedAt: null
    })
  }

  return items
}
