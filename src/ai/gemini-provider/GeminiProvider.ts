import { GoogleGenAI, type Schema } from '@google/genai'
import type { CodeUnitVersionWithUnit, Prompt, SkillLevel, ToolEvent } from '@shared/types'
import type {
  AIProvider,
  ContextBundle,
  SessionTrace,
  StepInput,
  StepKeyCodeExplanation,
  StepSummary,
  TurnCaption,
  VersionCaption
} from '../types'
import type { GeminiKeyPool } from '../key-pool/GeminiKeyPool'
import { buildAnswerQuestionPrompt } from '../prompt-templates/answerQuestionPrompt'
import { buildExtractPlanPrompt } from '../prompt-templates/extractPlanPrompt'
import { buildExplainTurnPrompt, EXPLAIN_TURN_RESPONSE_SCHEMA } from '../prompt-templates/explainTurnPrompt'
import {
  buildExplainVersionsPrompt,
  EXPLAIN_VERSIONS_RESPONSE_SCHEMA,
  sliceKeySnippet
} from '../prompt-templates/explainVersionsPrompt'
import { buildLectureNotePrompt } from '../prompt-templates/lectureNotePrompt'
import {
  buildSummarizeStepsPrompt,
  SUMMARIZE_STEPS_RESPONSE_SCHEMA
} from '../prompt-templates/summarizeStepsPrompt'

// Gemini 무료 티어 쿼터는 모델별로 별도 집계된다(429 응답의 quotaId가 모델명을
// 포함 — 예: "GenerateRequestsPerDayPerProjectPerModel-FreeTier"). 즉 flash 모델의
// 하루 쿼터(적게는 20회)를 다 쓰더라도 더 가벼운 모델은 별도 쿼터가 남아있을 수 있다.
// 앞쪽일수록 우선 시도하는 모델이고, 실패하면 뒤로 폴백한다(generateText 참조).
// 'gemini-2.5-flash'처럼 특정 버전을 첫 순위로 박아두면 신규 발급 키에서 404가 나는
// 문제가 있었다(위 alias로 대체했던 이력) — 그래서 앞쪽 두 개는 구글이 계속 최신 모델을
// 가리키도록 유지하는 alias를 쓰고, 마지막 한 단계만 폴백 전용 안전망으로 구버전을 고정한다.
const MODEL_FALLBACK_CHAIN = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.0-flash']

// 모델 하나가 소진/사용불가로 확인되면 이 시간 동안은 건너뛰고 바로 다음 모델부터
// 시도한다 — 없으면 매 호출마다 이미 죽은 걸 아는 모델을 처음부터 다시 확인하느라
// (키 2개 × 쿨다운 대기) 수십 초씩 낭비된다. 그렇다고 영구히 건너뛰면 일일 쿼터가
// 리셋돼도 영영 안 돌아오므로 적당히 짧게 잡는다.
const MODEL_RETRY_COOLDOWN_MS = 5 * 60_000

interface RawVersionCaption {
  versionId?: string
  caption: string
  conceptTags: string[]
  keyStartLine?: number | null
  keyEndLine?: number | null
}

interface RawTurnCaption {
  caption?: string
  conceptTags?: string[]
}

interface RawStepKeyCode {
  explanation?: string
  importance?: string
  application?: string
  conceptTags?: string[]
}

interface RawStepSummary {
  stepId?: string
  summary?: string
  keyCode?: RawStepKeyCode | null
}

function sanitizeStepKeyCode(raw: RawStepKeyCode | null | undefined): StepKeyCodeExplanation | null {
  if (!raw) return null
  if (!raw.explanation || !raw.importance || !raw.application) return null
  return {
    explanation: raw.explanation,
    importance: raw.importance,
    application: raw.application,
    conceptTags: raw.conceptTags ?? []
  }
}

export class GeminiProvider implements AIProvider {
  private readonly clients = new Map<string, GoogleGenAI>()
  // 모델별 "이 시각 이후에 다시 시도해도 됨" 타임스탬프. 프로세스 수명 동안 유지된다.
  private readonly modelAvailableAt = new Map<string, number>()

  // baseUrl이 있으면(패키징된 배포본) 진짜 Gemini가 아니라 Vercel 프록시로 보낸다 —
  // keyPool이 들고 있는 값은 그 경우 프록시 전용 토큰들이지, 진짜 Gemini 키가 아니다
  // (createAIProvider.ts 참조, vercel-proxy/api/gemini/가 실제 프록시 구현).
  constructor(
    private readonly keyPool: GeminiKeyPool,
    private readonly baseUrl?: string
  ) {}

  async explainTurn(prompt: Prompt, events: ToolEvent[], skillLevel: SkillLevel): Promise<TurnCaption> {
    if (events.length === 0) return { promptId: prompt.id, caption: '', conceptTags: [] }

    const raw = await this.generateJson<RawTurnCaption>(
      buildExplainTurnPrompt(prompt, events, skillLevel),
      EXPLAIN_TURN_RESPONSE_SCHEMA,
      {}
    )

    return {
      promptId: prompt.id,
      caption: raw.caption ?? '',
      conceptTags: raw.conceptTags ?? []
    }
  }

