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

const CASTER_PERSONA = [
  '너는 AI 코딩 에이전트의 작업 과정을 실시간으로 중계하는 열정적이고 전문적인 e스포츠/축구 캐스터이자 해설가야.',
  '페르소나: 경기 흐름을 날카롭게 짚으면서도 시청자(학습자)에게 친근하게 말하는 베테랑 해설가 톤을 유지해라.',
  '예: "~하고 있네요!", "~를 시도합니다!", "아, 여기서 흐름을 바꾸는군요!"'
].join(' ')

const TTS_SCRIPT_RULES = [
  'ttsScript는 오디오로 읽을 순수 구어체 대본이다.',
  '특수문자, 온점(.) , 마크다운 기호(*, `, #), 이모지, URL, 파일 경로 기호를 넣지 마라.',
  '약어·영문은 한국어로 풀어 써라. 예: Next.js → 넥스트 제이에스, JWT → 제이더블유티, GET 요청 → 겟 요청, API → 에이피아이.',
  '한 스텝당 2~4문장, 너무 길지 않게.'
].join(' ')

// 학습 파이프라인 4단계: 개별 액션을 낱개로 캡션 다는 대신, 한 스텝(의도 +
// 그 안의 여러 액션)을 하나의 자연스러운 요약으로 묶어 사람이 읽을 속도에
// 맞춘다. UI 캡션과 TTS 대본을 한 호출에서 함께 생성(RPM 절약).
export function buildExplainStepsPrompt(steps: StepPromptInput[], skillLevel: SkillLevel): string {
  const stepBlocks = steps.map((step, i) => describeStep(step, i)).join('\n\n')

  return [
    CASTER_PERSONA,
    '각 "스텝"은 에이전트의 의도 하나와 그 의도를 이루기 위해 실제로 실행한 여러 액션으로 이루어져 있어.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '스텝마다 다음 필드를 채워줘:',
    '- title: 학습자가 지금 무엇을 배우면 되는지 짧게 (예: "실행 방식 파악", 8자 내외 권장, 도구명 금지)',
    '- caption: UI 카드용 한국어 2~3문장. "무엇을 하려고 → 어떤 행동 묶음을 했고 → 결과가 어떻게 됐는지". Bash/Read 등 도구명 나열 금지. 마크다운 헤더(###) 금지.',
    '- why: 왜 그 파일·명령을 봤는지/썼는지 1문장 (학습 관점)',
    '- ttsScript: 캐스터 구어체 대본 (아래 TTS 규칙 준수)',
    '- conceptTags: 관련 프로그래밍 개념 1~3개 (짧은 명사구)',
    TTS_SCRIPT_RULES,
    '실패한 액션이 있으면 caption과 ttsScript에 왜 실패했고 어떻게 대응했는지도 포함해줘.',
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
      title: { type: Type.STRING },
      caption: { type: Type.STRING },
      why: { type: Type.STRING },
      ttsScript: { type: Type.STRING },
      conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['stepId', 'title', 'caption', 'why', 'ttsScript', 'conceptTags']
  }
}
