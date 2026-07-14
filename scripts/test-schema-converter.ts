// geminiSchemaToJsonSchema 단위 테스트. 네트워크/DB 불필요 — 순수 변환 로직만 검증.
// 실행: npm run test:schema-converter

import assert from 'node:assert/strict'
import { Type, type Schema } from '@google/genai'
import { wrapAsOpenAIJsonSchema } from '../src/ai/openai-provider/geminiSchemaToJsonSchema'

// explainBatchPrompt.ts의 EXPLAIN_BATCH_RESPONSE_SCHEMA와 동일한 모양 —
// 옵셔널 필드가 없는(전부 required) 단순 배열 스키마.
const SIMPLE_ARRAY_SCHEMA: Schema = {
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

// progressSummaryPrompt.ts의 PROGRESS_SUMMARY_RESPONSE_SCHEMA와 동일한 모양 —
// keyCode가 옵셔널(required에 없음) + nullable:true인 중첩 오브젝트.
const NULLABLE_NESTED_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      stepId: { type: Type.STRING },
      summary: { type: Type.STRING },
      keyCode: {
        type: Type.OBJECT,
        nullable: true,
        properties: {
          explanation: { type: Type.STRING },
          importance: { type: Type.STRING }
        },
        required: ['explanation', 'importance']
      }
    },
    required: ['stepId', 'summary']
  }
}

function testWrapsTopLevelArrayAsObject(): void {
  const wrapped = wrapAsOpenAIJsonSchema('explain_batch', SIMPLE_ARRAY_SCHEMA)

  assert.equal(wrapped.name, 'explain_batch')
  assert.equal(wrapped.strict, true, 'OpenAI Structured Outputs requires strict:true')
  assert.equal(wrapped.schema.type, 'object', 'top level must be object — OpenAI strict mode rejects a bare array root')
  assert.deepEqual(wrapped.schema.required, ['items'])
  assert.equal(wrapped.schema.additionalProperties, false)
  assert.equal(wrapped.schema.properties?.items.type, 'array')
  console.log('✓ top-level ARRAY schema wraps into { type: object, properties: { items } }')
}

function testAllPropertiesBecomeRequiredInStrictMode(): void {
  const wrapped = wrapAsOpenAIJsonSchema('explain_batch', SIMPLE_ARRAY_SCHEMA)
  const itemSchema = wrapped.schema.properties!.items.items!

  assert.deepEqual(
    new Set(itemSchema.required),
    new Set(['eventId', 'caption', 'conceptTags']),
    'every property must be listed in required for OpenAI strict mode'
  )
  assert.equal(itemSchema.additionalProperties, false)
  console.log('✓ every object property lands in required[] (strict mode requirement)')
}

function testOptionalFieldBecomesNullableTypeUnion(): void {
  const wrapped = wrapAsOpenAIJsonSchema('progress_summary', NULLABLE_NESTED_SCHEMA)
  const itemSchema = wrapped.schema.properties!.items.items!
  const keyCodeSchema = itemSchema.properties!.keyCode

  // Gemini에서 required 밖에 있던 keyCode도, strict 모드에선 required에 들어가되
  // type이 [object, null] 유니언이 되어 "생략 가능"의 의미를 대신 표현해야 한다.
  assert.ok(itemSchema.required!.includes('keyCode'), 'nullable-but-optional field must still appear in required[]')
  assert.deepEqual(keyCodeSchema.type, ['object', 'null'])
  assert.ok(keyCodeSchema.required!.includes('explanation'))
  assert.ok(keyCodeSchema.required!.includes('importance'))
  console.log('✓ nullable Gemini field converts to a [type, "null"] union, still present in required[]')
}

function testNonNullableFieldKeepsSingularType(): void {
  const wrapped = wrapAsOpenAIJsonSchema('progress_summary', NULLABLE_NESTED_SCHEMA)
  const itemSchema = wrapped.schema.properties!.items.items!

  assert.equal(itemSchema.properties!.stepId.type, 'string')
  assert.equal(itemSchema.properties!.summary.type, 'string')
  console.log('✓ non-nullable fields keep a plain string type (no null union)')
}

const tests = [
  testWrapsTopLevelArrayAsObject,
  testAllPropertiesBecomeRequiredInStrictMode,
  testOptionalFieldBecomesNullableTypeUnion,
  testNonNullableFieldKeepsSingularType
]

function main(): void {
  for (const test of tests) test()
  console.log('\nall geminiSchemaToJsonSchema tests passed')
}

main()
