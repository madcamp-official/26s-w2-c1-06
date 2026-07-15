// GeminiKeyPool 단위 테스트. 네트워크/DB 불필요 — 순수 로직만 검증.
// 실행: npm run test:keypool

import assert from 'node:assert/strict'
import { GeminiKeyPool } from '../src/ai/key-pool/GeminiKeyPool'

function rateLimitError(): Error {
  const error = new Error('429 RESOURCE_EXHAUSTED') as Error & { status: number }
  error.status = 429
  return error
}

async function testRoundRobin(): Promise<void> {
  const pool = new GeminiKeyPool(['A', 'B'], 200)
  const used: string[] = []
  await pool.call(async (key) => used.push(key))
  await pool.call(async (key) => used.push(key))
  await pool.call(async (key) => used.push(key))
  assert.deepEqual(used, ['A', 'B', 'A'], 'round-robin should alternate keys to split RPM load')
  console.log('✓ round-robin alternates keys (splits RPM load across both keys)')
}

async function testFallbackOn429(): Promise<void> {
  const pool = new GeminiKeyPool(['A', 'B'], 60_000)
  const result = await pool.call(async (key) => {
    if (key === 'A') throw rateLimitError()
    return key
  })
  assert.equal(result, 'B', '429 on A should immediately fall back to B')

  // A는 쿨다운에 들어갔으므로 다음 호출도 B를 사용해야 함
  const second = await pool.call(async (key) => key)
  assert.equal(second, 'B', 'A should stay on cooldown for subsequent calls')
  console.log('✓ 429 triggers immediate fallback + cooldown')
}

async function testWaitThenRecover(): Promise<void> {
  const pool = new GeminiKeyPool(['A', 'B'], 150)
  let attempts = 0
  const start = Date.now()
  const result = await pool.call(async (key) => {
    attempts++
    if (attempts <= 2) throw rateLimitError() // 두 키 모두 첫 시도에서 429
    return key
  })
  const elapsed = Date.now() - start
  assert.equal(attempts, 3, 'should retry after waiting out the cooldown')
  assert.ok(elapsed >= 150, `should have waited ≥150ms (waited ${elapsed}ms)`)
  assert.ok(result === 'A' || result === 'B')
  console.log(`✓ both keys down → waits ${elapsed}ms then recovers`)
}

async function testNonRateLimitErrorPropagates(): Promise<void> {
  const pool = new GeminiKeyPool(['A', 'B'], 200)
  let attempts = 0
  await assert.rejects(
    pool.call(async () => {
      attempts++
      throw new Error('boom')
    }),
    /boom/,
    'non-429 errors should propagate immediately'
  )
  assert.equal(attempts, 1, 'non-429 errors should not be retried')
  console.log('✓ non-429 error propagates without retry')
}

async function testGivesUpWhenAlwaysRateLimited(): Promise<void> {
  const pool = new GeminiKeyPool(['A', 'B'], 100)
  let attempts = 0
  await assert.rejects(
    pool.call(async () => {
      attempts++
      throw rateLimitError()
    }),
    /rate-limited|exhausted/i,
    'should eventually give up when every call is 429'
  )
  assert.ok(attempts >= 2, `should have tried at least both keys (tried ${attempts})`)
  console.log(`✓ permanent 429 gives up after ${attempts} bounded attempts`)
}

const tests = [
  testRoundRobin,
  testFallbackOn429,
  testWaitThenRecover,
  testNonRateLimitErrorPropagates,
  testGivesUpWhenAlwaysRateLimited
]

async function main(): Promise<void> {
  for (const test of tests) {
    await test()
  }
  console.log('\nall GeminiKeyPool tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
