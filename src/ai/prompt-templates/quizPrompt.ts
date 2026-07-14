import { Type, type Schema } from '@google/genai'
import type { CodeUnitVersionWithUnit, SkillLevel } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

const QUESTIONS_PER_LESSON = 6

function truncateDiff(diff: string | null, max: number): string {
  if (!diff) return '(no diff)'
  return diff.length > max ? diff.slice(0, max) + '\n…(생략)' : diff
}

// 학습 카드(=lesson) 하나 = 코드 변경 하나. 1분간 크게 보여줄 content와, 그 내용만
// 다루는 문항 6개(문항당 10초 자동 진행이라 짧고 즉답 가능해야 함)를 함께 만든다.
export function buildQuizPrompt(versions: CodeUnitVersionWithUnit[], skillLevel: SkillLevel): string {
  const versionBlocks = versions
    .map(
      (version, i) =>
        [
          `${i + 1}. versionId=${version.id}`,
          `   unit=${version.unit_name} (${version.unit_type}) file=${version.file_path}`,
          `   change=${version.change_type} version_no=${version.version_no}`,
          `   diff:`,
          truncateDiff(version.diff_text, 600)
        ].join('\n')
    )
    .join('\n\n')

  return [
    '너는 AI 코딩 에이전트가 방금 바꾼 코드를 학습자에게 짧게 가르치고, 배운 걸 바로 확인하는 타이머 기반 학습 카드를 만드는 출제자야.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '아래 목록의 각 코드 변경(versionId)마다 학습 카드(lesson)를 정확히 하나씩 만들어줘. 카드는 다음 필드를 가져:',
    '- content: 화면에 크게 띄워서 1분간 읽을 학습 본문. 3~5문장, "무엇이 왜 바뀌었는지"를 diff에 근거해 명확하게 설명해. 이 내용만 보고 뒤따르는 문제를 전부 풀 수 있어야 해.',
    '- code: content와 함께 보여줄 diff 핵심 발췌 3~6줄 (전체 diff를 넣지 마). 없어도 되면 빈 문자열.',
    `- questions: 정확히 ${QUESTIONS_PER_LESSON}개. 문항당 풀이 시간이 10초뿐이니 반드시 아주 짧게(질문 1문장, 선택지도 짧은 단어/구):`,
    '  - prompt: content에 나온 사실 하나만 확인하는 질문. content를 읽었으면 몇 초 안에 바로 답할 수 있어야 해 — 새로운 정보나 diff 재해석을 요구하지 마.',
    '  - options: 4개 선택지. 정답은 content/diff와 정확히 일치, 오답 3개는 그럴듯하지만 명백히 틀려야 해.',
    '  - correctIndex: options 배열에서 정답 인덱스(0~3).',
    '  - note: 정답 확인 후 보여줄 한 줄 설명.',
    `  - ${QUESTIONS_PER_LESSON}개 문항은 서로 다른 사실(유닛 종류, 변경 종류, 파일 위치, 구체적 코드 내용 등)을 물어서 같은 걸 반복해서 묻지 마.`,
    '반드시 아래 목록에 있는 versionId만 사용하고, 목록에 없는 id를 만들어내지 마.',
    '변경 목록:',
    versionBlocks
  ].join('\n\n')
}

export const QUIZ_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      versionId: { type: Type.STRING },
      content: { type: Type.STRING },
      code: { type: Type.STRING },
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            prompt: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            correctIndex: { type: Type.INTEGER },
            note: { type: Type.STRING }
          },
          required: ['prompt', 'options', 'correctIndex', 'note']
        }
      }
    },
    required: ['versionId', 'content', 'code', 'questions']
  }
}
