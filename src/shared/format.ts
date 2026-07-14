import type { TurnBubbleKind, TurnNarrative, TurnNarrativeBubble } from './types'

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('ko-KR', { hour12: false })
}

export function parseConceptTags(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

const NARRATIVE_FORMAT = 'turn-narrative-v1'
const BUBBLE_KINDS: TurnBubbleKind[] = ['overview', 'change', 'concept']

export function serializeTurnNarrative(narrative: TurnNarrative): string {
  return JSON.stringify({ format: NARRATIVE_FORMAT, ...narrative })
}

// content가 새 포맷(JSON)이면 말풍선 배열로, 개편 전에 캐시된 평문 요약이면
// overview 말풍선 하나로 감싸서 돌려준다 — 기존 ai_explanations 캐시를 그대로 살린다.
export function parseTurnNarrative(content: string): TurnNarrative {
  const fallback: TurnNarrative = {
    summary: content,
    bubbles: content ? [{ kind: 'overview', title: null, text: content }] : []
  }

  try {
    const parsed = JSON.parse(content)
    if (parsed?.format !== NARRATIVE_FORMAT || !Array.isArray(parsed.bubbles)) return fallback

    const bubbles: TurnNarrativeBubble[] = parsed.bubbles
      .filter((b: unknown): b is Record<string, unknown> => typeof b === 'object' && b !== null)
      .map((b: Record<string, unknown>) => ({
        kind: BUBBLE_KINDS.includes(b.kind as TurnBubbleKind) ? (b.kind as TurnBubbleKind) : 'change',
        title: typeof b.title === 'string' && b.title.length > 0 ? b.title : null,
        text: typeof b.text === 'string' ? b.text : ''
      }))
      .filter((b: TurnNarrativeBubble) => b.text.length > 0)

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      bubbles
    }
  } catch {
    return fallback
  }
}
