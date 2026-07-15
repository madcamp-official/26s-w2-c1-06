// buildTurnList 단위 테스트. 네트워크/DB 불필요 — 순수 데이터 가공 로직만 검증.
// 실행: npm run test:turn-list

import assert from 'node:assert/strict'
import { buildTurnList } from '../src/app/renderer/src/components/TurnList'
import type { Prompt, ToolEvent } from '../src/shared/types'

function prompt(id: string, turnIndex: number, userText: string | null = 'test'): Prompt {
  return {
    id,
    session_id: 's1',
    turn_index: turnIndex,
    user_text: userText,
    plan_text: null,
    created_at: null,
    completed_at: null
  }
}

function event(id: string, promptId: string | null): ToolEvent {
  return {
    id,
    session_id: 's1',
    prompt_id: promptId,
    tool_name: 'Bash',
    file_path: null,
    source: 'agent',
    status: 'success',
    duration_ms: null,
    raw_payload: null,
    result_content: null,
    created_at: null
  }
}

// 실제로 겪은 버그: 마지막 프롬프트가 도구 호출 전에 중단돼(tool_event 0개) 목록에서
// 필터링되면, 필터링 전 배열 기준으로 고른 lastPromptId와 items 안 어떤 항목도 안 맞아
// isLastTurn이 전부 false가 된다 — 아직 캡션이 안 붙은 진짜 마지막 코딩 턴이 "완료"로
// 잘못 표시되는 원인이었다.
function testLastTurnSkipsInterruptedTrailingPrompt(): void {
  const prompts = [prompt('p1', 0), prompt('p2', 1), prompt('p3', 2, '[Request interrupted by user]')]
  const events = [event('e1', 'p1'), event('e2', 'p2')] // p3는 tool_event 없음(중단됨)

  const items = buildTurnList(prompts, events)

  assert.equal(items.length, 2, 'tool_event가 0개인 p3는 목록에서 빠져야 함')
  assert.equal(items.find((i) => i.turnId === 'p3'), undefined)

  const p2Item = items.find((i) => i.turnId === 'p2')
  assert.ok(p2Item, 'p2는 목록에 남아있어야 함')
  assert.equal(p2Item!.isLastTurn, true, '실제로 코드가 있는 마지막 턴(p2)이 isLastTurn이어야 함')
  console.log('✓ interrupted trailing prompt (0 tool_events) is dropped, p2 correctly becomes isLastTurn')
}

function testLastTurnWithEventsIsMarkedCorrectly(): void {
  const prompts = [prompt('p1', 0), prompt('p2', 1)]
  const events = [event('e1', 'p1'), event('e2', 'p2')]

  const items = buildTurnList(prompts, events)
  assert.equal(items.find((i) => i.turnId === 'p1')!.isLastTurn, false)
  assert.equal(items.find((i) => i.turnId === 'p2')!.isLastTurn, true)
  console.log('✓ normal case (every prompt has events) still marks the true last prompt correctly')
}

function testOrphanEventsGroupSeparately(): void {
  const prompts = [prompt('p1', 0)]
  const events = [event('e1', 'p1'), event('e2', null), event('e3', 'unknown-prompt')]

  const items = buildTurnList(prompts, events)
  const orphan = items.find((i) => i.turnId === '__orphan__')
  assert.ok(orphan, 'prompt_id 없거나 알 수 없는 이벤트는 orphan 그룹으로 묶여야 함')
  assert.equal(orphan!.eventCount, 2)
  assert.equal(orphan!.isLastTurn, false, 'orphan 그룹은 절대 isLastTurn이 아니어야 함')
  console.log('✓ events without a matching prompt group into the orphan item, never marked isLastTurn')
}

const tests = [
  testLastTurnSkipsInterruptedTrailingPrompt,
  testLastTurnWithEventsIsMarkedCorrectly,
  testOrphanEventsGroupSeparately
]

function main(): void {
  for (const test of tests) test()
  console.log('\nall buildTurnList tests passed')
}

main()
