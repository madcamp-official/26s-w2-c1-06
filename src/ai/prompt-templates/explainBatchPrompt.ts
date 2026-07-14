import { Type, type Schema } from '@google/genai'
import type { AssistantNote, SkillLevel, ToolEvent } from '@shared/types'
import { SKILL_TONE_INSTRUCTIONS } from './skillTone'

const RESULT_SNIPPET_MAX_LENGTH = 400
const NOTE_SNIPPET_MAX_LENGTH = 200

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// raw_payload(=ParsedToolUse 직렬화)에서 도구별로 학습에 의미 있는 실제 인자를 뽑는다.
// "Bash를 실행했다" 대신 "npm install better-sqlite3를 실행했다"처럼 구체적인 캡션이
// 나오게 하는 핵심 근거. 파싱 실패/미지원 도구는 조용히 null(도구 이름만으로 설명).
// progress-worker의 "지금 하는 중" 라이브 상태 줄도 이 함수를 재사용한다 —
// Bash/Grep/Task 등 file_path가 없는 도구가 "파일 미지정"으로만 뜨는 문제를 고치기 위함.
export function summarizeRawPayload(toolName: string, rawPayload: string | null): string | null {
  const rec = parseToolInput(rawPayload)
  if (!rec) return null

  const field = (key: string, max: number): string | null => {
    const value = rec[key]
    return typeof value === 'string' && value.length > 0 ? truncate(value, max) : null
  }

  switch (toolName) {
    case 'Bash':
      return field('command', 300)
    case 'Edit': {
      const before = field('old_string', 200)
      const after = field('new_string', 200)
      if (!before && !after) return null
      return `변경 전: ${before ?? '(없음)'} / 변경 후: ${after ?? '(없음)'}`
    }
    case 'Write':
      return field('content', 300)
    case 'Grep':
      return [field('pattern', 100), field('path', 100), field('glob', 60)].filter(Boolean).join(' · ') || null
    case 'Glob':
      return field('pattern', 200)
    case 'Task':
      return field('prompt', 300)
    case 'WebFetch':
      return field('url', 200)
    case 'WebSearch':
      return field('query', 200)
    default:
      return null
  }
}

function parseToolInput(rawPayload: string | null): Record<string, unknown> | null {
  if (!rawPayload) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawPayload)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const input = (parsed as { input?: unknown }).input
  if (!input || typeof input !== 'object') return null
  return input as Record<string, unknown>
}

const DIFF_LINE_MAX_LENGTH = 80

function toDiffLines(text: string, marker: '+' | '-', max: number): string[] {
  return text
    .split('\n')
    .slice(0, max)
    .map((line) => `${marker} ${truncate(line, DIFF_LINE_MAX_LENGTH)}`)
}

// Edit/Write 이벤트의 raw_payload(old_string/new_string 또는 content)를 그대로
// "- "/"+ " 접두사 줄로 나눈다. progressSummaryPrompt의 keyCode.snippet에 쓸
// 실제 데이터 기반 diff — Gemini/Mock 둘 다 재사용해 snippet이 추측이 아니라
// 세션에서 실제로 바뀐 텍스트를 보여주게 한다.
export function extractDiffSnippetLines(event: ToolEvent, maxLinesPerSide = 3): string[] | null {
  const input = parseToolInput(event.raw_payload)
  if (!input) return null

  if (event.tool_name === 'Edit') {
    const oldString = input.old_string
    const newString = input.new_string
    if (typeof oldString !== 'string' && typeof newString !== 'string') return null
    return [
      ...(typeof oldString === 'string' ? toDiffLines(oldString, '-', maxLinesPerSide) : []),
      ...(typeof newString === 'string' ? toDiffLines(newString, '+', maxLinesPerSide) : [])
    ]
  }

  if (event.tool_name === 'Write') {
    const content = input.content
    if (typeof content !== 'string') return null
    return toDiffLines(content, '+', maxLinesPerSide * 2)
  }

  return null
}

