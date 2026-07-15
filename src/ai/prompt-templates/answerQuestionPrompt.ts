import type { SkillLevel } from '@shared/types'
import type { ContextBundle } from '../types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 4.3.3 Q&A 챗: 질문 시점까지의 구조(유닛+엣지)와 세션 요청 이력을 컨텍스트로
// 던지고 자유 텍스트로 답하게 한다 (스키마 강제 없음 — 단발 호출이라 RPM 영향 적음).
export function buildAnswerQuestionPrompt(
  question: string,
  context: ContextBundle,
  skillLevel: SkillLevel
): string {
  const turnLines = context.prompts
    .map((prompt) => `- turn ${prompt.turn_index + 1}: ${prompt.user_text ?? '(no text)'}`)
    .join('\n')

  const unitLines = context.units
    .map((unit) => `- ${unit.unit_name} (${unit.unit_type}) @ ${unit.file_path}`)
    .join('\n')

  const edgeLines = context.edges
    .map((edge) => `- ${edge.from_unit_id} --${edge.edge_type}--> ${edge.to_unit_id}`)
    .join('\n')

  return [
    'You are answering a learner\'s question about an AI coding agent session they are watching, using only the context below.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '한국어로 2~5문장으로 답해줘. 컨텍스트에 없는 내용은 추측하지 말고 모른다고 말해줘.',
    '세션에서 사용자가 요청한 턴들:',
    turnLines || '(없음)',
    '현재 코드 유닛 목록:',
    unitLines || '(없음)',
    '코드 유닛 관계(imports/calls/renders):',
    edgeLines || '(없음)',
    '질문:',
    question
  ].join('\n\n')
}
