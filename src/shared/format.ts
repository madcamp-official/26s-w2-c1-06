export function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('ko-KR', { hour12: false })
}

// "직전 실행의 과정" 등 데모 톤의 타임라인 리스트용 — 초 단위 정밀도 대신
// "방금 전"/"n분 전" 식의 상대 시각으로 보여준다. formatTime은 절대 시각이
// 필요한 곳(활동 탭 상세 등)에서 그대로 계속 쓴다.
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffMs = Date.now() - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}일 전`
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}

// Claude Code가 사용자 메시지 앞뒤에 자동으로 끼워 넣는 컨텍스트 태그들(지금 연
// IDE 파일, 선택 영역, 시스템 리마인더 등) — user_text에 그대로 저장되므로, 프롬프트
// 제목/카드로 보여줄 땐 사람이 실제로 타이핑한 부분만 남기고 걷어낸다. AI 캡션 생성
// (caption-worker)엔 원본 그대로 넘어가야 하므로 여기서 걷어내는 건 화면 표시용일 뿐,
// DB에 저장된 원본 텍스트 자체는 건드리지 않는다.
const SYSTEM_CONTEXT_TAG_NAMES = ['ide_opened_file', 'ide_selection', 'ide_diagnostics', 'system-reminder']
const SYSTEM_CONTEXT_TAG_PATTERN = new RegExp(
  `<(${SYSTEM_CONTEXT_TAG_NAMES.join('|')})>[\\s\\S]*?<\\/\\1>`,
  'g'
)

export function stripSystemContextTags(text: string | null): string {
  if (!text) return ''
  return text.replace(SYSTEM_CONTEXT_TAG_PATTERN, '').trim()
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
