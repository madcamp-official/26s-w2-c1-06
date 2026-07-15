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
    '문서의 맨 첫 줄은 이 세션에서 무엇을 했는지 한눈에 드러나는 구체적인 한 줄 제목으로 시작해줘("# 제목" 형식, 예: "# 피보나치 수열 구현 및 모듈화"). "세션 요약"이나 "다룬 개념" 같은 일반적인 문구만으로 된 제목은 쓰지 마 — 노트 목록에서 이 제목만 보고 어떤 세션이었는지 구분할 수 있어야 한다.',
    '그 다음에 아래 섹션들을 포함하는 한국어 Markdown 문서를 작성해줘: "## 다룬 개념", "## 변경된 코드 유닛별 요약", "## 다음 학습 추천".',
    '결과는 Markdown 텍스트 자체만 출력해줘 — ```markdown 이나 ``` 같은 코드 펜스로 전체를 감싸지 마.',
    '세션에서 사용자가 요청한 턴들:',
    turnLines || '(없음)',
    '에이전트가 수행한 작업들:',
    eventLines || '(없음)',
    '코드 유닛 변경 내역:',
    versionLines || '(없음)'
  ].join('\n\n')
}
