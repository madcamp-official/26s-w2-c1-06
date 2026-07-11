import { Type, type Schema } from '@google/genai'
import type { CodeUnitVersionWithUnit, SkillLevel } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 5장 Level 3: 코드 유닛 변경의 자연어 요약 + 개념 태그를 한 호출로 생성.
export function buildExplainVersionsPrompt(
  versions: CodeUnitVersionWithUnit[],
  skillLevel: SkillLevel
): string {
  const versionBlocks = versions
    .map(
      (version, i) =>
        [
          `${i + 1}. versionId=${version.id}`,
          `   unit=${version.unit_name} (${version.unit_type}) file=${version.file_path}`,
          `   change=${version.change_type} version_no=${version.version_no}`,
          `   diff:`,
          version.diff_text ?? '(no diff)'
        ].join('\n')
    )
    .join('\n\n')

  return [
    'You are summarizing changes to individual code units (functions/components/hooks) made by an AI coding agent, for a learner reviewing a code timeline.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '아래 각 변경에 대해 한국어로 2~3문장의 요약(무엇이 왜 바뀌었는지)과, 관련된 프로그래밍 개념 태그(1~3개, 짧은 명사구)를 만들어줘.',
    '반드시 아래 목록에 있는 versionId만 사용하고, 목록에 없는 id를 만들어내지 마.',
    '변경 목록:',
    versionBlocks
  ].join('\n\n')
}

export const EXPLAIN_VERSIONS_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      versionId: { type: Type.STRING },
      caption: { type: Type.STRING },
      conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['versionId', 'caption', 'conceptTags']
  }
}
