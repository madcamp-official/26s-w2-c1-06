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

// target_type='step' 캡션: 신규는 { title, body, why, ttsScript } JSON,
// 구형은 plain string → body fallback.
export interface StepExplanationContent {
  title: string
  body: string
  why: string
  ttsScript: string
}

export function serializeStepExplanation(content: StepExplanationContent): string {
  return JSON.stringify(content)
}

export function parseStepExplanation(raw: string | null | undefined): StepExplanationContent {
  if (!raw) return { title: '', body: '', why: '', ttsScript: '' }
  try {
    const parsed = JSON.parse(raw) as Partial<StepExplanationContent>
    if (parsed && typeof parsed === 'object' && typeof parsed.body === 'string') {
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        body: parsed.body,
        why: typeof parsed.why === 'string' ? parsed.why : '',
        ttsScript: typeof parsed.ttsScript === 'string' ? parsed.ttsScript : ''
      }
    }
  } catch {
    // plain string legacy caption
  }
  return { title: '', body: raw, why: '', ttsScript: '' }
}

export function truncateText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}
