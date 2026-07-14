import type { Schema } from '@google/genai'

// Gemini의 Schema(OpenAPI 3.0 서브셋, Type enum)를 OpenAI Structured Outputs가
// 요구하는 JSON Schema로 변환한다. 이 프로젝트의 모든 응답 스키마(EXPLAIN_BATCH_
// RESPONSE_SCHEMA 등)는 provider 중립적으로 prompt-templates/*에 이미 정의돼
// 있으므로, OpenAIProvider도 GeminiProvider와 동일한 스키마를 그대로 재사용하고
// 여기서만 변환한다 — 스키마를 두 벌 유지하지 않기 위함.
//
// strict 모드 제약(OpenAI): 모든 object는 모든 property를 required에 나열해야
// 하고, 생략 가능한 필드는 대신 type을 [T, "null"]로 만든다. Gemini 쪽 스키마는
// "옵셔널 필드는 항상 nullable:true"로 일관되게 짜여 있어 이 규칙과 자연히 맞는다.
interface JsonSchemaNode {
  [key: string]: unknown
  type: string | string[]
  description?: string
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaNode
}

function convertType(type: Schema['type']): string {
  switch (type) {
    case 'STRING':
      return 'string'
    case 'NUMBER':
      return 'number'
    case 'INTEGER':
      return 'integer'
    case 'BOOLEAN':
      return 'boolean'
    case 'ARRAY':
      return 'array'
    case 'OBJECT':
      return 'object'
    default:
      return 'string'
  }
}

function convertSchema(schema: Schema): JsonSchemaNode {
  const jsonType = convertType(schema.type)
  const result: JsonSchemaNode = {
    type: schema.nullable ? [jsonType, 'null'] : jsonType
  }
  if (schema.description) result.description = schema.description

  if (jsonType === 'object' && schema.properties) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, convertSchema(value)])
    )
    // strict 모드: 옵셔널이었던 필드도 전부 required에 넣고 nullable로 대체 표현.
    result.required = Object.keys(schema.properties)
    result.additionalProperties = false
  }

  if (jsonType === 'array' && schema.items) {
    result.items = convertSchema(schema.items)
  }

  return result
}

export interface OpenAIJsonSchemaFormat {
  name: string
  strict: true
  schema: JsonSchemaNode
}

// Gemini 응답 스키마는 전부 최상위가 배열(type: ARRAY)이라, OpenAI strict 모드가
// 요구하는 "최상위는 object"에 맞춰 { items: [...] } 로 한 겹 감싼다. 호출부는
// parsed.items를 꺼내 쓴다.
export function wrapAsOpenAIJsonSchema(name: string, schema: Schema): OpenAIJsonSchemaFormat {
  return {
    name,
    strict: true,
    schema: {
      type: 'object',
      properties: { items: convertSchema(schema) },
      required: ['items'],
      additionalProperties: false
    }
  }
}
