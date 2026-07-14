import { GoogleGenAI, type Schema } from '@google/genai'
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
import type { GeminiKeyPool } from '../key-pool/GeminiKeyPool'
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

// 'gemini-2.5-flash'는 이 프로젝트의 키 발급 시점 기준 신규 사용자에게 더 이상
// 제공되지 않아(404), 구글이 계속 최신 무료 flash 모델을 가리키도록 유지하는
// alias로 교체 — 특정 버전을 박아두면 같은 문제가 재발한다.
const MODEL = 'gemini-flash-latest'

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
    application: raw.application
  }
}

export class GeminiProvider implements AIProvider {
  private readonly clients = new Map<string, GoogleGenAI>()

  constructor(private readonly keyPool: GeminiKeyPool) {}

  async explainBatch(events: ToolEvent[], notes: AssistantNote[], skillLevel: SkillLevel): Promise<BatchCaption[]> {
    if (events.length === 0) return []

    const raw = await this.generateJson<RawCaption>(
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

    const raw = await this.generateJson<RawQuizLesson>(buildQuizPrompt(versions, skillLevel), QUIZ_RESPONSE_SCHEMA)
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
    const responseText = await this.keyPool.call(async (apiKey) => {
      const response = await this.clientFor(apiKey).models.generateContent({
        model: MODEL,
        contents: prompt
      })
      return response.text
    })
    return responseText ?? ''
  }

  async answerQuestion(
    question: string,
    context: ContextBundle,
    skillLevel: SkillLevel
  ): Promise<string> {
    const prompt = buildAnswerQuestionPrompt(question, context, skillLevel)
    const responseText = await this.keyPool.call(async (apiKey) => {
      const response = await this.clientFor(apiKey).models.generateContent({
        model: MODEL,
        contents: prompt
      })
      return response.text
    })
    return responseText ?? ''
  }

  private async generateJson<T>(prompt: string, schema: Schema): Promise<T[]> {
    const responseText = await this.keyPool.call(async (apiKey) => {
      const response = await this.clientFor(apiKey).models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      })
      return response.text
    })

    if (!responseText) return []
    try {
      return JSON.parse(responseText)
    } catch {
      console.error('[GeminiProvider] failed to parse response as JSON:', responseText)
      return []
    }
  }

  private clientFor(apiKey: string): GoogleGenAI {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new GoogleGenAI({ apiKey })
      this.clients.set(apiKey, client)
    }
    return client
  }
}
