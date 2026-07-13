import { Type, type Schema } from '@google/genai'
import type { SkillLevel, ToolEvent } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'
import { describeEventBody } from './explainBatchPrompt'

const NOTE_MAX_LENGTH = 400

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// 캡션 워커가 넘기는 스텝 요약 입력. stepId는 응답 매칭용, noteText는 에이전트의
// 의도(서사), events는 그 스텝에서 실제로 한 액션들.
export interface StepPromptInput {
  stepId: string
  noteText: string
  events: ToolEvent[]
}

function describeStep(step: StepPromptInput, index: number): string {
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

// 학습 파이프라인 4단계: 개별 액션을 낱개로 캡션 다는 대신, 한 스텝(의도 +
// 그 안의 여러 액션)을 하나의 자연스러운 요약으로 묶어 사람이 읽을 속도에
// 맞춘다. 배치로 여러 스텝을 한 호출에 처리(틱당 1호출 RPM 규율 유지).
export function buildExplainStepsPrompt(steps: StepPromptInput[], skillLevel: SkillLevel): string {
  const stepBlocks = steps.map((step, i) => describeStep(step, i)).join('\n\n')

  return [
    'You are explaining an AI coding agent\'s work to a learner. 각 "스텝"은 에이전트의 의도 하나와 그 의도를 이루기 위해 실제로 실행한 여러 액션으로 이루어져 있어.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '스텝마다 한국어로 2~3문장의 요약을 만들어줘. 낱개 액션을 나열하지 말고, "무엇을 하려고 어떤 행동들을 했고 그래서 어떻게 됐는지"를 하나의 흐름으로 설명해줘. 실패한 액션이 있으면 왜 실패했고 어떻게 대응했는지도 포함해줘.',
    '또한 관련 프로그래밍 개념 태그(1~3개, 짧은 명사구)도 만들어줘.',
    '반드시 아래 목록에 있는 stepId만 사용하고, 목록에 없는 id를 만들어내지 마.',
    '스텝 목록:',
    stepBlocks
  ].join('\n\n')
}

export const EXPLAIN_STEPS_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      stepId: { type: Type.STRING },
      caption: { type: Type.STRING },
      conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['stepId', 'caption', 'conceptTags']
  }
}
