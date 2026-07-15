import type { AIProvider } from './types'
import { GeminiKeyPool } from './key-pool/GeminiKeyPool'
import { GeminiProvider } from './gemini-provider/GeminiProvider'
import { OpenAIProvider } from './openai-provider/OpenAIProvider'
import { MockAIProvider } from './mock-provider/MockAIProvider'

// OpenAI를 우선 사용하고(OPENAI_API_KEY), 없으면 Gemini(GEMINI_KEY_A/B)로,
// 둘 다 없으면 네트워크 호출 없는 MockAIProvider로 떨어진다.
export function createAIProvider(): AIProvider {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider(process.env.OPENAI_API_KEY)
  }

  const keys = [process.env.GEMINI_KEY_A, process.env.GEMINI_KEY_B].filter(
    (key): key is string => Boolean(key)
  )

  if (keys.length === 0) {
    console.warn(
      '[ai] OPENAI_API_KEY/GEMINI_KEY_A/B not set (.env) — falling back to MockAIProvider, no network calls made'
    )
    return new MockAIProvider()
  }

  return new GeminiProvider(new GeminiKeyPool(keys))
}