// 같은 턴(prompt_id) 안에서 이 이벤트보다 먼저 온 assistant_notes 중 가장 최근 것을
// "에이전트의 직전 의도"로 취급한다. 캡션이 "무엇을 했는지"뿐 아니라 "왜 했는지"까지
// 반영하게 하는 근거(학습 파이프라인 2단계 데이터 활용).
function findPrecedingNote(event: ToolEvent, notes: AssistantNote[]): AssistantNote | null {
  const eventTime = event.created_at ? Date.parse(event.created_at) : null
  if (eventTime === null) return null

  let best: AssistantNote | null = null
  let bestTime = -Infinity
  for (const note of notes) {
    if (note.prompt_id !== event.prompt_id) continue
    const noteTime = note.created_at ? Date.parse(note.created_at) : null
    if (noteTime === null || noteTime > eventTime) continue
    if (noteTime > bestTime) {
      best = note
      bestTime = noteTime
    }
  }
  return best
}

// 이벤트의 "실제 근거"(도구 인자 요약 + 성공/에러 내용) 줄들. 배치 캡션과 스텝
// 요약 프롬프트가 공유한다(explainStepPrompt.ts에서 재사용).
export function describeEventBody(event: ToolEvent, indent = '   '): string[] {
  const lines: string[] = []

  const argSummary = summarizeRawPayload(event.tool_name, event.raw_payload)
  if (argSummary) lines.push(`${indent}실제 인자/내용: ${argSummary}`)

  if (event.result_content) {
    const label = event.status === 'error' ? '에러 메시지' : '결과 요약'
    lines.push(`${indent}${label}: ${truncate(event.result_content, RESULT_SNIPPET_MAX_LENGTH)}`)
  }

  return lines
}

function describeEvent(event: ToolEvent, notes: AssistantNote[], index: number): string {
  const lines = [
    `${index + 1}. eventId=${event.id} tool=${event.tool_name} file=${event.file_path ?? '(none)'} status=${event.status}`,
    ...describeEventBody(event)
  ]

  const note = findPrecedingNote(event, notes)
  if (note) lines.push(`   에이전트의 직전 의도: ${truncate(note.text, NOTE_SNIPPET_MAX_LENGTH)}`)

  return lines.join('\n')
}

// SPEC 4.3.1: 요약과 개념 태그를 같은 호출에서 한 번에 생성 (별도 호출 금지 → RPM 절약).
// 학습 파이프라인 1~2단계에서 쌓은 실제 근거(도구 인자, 성공/에러 내용, 에이전트의 직전
// 의도)를 함께 넘겨 "Bash를 실행했다" 식의 일반론이 아니라 이번 세션에만 해당하는
// 구체적인 설명이 나오게 한다.
export function buildExplainBatchPrompt(events: ToolEvent[], notes: AssistantNote[], skillLevel: SkillLevel): string {
  const eventLines = events.map((event, i) => describeEvent(event, notes, i)).join('\n')

  return [
    'You are explaining an AI coding agent\'s actions to a learner watching a real-time trace panel.',
    SKILL_TONE_INSTRUCTIONS[skillLevel],
    '아래 이벤트 각각에 대해 한국어로 1~2문장의 해설과, 관련된 프로그래밍 개념 태그(1~3개, 짧은 명사구)를 만들어줘.',
    '각 이벤트에는 실제 인자/내용, 결과 요약이나 에러 메시지, 에이전트의 직전 의도가 함께 주어질 수 있어. 이 정보를 반드시 반영해서 "무엇을 왜 했고 어떻게 됐는지"가 구체적으로 드러나게 설명해줘 — "Bash를 실행했다" 같은 일반론이 아니라 이번 세션에서 실제로 일어난 일을 설명해줘.',
    '상태가 error인 이벤트는 에러 메시지를 근거로 왜 실패했는지를 설명에 포함해줘.',
    '반드시 아래 이벤트 목록에 있는 eventId만 사용하고, 목록에 없는 id를 만들어내지 마.',
    '이벤트 목록:',
    eventLines
  ].join('\n\n')
}

export const EXPLAIN_BATCH_RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      eventId: { type: Type.STRING },
      caption: { type: Type.STRING },
      conceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['eventId', 'caption', 'conceptTags']
  }
}
