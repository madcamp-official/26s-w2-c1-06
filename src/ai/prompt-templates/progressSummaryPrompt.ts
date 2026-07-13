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
    `스텝 ${index + 1} (stepId=${step.stepId})${failed ? ' [상태: 실패 — 아래 이벤트 중 error 있음]' : ''}`,
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
//
// summary/reason의 역할은 옆에 나란히 붙는 실행 로그(TracePanel, 원문 그대로의 시간순
// 트레이스)와 겹치면 안 된다 — 실행 로그가 "과정"을 이미 보여주므로, 여기는 "결과"만
// 압축해서 전달한다(SPEC 패치 v2 #3).
export function buildProgressSummaryPrompt(steps: StepInput[], skillLevel: SkillLevel): string {
  const stepBlocks = steps.map((step, i) => describeStep(step, i)).join('\n\n')

  return [
    '너는 AI 코딩 에이전트가 방금 한 작업을 아주 짧게 요약해주는 도우미야. 해설하듯 길게 쓰지 말고 핵심만 전달해.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '각 스텝마다 다음 필드를 채워줘:',
    '- summary: "완료된 결과"만 담은 과거형 한 문장. 한글로 20~40자 내외로 아주 짧게.',
    '  - 이건 결과 요약이지 과정 서술이 아니다. "~하겠습니다/~읽고/~파악한 뒤"처럼 의도나 계획을',
    '    나열하는 문장은 절대 쓰지 마라 — 그건 실행 로그 패널의 몫이다. 여기는 끝난 일만 말해라.',
    '  - 나쁜 예: "App.tsx를 먼저 읽고 구조를 파악한 뒤 작업하겠습니다" (과정/미래형)',
    '  - 좋은 예: "TracePanel 컴포넌트가 생성되어 App.tsx에 연결됐습니다" (결과/과거형)',
    '  - 스텝이 실패([상태: 실패] 표시)면, "실패했습니다" 같은 위축되는 표현 대신 담백하게',
    '    무엇을 시도하다 어디서 막혔는지를 결과 중심으로 써라.',
    '    예: "Edit 시도 중 타입 오류가 발견돼 원인을 확인했습니다"',
    '- keyCode: 이 스텝에서 바뀐 코드 중 지금 봐두면 좋은 가장 핵심적인 부분 하나. 마땅한 게 없으면 null.',
    '  - filePath: 그 코드가 있는 파일 경로',
    '  - lang: 코드 언어 (ts, tsx, python 등)',
    '  - snippet: 3~5줄 이내로 요약된 핵심 코드 (전체 diff를 넣지 마)',
    '  - reason: "이 코드가 무슨 기능을 하는지"를 재설명하지 마라(코드를 읽으면 보인다). 대신 아래',
    '    세 가지 중 하나에 해당하는 "왜 지금 이 코드를 눈여겨봐야 하는지"만 한 줄로 써라:',
    '    1) 재사용/연결: 이 코드가 앞으로 다른 곳에서 다시 쓰이거나 연결될 것이라는 점',
    '       예: "TracePanel에서 이 함수를 바로 쓰니 형태를 기억해두세요"',
    '    2) 실수 포인트: 나중에 놓치기 쉬운 지점이나 흔한 실수',
    '       예: "이 부분은 나중에 null 체크가 빠지면 에러 나는 지점입니다"',
    '    3) 등장 맥락: 이전 시도의 실패/막힘과 지금 이 코드의 관계',
    '       예: "이전 요청에서 실패했던 원인이 바로 이 부분입니다"',
    '    - 이 스텝이 실패([상태: 실패])면 reason은 가급적 3)번처럼 실패 원인이 된 코드/에러',
    '      지점을 가리켜라.',
    '    - 위 세 가지 중 억지로 끼워 맞출 만한 게 정말 없으면, snippet을 억지로 채우지 말고',
    '      keyCode 전체를 null로 둬라 (reason만 비우지 말 것).',
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
