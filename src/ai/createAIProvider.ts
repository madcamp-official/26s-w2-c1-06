import type { AIProvider } from './types'
import { GeminiKeyPool } from './key-pool/GeminiKeyPool'
import { GeminiProvider } from './gemini-provider/GeminiProvider'
import { OpenAIProvider } from './openai-provider/OpenAIProvider'
import { MockAIProvider } from './mock-provider/MockAIProvider'

export function createAIProvider(): AIProvider {
  if (process.env.DISABLE_GEMINI === 'true') {
    console.warn('[ai] DISABLE_GEMINI=true — using MockAIProvider, no network calls made')
    return new MockAIProvider()
  }

  // OPENAI_API_KEY가 있으면 GPT를 우선 사용한다 — Gemini 키가 .env에 남아있어도
  // 무시되는데, 사용자가 "GPT로 바꾸고 싶다"고 명시했기 때문. Gemini로 되돌리려면
  // OPENAI_API_KEY를 지우거나 비워두면 된다.
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider(process.env.OPENAI_API_KEY)
  }

  const keys = [process.env.GEMINI_KEY_A, process.env.GEMINI_KEY_B].filter(
    (key): key is string => Boolean(key)
  )

  if (keys.length === 0) {
    console.warn(
      '[ai] neither OPENAI_API_KEY nor GEMINI_KEY_A/B set (.env) — falling back to MockAIProvider, no network calls made'
    )
    return new MockAIProvider()
  }

  return new GeminiProvider(new GeminiKeyPool(keys))
}
