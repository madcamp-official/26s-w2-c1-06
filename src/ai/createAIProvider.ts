import type { AIProvider } from './types'
import { GeminiKeyPool } from './key-pool/GeminiKeyPool'
import { GeminiProvider } from './gemini-provider/GeminiProvider'
import { MockAIProvider } from './mock-provider/MockAIProvider'

export function createAIProvider(): AIProvider {
  const keys = [process.env.GEMINI_KEY_A, process.env.GEMINI_KEY_B].filter(
    (key): key is string => Boolean(key)
  )

  if (keys.length === 0) {
    console.warn('[ai] GEMINI_KEY_A/B not set (.env) — falling back to MockAIProvider, no network calls made')
    return new MockAIProvider()
  }

  return new GeminiProvider(new GeminiKeyPool(keys))
}
