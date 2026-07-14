import { Bot, ChevronRight, Loader2 } from 'lucide-react'
import type { AiExplanation, Prompt, ToolEvent } from '@shared/types'

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

interface TurnListProps {
  prompts: Prompt[]
  events: ToolEvent[]
  explanations: Map<string, AiExplanation>
  loading: boolean
  selectedTurnId: string | null
  onSelectTurn: (turnId: string) => void
}

// tool_events를 턴(prompt) 단위로 묶어 "코딩 수정이 완료된 단위"만 목록으로 보여준다.
// 여기서는 개별 Read/Write/Bash를 나열하지 않고 턴 자체를 고르는 선택자 역할만 한다 —
// 구조도·변경사항·요약은 오른쪽 TurnDetailPanel에서 선택된 턴 기준으로 크게 보여준다.
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

export function TurnList({
  prompts,
  events,
  explanations,
  loading,
  selectedTurnId,
  onSelectTurn
}: TurnListProps) {
  const items = buildTurnList(prompts, events)

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_18px_45px_rgba(0,0,0,.14)]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#20323a] text-[#a5e7cb]">
          <Bot size={17} />
        </div>
        <div>
          <h3 className="text-[13px] font-semibold">턴 목록</h3>
          <p className="font-mono text-[10px] text-[#75909a]">
            {String(items.length).padStart(2, '0')} TURNS · 선택해서 상세 보기
          </p>
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          세션을 불러오는 중…
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] leading-6 text-muted-foreground">
          아직 표시할 활동이 없습니다. 헤더의 &quot;시작하기&quot;를 눌러 모니터링을 시작하세요.
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto p-2.5">
          {items.map((item) => {
            const explanation = item.turnId === ORPHAN_TURN_ID ? undefined : explanations.get(item.turnId)
            const active = selectedTurnId === item.turnId
            return (
              <button
                key={item.turnId}
                type="button"
                onClick={() => onSelectTurn(item.turnId)}
                className={`mb-1.5 flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition ${
                  active
                    ? 'border-[#4b8b75] bg-[#193c35]'
                    : 'border-transparent bg-[#121d25] hover:border-[#2c4a41] hover:bg-[#15212a]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5">
                    {item.turnIndex !== null ? (
                      <span className="rounded bg-[#1d2f38] px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-[0.08em] text-[#8fc9ae]">
                        TURN {item.turnIndex + 1}
                      </span>
                    ) : (
                      <span className="rounded bg-[#31443f] px-1.5 py-0.5 font-mono text-[9px] text-[#bde9d1]">
                        수동 수정
                      </span>
                    )}
                    {item.isLastTurn && !explanation && (
                      <span className="flex items-center gap-1 font-mono text-[9px] text-[#f5a49a]">
                        <Loader2 size={9} className="animate-spin" />
                        진행 중
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[12.5px] text-[#c3d2da]">
                    {item.userText ?? '연결된 요청 없음'}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[#5f7682]">
                    {item.eventCount}개 작업{explanation ? ' · 요약 완료' : ''}
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className={`mt-1 shrink-0 ${active ? 'text-[#8ed7ba]' : 'text-[#40545e]'}`}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
