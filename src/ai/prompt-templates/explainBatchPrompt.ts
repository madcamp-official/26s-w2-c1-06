import { Type, type Schema } from '@google/genai'
import type { SkillLevel, ToolEvent } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 4.3.1: 요약과 개념 태그를 같은 호출에서 한 번에 생성 (별도 호출 금지 → RPM 절약).
export function buildExplainBatchPrompt(events: ToolEvent[], skillLevel: SkillLevel): string {
  const eventLines = events
    .map(
      (event, i) =>
        `${i + 1}. eventId=${event.id} tool=${event.tool_name} file=${event.file_path ?? '(none)'} status=${event.status}`
    )
    .join('\n')

  return [
    'You are explaining an AI coding agent\'s actions to a learner watching a real-time trace panel.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '아래 이벤트 각각에 대해 한국어로 1~2문장의 해설과, 관련된 프로그래밍 개념 태그(1~3개, 짧은 명사구)를 만들어줘.',
    '반드시 아래 이벤트 목록에 있는 eventId만 사용하고, 목록에 없는 id를 만들어내지 마.',
    '이벤트 목록:',
    eventLines
  ].join('\n\n')
}

export const EXPLAIN_BATCH_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      eventId: { type: Type.STRING },
      caption: { type: Type.STRING },
      conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['eventId', 'caption', 'conceptTags']
  }
}
