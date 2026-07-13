import type { SkillLevel } from '@shared/types'
import type { SessionTrace } from '../types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 4.3.2: 세션 전체를 한 번에 투입해 Markdown 강의노트를 생성한다.
// 도구 나열보다 학습 스텝 요약(title/why/tags)을 우선해 탑다운 목차로 맞춘다.
export function buildLectureNotePrompt(trace: SessionTrace, skillLevel: SkillLevel): string {
  const turnLines = trace.prompts
    .map((prompt) => `- turn ${prompt.turn_index + 1}: ${prompt.user_text ?? '(no text)'}`)
    .join('\n')

  const stepLines = trace.steps.map((step) => `- ${step.summary}`).join('\n')

  const versionLines = trace.versions
    .map(
      (version) =>
        `- ${version.unit_name} (${version.unit_type}) v${version.version_no} ${version.change_type}: ${
          version.diff_text ?? ''
        }`
    )
    .join('\n')

  return [
    'You are writing an end-of-session Markdown lecture note for a learner who just watched an AI coding agent work, so they can review top-down what happened later.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '반드시 아래 섹션 제목을 그대로 쓰는 한국어 Markdown 문서를 작성해줘:',
    '## 이번 세션에서 배운 것',
    '## 핵심 개념',
    '## 코드에서 일어난 일',
    '## 다시 보면 좋은 포인트',
    '도구(Bash/Read 등) 나열 대신, 학습 목표·개념·코드 변화 중심으로 써줘.',
    '세션에서 사용자가 요청한 턴들:',
    turnLines || '(없음)',
    '학습 스텝 요약 (우선 참고):',
    stepLines || '(없음)',
    '코드 유닛 변경 내역:',
    versionLines || '(없음)'
  ].join('\n\n')
}
