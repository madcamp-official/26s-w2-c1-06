import { GoogleGenAI, type Schema } from '@google/genai'
import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import type {
  AIProvider,
  BatchCaption,
  ContextBundle,
  SessionTrace,
  StepCaption,
  StepInput,
  VersionCaption
} from '../types'
import type { GeminiKeyPool } from '../key-pool/GeminiKeyPool'
import { buildAnswerQuestionPrompt } from '../prompt-templates/answerQuestionPrompt'
import { buildExplainBatchPrompt, EXPLAIN_BATCH_RESPONSE_SCHEMA } from '../prompt-templates/explainBatchPrompt'
import { buildExplainStepsPrompt, EXPLAIN_STEPS_RESPONSE_SCHEMA } from '../prompt-templates/explainStepPrompt'
import {
  buildExplainVersionsPrompt,
  EXPLAIN_VERSIONS_RESPONSE_SCHEMA
} from '../prompt-templates/explainVersionsPrompt'
import { buildLectureNotePrompt } from '../prompt-templates/lectureNotePrompt'

// 'gemini-2.5-flash'는 이 프로젝트의 키 발급 시점 기준 신규 사용자에게 더 이상
// 제공되지 않아(404), 구글이 계속 최신 무료 flash 모델을 가리키도록 유지하는
// alias로 교체 — 특정 버전을 박아두면 같은 문제가 재발한다.
const MODEL = 'gemini-flash-latest'

interface RawCaption {
  eventId?: string
  versionId?: string
  stepId?: string
  title?: string
  caption: string
  why?: string
  ttsScript?: string
  conceptTags: string[]
}

export class GeminiProvider implements AIProvider {
  private readonly clients = new Map<string, GoogleGenAI>()

  constructor(private readonly keyPool: GeminiKeyPool) {}

  async explainBatch(events: ToolEvent[], notes: AssistantNote[], skillLevel: SkillLevel): Promise<BatchCaption[]> {
    if (events.length === 0) return []

    const raw = await this.generateJson(
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

  async explainSteps(steps: StepInput[], skillLevel: SkillLevel): Promise<StepCaption[]> {
    if (steps.length === 0) return []

    const raw = await this.generateJson(
      buildExplainStepsPrompt(steps, skillLevel),
      EXPLAIN_STEPS_RESPONSE_SCHEMA
    )
    const knownIds = new Set(steps.map((step) => step.stepId))

    return raw
      .filter((item) => item.stepId && knownIds.has(item.stepId))
      .map((item) => ({
        stepId: item.stepId!,
        title: item.title?.trim() || '학습 스텝',
        caption: item.caption,
        why: item.why?.trim() || '',
        ttsScript: item.ttsScript?.trim() || item.caption,
        conceptTags: item.conceptTags ?? []
      }))
  }

  async explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]> {
    if (versions.length === 0) return []

    const raw = await this.generateJson(
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

  private async generateJson(prompt: string, schema: Schema): Promise<RawCaption[]> {
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
