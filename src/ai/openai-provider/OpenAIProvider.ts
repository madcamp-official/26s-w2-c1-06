import OpenAI from 'openai'
import type { Schema } from '@google/genai'
import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import type { QuizLesson } from '@shared/quiz'
import type {
  AIProvider,
  BatchCaption,
  ContextBundle,
  KeyCodeExplanation,
  ProgressSummary,
  SessionTrace,
  StepInput,
  VersionCaption
} from '../types'
import { buildAnswerQuestionPrompt } from '../prompt-templates/answerQuestionPrompt'
import { buildExplainBatchPrompt, EXPLAIN_BATCH_RESPONSE_SCHEMA } from '../prompt-templates/explainBatchPrompt'
import {
  buildExplainVersionsPrompt,
  EXPLAIN_VERSIONS_RESPONSE_SCHEMA
} from '../prompt-templates/explainVersionsPrompt'
import { buildLectureNotePrompt } from '../prompt-templates/lectureNotePrompt'
import {
  buildProgressSummaryPrompt,
  PROGRESS_SUMMARY_RESPONSE_SCHEMA
} from '../prompt-templates/progressSummaryPrompt'
import { buildQuizPrompt, QUIZ_RESPONSE_SCHEMA } from '../prompt-templates/quizPrompt'
import { wrapAsOpenAIJsonSchema } from './geminiSchemaToJsonSchema'

// 'gemini-flash-latest'와 같은 취지 — 특정 스냅샷(예: gpt-5-mini-2025-08-07)을
// 박아두면 그 스냅샷이 폐기됐을 때 404가 난다. 대신 롤링 alias를 기본값으로 쓰고,
// 필요하면 코드 수정 없이 OPENAI_MODEL로 override 가능하게 한다.
const DEFAULT_MODEL = 'gpt-5-mini'

interface RawCaption {
  eventId?: string
  versionId?: string
  caption: string
  conceptTags: string[]
}

interface RawKeyCode {
  explanation?: string
  importance?: string
  application?: string
  conceptTags?: string[]
}

interface RawProgressSummary {
  stepId?: string
  summary?: string
  keyCode?: RawKeyCode | null
}

interface RawQuizQuestion {
  prompt?: string
  options?: string[]
  correctIndex?: number
  note?: string
}

interface RawQuizLesson {
  versionId?: string
  content?: string
  code?: string
  questions?: RawQuizQuestion[]
}

function sanitizeQuizQuestions(raw: RawQuizQuestion[] | undefined): QuizLesson['questions'] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (q): q is Required<RawQuizQuestion> =>
        Boolean(q.prompt?.trim()) &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        typeof q.correctIndex === 'number' &&
        q.correctIndex >= 0 &&
        q.correctIndex < q.options.length
    )
    .map((q) => ({
      prompt: q.prompt.trim(),
      options: q.options,
      correctIndex: q.correctIndex,
      note: q.note?.trim() ?? ''
    }))
}

function sanitizeKeyCode(raw: RawKeyCode | null | undefined): KeyCodeExplanation | null {
  if (!raw) return null
  if (!raw.explanation || !raw.importance || !raw.application) return null
  return {
    explanation: raw.explanation,
    importance: raw.importance,
    application: raw.application,
    conceptTags: raw.conceptTags ?? []
  }
}

