import { Type, type Schema } from '@google/genai'
import type { SkillLevel } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'
import { describeEventBody } from './explainBatchPrompt'
import type { StepInput } from '../types'

const NOTE_MAX_LENGTH = 400

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function describeStep(step: StepInput, index: number): string {
  const lines = [
    `스텝 ${index + 1} (stepId=${step.stepId})`,
    `의도: ${truncate(step.noteText, NOTE_MAX_LENGTH)}`,
    `이 스텝에서 한 행동 (${step.events.length}개):`
  ]
  step.events.forEach((event, i) => {
    lines.push(`  ${i + 1}) tool=${event.tool_name} file=${event.file_path ?? '(none)'} status=${event.status}`)
    lines.push(...describeEventBody(event, '     '))
  })
  return lines.join('\n')
}

// 진행상황 패널(거북이 로딩바) 전용 — 해설/TTS 없이 "방금 한 일" 초단문 요약과
// 지금 봐두면 좋은 핵심 코드 한 조각만 뽑는다. explainStepPrompt.ts(캐스터 페르소나) 대체.
export function buildProgressSummaryPrompt(steps: StepInput[], skillLevel: SkillLevel): string {
  const stepBlocks = steps.map((step, i) => describeStep(step, i)).join('\n\n')

  return [
    '너는 AI 코딩 에이전트가 방금 한 작업을 아주 짧게 요약해주는 도우미야. 해설하듯 길게 쓰지 말고 핵심만 전달해.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '각 스텝마다 다음 필드를 채워줘:',
    '- summary: 방금 한 일 1~2문장 요약. 한글로 20~40자 내외로 아주 짧게.',
    '- keyCode: 이 스텝에서 바뀐 코드 중 지금 봐두면 좋은 가장 핵심적인 부분 하나. 마땅한 게 없으면 null.',
    '  - filePath: 그 코드가 있는 파일 경로',
    '  - lang: 코드 언어 (ts, tsx, python 등)',
    '  - snippet: 3~5줄 이내로 요약된 핵심 코드 (전체 diff를 넣지 마)',
    '  - reason: 왜 지금 이 코드를 보면 좋은지 한 줄',
    '절대 길게 쓰지 마라 — summary는 한두 문장, snippet은 5줄을 넘기지 마라. 화면에서 잘리지 않게 항상 짧게.',
    '반드시 아래 목록에 있는 stepId만 사용하고, 목록에 없는 id를 만들어내지 마.',
    '스텝 목록:',
    stepBlocks
  ].join('\n\n')
}

export const PROGRESS_SUMMARY_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      stepId: { type: Type.STRING },
      summary: { type: Type.STRING },
      keyCode: {
        type: Type.OBJECT,
        nullable: true,
        properties: {
          filePath: { type: Type.STRING },
          lang: { type: Type.STRING },
          snippet: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ['filePath', 'lang', 'snippet', 'reason']
      }
    },
    required: ['stepId', 'summary']
  }
}
