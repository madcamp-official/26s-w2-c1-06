import { Type, type Schema } from '@google/genai'
import type { Prompt, SkillLevel, ToolEvent } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 4.3.1 개편: 개별 tool_event(Read/Write/Bash 등)마다 해설을 만들면 단위가 너무
// 잘게 쪼개지고 API 호출도 잦아진다. 대신 그 턴에서 일어난 모든 액션을 한 번에
// 넣어 "이 요청으로 실제로 어떤 기능/변경이 완성됐는지" 하나의 feature 단위로만 묻는다.
export function buildExplainTurnPrompt(prompt: Prompt, events: ToolEvent[], skillLevel: SkillLevel): string {
  const actionLines = events
    .map(
      (event, i) =>
        `${i + 1}. ${event.tool_name}${event.file_path ? ` (${event.file_path})` : ''} — ${event.status}`
    )
    .join('\n')

  return [
    'You are explaining an AI coding agent\'s completed work for one user request (turn) to a learner watching a real-time dashboard.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '개별 액션을 하나씩 나열하지 말고, 이 요청 전체가 하나의 완성된 기능/변경으로서 무엇을 이뤘는지 3~5문장으로 요약해줘.',
    '관련된 프로그래밍 개념 태그도 2~4개(짧은 명사구) 만들어줘.',
    '사용자의 요청:',
    prompt.user_text ?? '(요청 텍스트 없음)',
    prompt.plan_text ? `에이전트의 계획:\n${prompt.plan_text}` : '',
    '이 요청 동안 실행된 액션들:',
    actionLines
  ]
    .filter(Boolean)
    .join('\n\n')
}

export const EXPLAIN_TURN_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    caption: { type: Type.STRING },
    conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['caption', 'conceptTags']
}
