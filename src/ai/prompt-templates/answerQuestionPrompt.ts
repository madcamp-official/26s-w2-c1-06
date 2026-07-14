import type { SkillLevel } from '@shared/types'
import type { ContextBundle, QnaHistoryEntry } from '../types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 4.3.3 Q&A 챗: 질문 시점까지의 구조(유닛+엣지)와 세션 요청 이력을 컨텍스트로
// 던지고 자유 텍스트로 답하게 한다 (스키마 강제 없음 — 단발 호출이라 RPM 영향 적음).
// generateContent는 무상태라 "이전 질문을 기억"하려면 매 호출마다 히스토리를 직접
// 프롬프트에 넣어야 한다(GeminiKeyPool 주석 참조) — history로 직전 문답들을 받는다.
export function buildAnswerQuestionPrompt(
  question: string,
  context: ContextBundle,
  history: QnaHistoryEntry[],
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

  // 최근 몇 개만 넣는다 — 대화가 길어져도 프롬프트가 무한정 커지지 않게(무료 티어
  // 토큰/RPM 예산 방어), 오래된 문답보다 방금 나눈 대화가 후속 질문 해석에 더 중요하다.
  const recentHistory = history.slice(-6)
  const historyLines = recentHistory
    .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
    .join('\n\n')

  return [
    'You are answering a learner\'s question about an AI coding agent session they are watching, using only the context below.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '한국어로 2~5문장으로 답해줘. 컨텍스트에 없는 내용은 추측하지 말고 모른다고 말해줘.',
    '이전 대화(참고용, "그건 왜?"처럼 이어지는 질문일 수 있음):',
    historyLines || '(이전 대화 없음)',
    '세션에서 사용자가 요청한 턴들:',
    turnLines || '(없음)',
    '현재 코드 유닛 목록:',
    unitLines || '(없음)',
    '코드 유닛 관계(imports/calls/renders):',
    edgeLines || '(없음)',
    '지금 질문:',
    question
  ].join('\n\n')
}
