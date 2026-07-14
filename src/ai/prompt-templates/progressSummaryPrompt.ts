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
  const failed = step.events.some((e) => e.status === 'error')
  const lines = [
    `스텝 ${index + 1} (stepId=${step.stepId})${failed ? ' [상태: 실패 — 아래 이벤트 중 error 있음]' : ''}`
  ]
  if (step.noteText) lines.push(`참고(에이전트가 그때 남긴 말): ${truncate(step.noteText, NOTE_MAX_LENGTH)}`)
  lines.push(`이 스텝에서 한 행동 (${step.events.length}개):`)
  step.events.forEach((event, i) => {
    lines.push(`  ${i + 1}) tool=${event.tool_name} file=${event.file_path ?? '(none)'} status=${event.status}`)
    lines.push(...describeEventBody(event, '     '))
  })
  if (step.codeCandidate) {
    lines.push(
      `이 스텝에서 뽑힌 대표 코드(이미 확정됨, 그대로 두고 설명만 달아라):`,
      `  파일: ${step.codeCandidate.filePath}`,
      step.codeCandidate.snippet
    )
  } else {
    lines.push('이 스텝에는 설명할 대표 코드가 없다(keyCode는 null).')
  }
  return lines.join('\n')
}

// 진행상황 패널(거북이 로딩바) 전용 — 해설/TTS 없이 "방금 한 일" 초단문 요약과,
// 이미 결정론적으로 뽑힌 대표 코드에 대한 정형화된 3줄 설명을 만든다.
//
// snippet/filePath/lang은 여기서 만드는 게 아니다 — progress-worker가 실제
// old_string/new_string에서 미리 추출해 "이미 확정된 사실"로 준다. AI는 코드를
// 다시 타이핑하지 않고, 주어진 코드를 보고 설명/중요한 이유/학습 포인트만 채운다
// (코드를 잘못 옮겨적을 위험을 원천 차단).
export function buildProgressSummaryPrompt(steps: StepInput[], skillLevel: SkillLevel): string {
  const stepBlocks = steps.map((step, i) => describeStep(step, i)).join('\n\n')

  return [
    '너는 AI 코딩 에이전트가 방금 한 작업을 아주 짧게 요약해주는 도우미야. 해설하듯 길게 쓰지 말고 핵심만 전달해.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '각 스텝마다 다음 필드를 채워줘:',
    '- summary: "완료된 결과"만 담은 과거형 한 문장. 한글로 20~40자 내외로 아주 짧게.',
    '  - 이건 결과 요약이지 과정 서술이 아니다. "~하겠습니다/~읽고/~파악한 뒤"처럼 의도나 계획을',
    '    나열하는 문장은 절대 쓰지 마라. 끝난 일만 말해라.',
    '  - 나쁜 예: "App.tsx를 먼저 읽고 구조를 파악한 뒤 작업하겠습니다" (과정/미래형)',
    '  - 좋은 예: "TracePanel 컴포넌트가 생성되어 App.tsx에 연결됐습니다" (결과/과거형)',
    '  - 스텝이 실패([상태: 실패] 표시)면, "실패했습니다" 같은 위축되는 표현 대신 담백하게',
    '    무엇을 시도하다 어디서 막혔는지를 결과 중심으로 써라.',
    '    예: "Edit 시도 중 타입 오류가 발견돼 원인을 확인했습니다"',
    '- keyCode: "대표 코드"가 주어진 스텝에서만 채운다. 대표 코드가 없다고 나온 스텝은 반드시 null.',
    '  주어진 코드를 재입력하거나 요약하지 마라(이미 화면에 그대로 표시됨) — 아래 3개 필드만 채워라:',
    '  - explanation: 이 코드가 무엇인지(무엇이 바뀌었는지) 한 문장. 코드를 그대로 읽어주지 말고,',
    '    "무슨 역할/변화인지"를 알려줘라.',
    '  - importance: 이 코드가 지금 중요한 이유 한 문장. 아래 중 하나에 해당하는 관점으로:',
    '    1) 재사용/연결: 앞으로 다른 곳에서 다시 쓰이거나 연결될 코드',
    '    2) 실수 포인트: 나중에 놓치기 쉬운 지점이나 흔한 실수',
    '    3) 등장 맥락: 이전 시도의 실패/막힘과 이 코드의 관계',
    '    스텝이 실패([상태: 실패])면 가급적 3)번 관점으로, 실패 원인이 된 지점을 가리켜라.',
    '  - application: 이 코드를 보고 배울 점/앞으로 어떻게 적용할지 한 문장(학습 포인트).',
    '    예: "이런 패턴은 다른 컴포넌트에서 상태를 IPC로 받아올 때도 그대로 쓸 수 있어요"',
    '  - 세 필드 모두 반드시 채워라(비워두지 말 것) — 대표 코드가 있는데 셋 중 뭔가 애매하면',
    '    가장 그럴듯한 관점을 골라서라도 채워라.',
    '절대 길게 쓰지 마라 — 각 필드 한 문장, 화면에서 잘리지 않게 항상 짧게.',
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
          explanation: { type: Type.STRING },
          importance: { type: Type.STRING },
          application: { type: Type.STRING }
        },
        required: ['explanation', 'importance', 'application']
      }
    },
    required: ['stepId', 'summary']
  }
}
