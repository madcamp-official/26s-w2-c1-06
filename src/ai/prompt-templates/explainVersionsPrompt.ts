import { Type, type Schema } from '@google/genai'
import type { CodeUnitVersionWithUnit, SkillLevel } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// SPEC 5장 Level 3: 코드 유닛 변경의 자연어 요약 + 개념 태그를 한 호출로 생성.
// diff 줄마다 번호를 매겨준다 — AI가 "핵심 부분"을 코드로 다시 타이핑해 돌려주는 대신
// 이 번호로 된 줄 범위만 고르게 하면, 우리가 그 범위를 diff_text에서 그대로 잘라
// 보여줄 수 있다(코드를 잘못 옮겨적을 위험이 없다 — 항상 원본의 정확한 부분 문자열).
function numberLines(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n')
}

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
          `   diff (앞의 숫자는 줄 번호, keyStartLine/keyEndLine에 쓸 것):`,
          version.diff_text ? numberLines(version.diff_text) : '(no diff)'
        ].join('\n')
    )
    .join('\n\n')

  return [
    'You are summarizing changes to individual code units (functions/components/hooks) made by an AI coding agent, for a learner reviewing a code timeline.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '아래 각 변경에 대해 한국어로 2~3문장의 요약(무엇이 왜 바뀌었는지)과, 관련된 프로그래밍 개념 태그(1~3개, 짧은 명사구)를 만들어줘.',
    '그리고 diff에서 이 변경의 핵심이라고 생각되는 연속된 줄 범위를 keyStartLine/keyEndLine으로 골라줘',
    '(줄 앞에 매겨진 번호 기준, 1부터 시작, 둘 다 포함). 반드시 20줄을 넘지 않게 골라라 — 클래스',
    '전체나 여러 메서드를 다 고르지 말고, 그 중에서도 가장 핵심적인 메서드/로직 "딱 하나"만 골라라.',
    '보일러플레이트(생성자, getter, 단순 위임)는 피하고 실제 알고리즘/의사결정이 담긴 부분을 우선해라.',
    '고를 만한 부분이 정말 없을 만큼 diff가 이미 짧으면 null로 둬도 된다.',
    '반드시 아래 목록에 있는 versionId만 사용하고, 목록에 없는 id를 만들어내지 마.',
    '변경 목록:',
    versionBlocks
  ].join('\n\n')
}

// 프롬프트로 "20줄 이내"를 요청해도 모델이 안 지키는 경우가 실제로 있었다(예: 메서드가
// 여러 개인 큰 클래스에서 전체를 다 고름) — 그래서 여기서 한 번 더 강제로 자른다.
// AI 순응에 기대지 않는 결정론적 안전망: 결과가 아무리 커도 화면은 절대 이 줄 수를 넘지 않는다.
const MAX_KEY_SNIPPET_LINES = 20

// AI가 고른 keyStartLine/keyEndLine(1-based, 둘 다 포함)으로 diff_text에서 그 구간을
// 그대로 잘라낸다 — AI가 만든 텍스트를 쓰지 않고 원본의 정확한 부분 문자열만 반환하므로
// 코드가 잘못 옮겨적힐 위험이 없다. 범위가 없거나(null) 유효하지 않으면 null.
export function sliceKeySnippet(
  diffText: string | null,
  startLine: number | null | undefined,
  endLine: number | null | undefined
): string | null {
  if (!diffText || typeof startLine !== 'number' || typeof endLine !== 'number') return null
  const lines = diffText.split('\n')
  const start = Math.max(1, Math.min(Math.floor(startLine), lines.length))
  const requestedEnd = Math.max(start, Math.min(Math.floor(endLine), lines.length))
  const end = Math.min(requestedEnd, start + MAX_KEY_SNIPPET_LINES - 1)
  return lines.slice(start - 1, end).join('\n')
}

export const EXPLAIN_VERSIONS_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      versionId: { type: Type.STRING },
      caption: { type: Type.STRING },
      conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } },
      keyStartLine: { type: Type.INTEGER, nullable: true },
      keyEndLine: { type: Type.INTEGER, nullable: true }
    },
    required: ['versionId', 'caption', 'conceptTags']
  }
}
