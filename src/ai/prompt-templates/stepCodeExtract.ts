import type { ToolEvent } from '@shared/types'

// step-worker.ts가 스텝의 "대표 코드"/"지금 하는 중" 텍스트/실패 원인을 전부
// 결정론적으로(=AI 호출 없이) 뽑아내는 유틸. AI는 이 결과를 보고 설명만 채운다
// (코드를 다시 타이핑하거나 인자를 추측하게 하지 않는다).

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
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

// raw_payload(=ParsedToolUse 직렬화)에서 도구별로 의미 있는 실제 인자를 뽑는다 —
// "Bash를 실행했다" 대신 "npm install better-sqlite3를 실행했다"처럼 구체적인 "지금
// 하는 중" 표시가 나오게 하는 근거. 파싱 실패/미지원 도구는 조용히 null.
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

const DIFF_LINE_MAX_LENGTH = 80

function toDiffLines(text: string, marker: '+' | '-', max: number): string[] {
  return text
    .split('\n')
    .slice(0, max)
    .map((line) => `${marker} ${truncate(line, DIFF_LINE_MAX_LENGTH)}`)
}

// Edit/Write 이벤트의 raw_payload(old_string/new_string 또는 content)를 그대로
// "- "/"+ " 접두사 줄로 나눈다 — 대표 코드 스니펫이 추측이 아니라 세션에서 실제로
// 바뀐 텍스트를 보여주게 한다.
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

function langFor(filePath: string): string {
  return filePath.endsWith('.tsx') || filePath.endsWith('.ts') ? 'ts' : 'text'
}

export interface CodeCandidate {
  filePath: string
  lang: string
  snippet: string
  otherFiles: string[]
}

// 스텝 안에서 "지금 보여줄 대표 코드"를 결정론적으로 고른다. 첫 번째로 눈에 띈
// Edit/Write를 무조건 고르면 스크래치/임시 파일이 먼저 만들어졌을 때 그게 잘못
// 뽑힌다 — src/ 하위 실제 소스를 우선하고, 그 안에서 가장 마지막(최종 상태) 것을
// 고른다. diff 추출이 실패하는 후보는 건너뛰고 다음으로 넘어간다.
export function pickCodeCandidate(events: ToolEvent[]): CodeCandidate | null {
  const codeEvents = events.filter(
    (e) => (e.tool_name === 'Edit' || e.tool_name === 'Write') && e.file_path
  )
  if (codeEvents.length === 0) return null

  const preferred = codeEvents.filter((e) => e.file_path!.startsWith('src/'))
  const ordered = [...(preferred.length > 0 ? preferred : codeEvents)].reverse()

  for (const candidate of ordered) {
    const lines = extractDiffSnippetLines(candidate)
    if (!lines || lines.length === 0) continue

    const otherFiles = [
      ...new Set(codeEvents.filter((e) => e.file_path !== candidate.file_path).map((e) => e.file_path!))
    ]

    return {
      filePath: candidate.file_path!,
      lang: langFor(candidate.file_path!),
      snippet: lines.join('\n'),
      otherFiles
    }
  }
  return null
}

const ERROR_DETAIL_MAX_LENGTH = 200

// 스텝에 속한 실패 이벤트의 원본 에러 메시지를 그대로(요약 없이) 잘라서 보여준다 —
// AI가 만드는 게 아니라 실제 result_content를 그대로 노출.
export function errorDetailOf(events: ToolEvent[]): string | null {
  const failed = events.find((e) => e.status === 'error' && e.result_content)
  if (!failed?.result_content) return null
  const text = failed.result_content
  return text.length > ERROR_DETAIL_MAX_LENGTH ? text.slice(0, ERROR_DETAIL_MAX_LENGTH) + '…' : text
}