// GeminiProvider와 동일한 AIProvider 계약을 구현한다. prompt-templates/*의
// buildXxxPrompt + Xxx_RESPONSE_SCHEMA는 provider 중립적이라 그대로 재사용하고,
// 여기서는 OpenAI Chat Completions(Structured Outputs)로 호출하는 부분만 다르다.
export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI
  private readonly model: string

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
    this.model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL
  }

  async explainBatch(events: ToolEvent[], notes: AssistantNote[], skillLevel: SkillLevel): Promise<BatchCaption[]> {
    if (events.length === 0) return []

    const raw = await this.generateJson<RawCaption>(
      'explain_batch',
      buildExplainBatchPrompt(events, notes, skillLevel),
      EXPLAIN_BATCH_RESPONSE_SCHEMA
    )
    const knownIds = new Set(events.map((event) => event.id))

    return raw
      .filter((item) => item.eventId && knownIds.has(item.eventId))
      .map((item) => ({
        toolEventId: item.eventId!,
        caption: item.caption,
        conceptTags: item.conceptTags ?? []
      }))
  }

  async summarizeProgress(steps: StepInput[], skillLevel: SkillLevel): Promise<ProgressSummary[]> {
    if (steps.length === 0) return []

    const raw = await this.generateJson<RawProgressSummary>(
      'progress_summary',
      buildProgressSummaryPrompt(steps, skillLevel),
      PROGRESS_SUMMARY_RESPONSE_SCHEMA
    )
    const knownIds = new Set(steps.map((step) => step.stepId))

    return raw
      .filter((item) => item.stepId && knownIds.has(item.stepId) && item.summary?.trim())
      .map((item) => ({
        stepId: item.stepId!,
        summary: item.summary!.trim(),
        keyCode: sanitizeKeyCode(item.keyCode)
      }))
  }

  async explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]> {
    if (versions.length === 0) return []

    const raw = await this.generateJson<RawCaption>(
      'explain_versions',
      buildExplainVersionsPrompt(versions, skillLevel),
      EXPLAIN_VERSIONS_RESPONSE_SCHEMA
    )
    const knownIds = new Set(versions.map((version) => version.id))

    return raw
      .filter((item) => item.versionId && knownIds.has(item.versionId))
      .map((item) => ({
        versionId: item.versionId!,
        caption: item.caption,
        conceptTags: item.conceptTags ?? []
      }))
  }

  async generateQuiz(versions: CodeUnitVersionWithUnit[], skillLevel: SkillLevel): Promise<QuizLesson[]> {
    if (versions.length === 0) return []

    const raw = await this.generateJson<RawQuizLesson>(
      'quiz',
      buildQuizPrompt(versions, skillLevel),
      QUIZ_RESPONSE_SCHEMA
    )
    const versionById = new Map(versions.map((v) => [v.id, v]))

    return raw
      .filter((item) => item.versionId && versionById.has(item.versionId) && item.content?.trim())
      .map((item) => {
        const version = versionById.get(item.versionId!)!
        return {
          id: item.versionId!,
          unitName: version.unit_name,
          unitType: version.unit_type,
          filePath: version.file_path,
          content: item.content!.trim(),
          code: item.code?.trim() ?? '',
          questions: sanitizeQuizQuestions(item.questions)
        }
      })
      .filter((lesson) => lesson.questions.length > 0)
  }

  async synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string> {
    const prompt = buildLectureNotePrompt(trace, skillLevel)
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }]
    })
    return response.choices[0]?.message?.content ?? ''
  }

  async answerQuestion(
    question: string,
    context: ContextBundle,
    skillLevel: SkillLevel
  ): Promise<string> {
    const prompt = buildAnswerQuestionPrompt(question, context, skillLevel)
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }]
    })
    return response.choices[0]?.message?.content ?? ''
  }

  // 응답 스키마는 전부 최상위가 배열이라(Gemini 쪽 관례), strict 모드가 요구하는
  // "최상위 object" 형태로 { items: [...] } 감싼 뒤 items만 꺼내 돌려준다.
  private async generateJson<T>(schemaName: string, prompt: string, schema: Schema): Promise<T[]> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: wrapAsOpenAIJsonSchema(schemaName, schema)
      }
    })

    const content = response.choices[0]?.message?.content
    if (!content) return []
    try {
      const parsed = JSON.parse(content) as { items?: T[] }
      return parsed.items ?? []
    } catch {
      console.error('[OpenAIProvider] failed to parse response as JSON:', content)
      return []
    }
  }
}
