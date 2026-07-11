import type { SkillLevel } from '@shared/types'
import type { SessionTrace } from '../types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 4.3.2: 세션 전체(prompts + tool_events + code_unit_versions)를 한 번에
// 투입해 Markdown 강의노트를 생성한다. 청킹/배칭 없이 단일 호출.
export function buildLectureNotePrompt(trace: SessionTrace, skillLevel: SkillLevel): string {
  const turnLines = trace.prompts
    .map((prompt) => `- turn ${prompt.turn_index + 1}: ${prompt.user_text ?? '(no text)'}`)
    .join('\n')

  const eventLines = trace.toolEvents
    .map((event) => `- [${event.status}] ${event.tool_name} ${event.file_path ?? ''}`.trim())
    .join('\n')

  const versionLines = trace.versions
    .map(
      (version) =>
        `- ${version.unit_name} (${version.unit_type}) v${version.version_no} ${version.change_type}: ${
          version.diff_text ?? ''
        }`
    )
    .join('\n')

  return [
    'You are writing a end-of-session Markdown lecture note for a learner who just watched an AI coding agent work, so they can review what happened later.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '다음 섹션을 포함하는 한국어 Markdown 문서를 작성해줘: "## 다룬 개념", "## 변경된 코드 유닛별 요약", "## 다음 학습 추천".',
    '세션에서 사용자가 요청한 턴들:',
    turnLines || '(없음)',
    '에이전트가 수행한 작업들:',
    eventLines || '(없음)',
    '코드 유닛 변경 내역:',
    versionLines || '(없음)'
  ].join('\n\n')
}
