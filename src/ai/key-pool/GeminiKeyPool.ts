const DEFAULT_COOLDOWN_MS = 60_000
const MAX_WAITS = 2 // 모든 키가 쿨다운일 때 대기를 허용하는 최대 횟수

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(error: unknown): boolean {
  const status =
    (error as { status?: number }).status ?? (error as { response?: { status?: number } }).response?.status
  if (status === 429) return true
  return /429|RESOURCE_EXHAUSTED/i.test(String((error as { message?: string })?.message ?? error))
}

// Key A/B 라운드로빈 + 429 폴백. 매 호출마다 키를 번갈아 써서 두 키의 무료 티어
// RPM 예산을 합쳐 쓴다 (SPEC 4.3: "사실상 RPM 예산 2배"). caption-worker의
// 자체 스로틀(틱당 1회 호출)만으로도 워스트케이스 12 RPM이 나오는데, 이는
// 무료 티어 하한(10 RPM)보다 높을 수 있다 — 키 하나에 고정하면 그 키 혼자
// 12 RPM을 받아 429가 날 수 있지만, 라운드로빈으로 절반씩(~6 RPM) 나누면
// 어느 키도 한도에 안 걸린다. 두 키 모두 쿨다운 중이면 즉시 실패시키지 않고
// 가장 빨리 풀리는 키를 기다렸다가 재시도한다. 대기(waits)와 실제 API
// 호출(apiCalls) 예산을 분리해서, "60초 기다린 뒤 재시도 없이 포기"하는 일이
// 없도록 한다.
//
// 참고: 키를 어떻게 고르든 Gemini generateContent 호출 자체는 무상태(stateless)라
// 대화 맥락과는 무관하다. Q&A(Day 6)에서 "이전 질문을 기억"하게 하려면
// 매 호출마다 이전 대화 내역을 프롬프트에 명시적으로 포함해야 한다.
export class GeminiKeyPool {
  private readonly keys: string[]
  private readonly cooldownMs: number
  private readonly cooldownUntil = new Map<string, number>()
  private cursor = 0

  constructor(keys: string[], cooldownMs: number = DEFAULT_COOLDOWN_MS) {
    if (keys.length === 0) throw new Error('GeminiKeyPool requires at least one API key')
    this.keys = keys
    this.cooldownMs = cooldownMs
  }

  async call<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    const maxApiCalls = this.keys.length + 1
    let apiCalls = 0
    let waits = 0

    for (;;) {
      const key = this.nextAvailableKey()

      if (!key) {
        if (waits >= MAX_WAITS) {
          throw new Error('GeminiKeyPool: all keys rate-limited, gave up after waiting')
        }
        waits++
        await sleep(this.shortestCooldownRemainingMs())
        continue
      }

      apiCalls++
      try {
        return await fn(key)
      } catch (error) {
        if (isRateLimitError(error) && apiCalls < maxApiCalls) {
          this.cooldownUntil.set(key, Date.now() + this.cooldownMs)
          continue
        }
        throw error
      }
    }
  }

  private nextAvailableKey(): string | null {
    const now = Date.now()
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.cursor + i) % this.keys.length
      const key = this.keys[idx]
      if ((this.cooldownUntil.get(key) ?? 0) <= now) {
        this.cursor = (idx + 1) % this.keys.length // 다음 호출은 다른 키로 (라운드로빈)
        return key
      }
    }
    return null
  }

  private shortestCooldownRemainingMs(): number {
    const now = Date.now()
    let min = this.cooldownMs
    for (const until of this.cooldownUntil.values()) {
      if (until > now) min = Math.min(min, until - now)
    }
    return min + 50 // 만료 직전에 깨어나 헛도는 것 방지용 여유
  }
}
