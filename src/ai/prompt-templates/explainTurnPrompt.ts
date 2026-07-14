import { Type, type Schema } from '@google/genai'
import type { Prompt, SkillLevel, ToolEvent } from '@shared/types'
import type { TurnContext } from '../types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

// 턴 해설 개편: "무엇이 바뀌었는지"를 딱딱하게 나열하는 대신, 코딩을 알려주고 싶어하는
// 친절한 사수가 슬랙 말풍선을 보내듯 서술식으로 푼다. 강사가 칠판의 구조도를 짚어가며
// 설명하듯 (1) 전체 구조에서 이번 턴이 어디를 만졌는지 → (2) 바뀐 내용 해설 →
// (3) 이걸 이해하려면 알아야 하는 개념/자료구조/알고리즘 순서로 말풍선을 구성한다.
const MENTOR_PERSONA = [
  '너는 후배에게 코딩을 하나라도 더 알려주고 싶어하는 친절한 선배 개발자(사수)야.',
  '슬랙에서 후배에게 메시지를 보내듯, 짧은 말풍선 여러 개로 나눠서 편한 반말로 설명해줘.',
  '"이번엔 이런 걸 만들었어", "이건 알아두면 좋아" 같은 말투로, 나열이 아니라 이야기하듯 서술해줘.'
].join(' ')

const BUBBLE_INSTRUCTIONS = [
  '말풍선(bubbles)은 아래 순서로 구성해줘. 각 말풍선은 2~4문장, kind로 종류를 표시해:',
  '1. kind="overview" (1개): 전체 코드 구조도를 먼저 조망하면서, 이번 턴이 그 구조에서 어느 부분을 만졌는지 짚어줘. 구조도의 유닛 이름을 직접 언급하면서 "구조도에서 여기 보이지?"처럼 가리키듯 말해줘.',
  '2. kind="change" (1~3개): 실제로 바뀐 내용을 서술식으로 해설해줘. 어떤 유닛이 왜 이렇게 바뀌었고, 서로 어떻게 연결되는지 흐름 위주로. 파일/diff를 기계적으로 나열하지 말 것.',
  '3. kind="concept" (1~2개): 이번 변경을 제대로 이해하려면 알아야 하는 프로그래밍 개념·데이터 구조·알고리즘·패턴을 골라 소개해줘. "이건 알아둬야 해" 하고 챙겨주는 느낌으로.',
  '각 말풍선의 title은 짧은 소제목(예: "전체 그림부터 보자", "이번에 바뀐 것", "알아두면 좋은 개념") — 없으면 빈 문자열.',
  'summary에는 목록에 표시할 한 줄 요약(존댓말 대신 명사형 종결, 40자 이내)을 넣어줘.',
  'conceptTags에는 관련 프로그래밍 개념 태그 2~4개(짧은 명사구)를 넣어줘.'
].join('\n')

export function buildExplainTurnPrompt(
  prompt: Prompt,
  events: ToolEvent[],
  context: TurnContext,
  skillLevel: SkillLevel
): string {
  const actionLines = events
    .map(
      (event, i) =>
        `${i + 1}. ${event.tool_name}${event.file_path ? ` (${event.file_path})` : ''} — ${event.status}`
    )
    .join('\n')

  // 프로젝트 전체 구조도: overview 말풍선이 "전체 그림"을 짚을 수 있게 유닛과
  // 의존 관계를 넘긴다. 유닛이 아주 많아도 이름 수준이라 프롬프트 부담이 작다.
  const unitNameById = new Map(context.units.map((u) => [u.id, u.unit_name]))
  const structureLines = context.units
    .map((u) => `- ${u.unit_name} (${u.unit_type}, ${u.file_path})`)
    .join('\n')
  const edgeLines = context.edges
    .filter((e) => unitNameById.has(e.from_unit_id) && unitNameById.has(e.to_unit_id))
    .map((e) => `- ${unitNameById.get(e.from_unit_id)} —${e.edge_type}→ ${unitNameById.get(e.to_unit_id)}`)
    .join('\n')

  const changedLines = context.versions
    .map(
      (v) =>
        `- ${v.unit_name} (${v.unit_type}, ${v.file_path}) — ${v.change_type}, v${v.version_no}${
          v.diff_text ? `\n${truncate(v.diff_text, 1200)}` : ''
        }`
    )
    .join('\n')

  return [
    MENTOR_PERSONA,
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    BUBBLE_INSTRUCTIONS,
    '## 사용자의 요청 (이번 턴)',
    prompt.user_text ?? '(요청 텍스트 없음)',
    prompt.plan_text ? `## 에이전트의 계획\n${prompt.plan_text}` : '',
    structureLines ? `## 프로젝트 전체 구조도 (유닛 목록)\n${structureLines}` : '',
    edgeLines ? `## 유닛 간 의존 관계\n${edgeLines}` : '',
    changedLines
      ? `## 이번 턴에서 바뀐 코드 유닛 (diff 포함)\n${changedLines}`
      : '## 이번 턴에서 바뀐 코드 유닛\n(추적된 코드 유닛 변경 없음 — 실행된 액션 기준으로 설명해줘)',
    `## 이번 턴에서 실행된 액션들\n${actionLines}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n…(생략)` : text
}

export const EXPLAIN_TURN_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    bubbles: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ['overview', 'change', 'concept'] },
          title: { type: Type.STRING },
          text: { type: Type.STRING }
        },
        required: ['kind', 'text']
      }
    },
    conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ['summary', 'bubbles', 'conceptTags']
}