  async summarizeSteps(steps: StepInput[], skillLevel: SkillLevel): Promise<StepSummary[]> {
    if (steps.length === 0) return []

    const raw = await this.generateJson<RawStepSummary[]>(
      buildSummarizeStepsPrompt(steps, skillLevel),
      SUMMARIZE_STEPS_RESPONSE_SCHEMA,
      []
    )
    const knownIds = new Set(steps.map((step) => step.stepId))

    return raw
      .filter((item) => item.stepId && knownIds.has(item.stepId) && item.summary?.trim())
      .map((item) => ({
        stepId: item.stepId!,
        summary: item.summary!.trim(),
        keyCode: sanitizeStepKeyCode(item.keyCode)
      }))
  }

  async explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]> {
    if (versions.length === 0) return []

    const raw = await this.generateJson<RawVersionCaption[]>(
      buildExplainVersionsPrompt(versions, skillLevel),
      EXPLAIN_VERSIONS_RESPONSE_SCHEMA,
      []
    )
    const versionById = new Map(versions.map((version) => [version.id, version]))

    return raw
      .filter((item) => item.versionId && versionById.has(item.versionId))
      .map((item) => ({
        versionId: item.versionId!,
        caption: item.caption,
        conceptTags: item.conceptTags ?? [],
        keySnippet: sliceKeySnippet(
          versionById.get(item.versionId!)!.diff_text,
          item.keyStartLine,
          item.keyEndLine
        )
      }))
  }

  async synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string> {
    const prompt = buildLectureNotePrompt(trace, skillLevel)
    return (await this.generateText(prompt)) ?? ''
  }

  async answerQuestion(question: string, context: ContextBundle, skillLevel: SkillLevel): Promise<string> {
    const prompt = buildAnswerQuestionPrompt(question, context, skillLevel)
    return (await this.generateText(prompt)) ?? ''
  }

  async extractPlan(userRequest: string, intentText: string): Promise<string> {
    const prompt = buildExtractPlanPrompt(userRequest, intentText)
    return (await this.generateText(prompt)) ?? ''
  }

  private async generateJson<T>(prompt: string, schema: Schema, fallback: T): Promise<T> {
    const responseText = await this.generateText(prompt, {
      responseMimeType: 'application/json',
      responseSchema: schema
    })

    if (!responseText) return fallback
    try {
      return JSON.parse(responseText) as T
    } catch {
      console.error('[GeminiProvider] failed to parse response as JSON:', responseText)
      return fallback
    }
  }

  // MODEL_FALLBACK_CHAIN을 순서대로 시도한다. 각 모델 시도는 keyPool.call로 두 API
  // 키를 round-robin/재시도하고, 그래도 실패하면(쿼터 소진 또는 404 등 모델 사용
  // 불가) 다음 모델로 넘어간다 — 마지막 모델까지 실패하면 그 에러를 그대로 던진다.
  private async generateText(
    contents: string,
    config?: { responseMimeType: string; responseSchema: Schema }
  ): Promise<string | undefined> {
    const now = Date.now()
    // 최근에 소진 확인된 모델은 건너뛰고 아직 살아있을 만한 모델부터 시작한다.
    // 전부 쿨다운 중이면(모든 모델이 최근에 실패했으면) 그래도 처음부터 다시 시도한다 —
    // 안 그러면 쿨다운이 겹쳐서 계속 아무 것도 안 시도하는 락아웃 상태에 빠질 수 있다.
    const candidates = MODEL_FALLBACK_CHAIN.filter((m) => (this.modelAvailableAt.get(m) ?? 0) <= now)
    const chain = candidates.length > 0 ? candidates : MODEL_FALLBACK_CHAIN

    let lastError: unknown
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i]
      try {
        return await this.keyPool.call(async (apiKey) => {
          const response = await this.clientFor(apiKey).models.generateContent({
            model,
            contents,
            ...(config ? { config } : {})
          })
          return response.text
        })
      } catch (error) {
        lastError = error
        this.modelAvailableAt.set(model, Date.now() + MODEL_RETRY_COOLDOWN_MS)
        const nextModel = chain[i + 1]
        if (!nextModel) throw error
        console.warn(
          `[GeminiProvider] ${model} 호출 실패(쿼터 소진 또는 모델 사용 불가로 추정) — 다음 모델로 폴백: ${nextModel}`,
          error instanceof Error ? error.message : error
        )
      }
    }
    // 위 for문은 chain이 비어있지 않은 한 항상 return/throw로 끝난다 — 타입 체커용 안전망.
    throw lastError
  }

  private clientFor(apiKey: string): GoogleGenAI {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new GoogleGenAI({
        apiKey,
        ...(this.baseUrl ? { httpOptions: { baseUrl: this.baseUrl } } : {})
      })
      this.clients.set(apiKey, client)
    }
    return client
  }
}
