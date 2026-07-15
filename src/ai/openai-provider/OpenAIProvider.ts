import OpenAI from 'openai'
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
import { buildAnswerQuestionPrompt } from '../prompt-templates/answerQuestionPrompt'
import { buildExplainTurnPrompt } from '../prompt-templates/explainTurnPrompt'
import { buildExplainVersionsPrompt, sliceKeySnippet } from '../prompt-templates/explainVersionsPrompt'
import { buildLectureNotePrompt } from '../prompt-templates/lectureNotePrompt'
import { buildSummarizeStepsPrompt } from '../prompt-templates/summarizeStepsPrompt'

// 계정마다 접근 가능한 모델이 다를 수 있어(구버전 키, 조직 제한, 아직 미승인된
// 최신 모델 등) GeminiProvider와 같은 방식으로 폴백 체인을 둔다 — 앞 모델이
// 404/모델 미지원으로 실패하면 다음 모델로 넘어간다.
const MODEL_FALLBACK_CHAIN = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-3.5-turbo']

// 모델 하나가 사용불가로 확인되면 이 시간 동안은 건너뛰고 바로 다음 모델부터
// 시도한다(GeminiProvider와 동일한 이유 — 매 호출마다 죽은 모델을 처음부터
// 다시 확인하느라 응답이 느려지는 것을 방지).
const MODEL_RETRY_COOLDOWN_MS = 5 * 60_000

// versionId(형태: "${toolEventId}:${unitId}")는 콜론이 섞인 긴 복합 문자열이라, OpenAI의
// json_object 모드가 이걸 그대로 echo하다가 콜론 앞부분만 잘라 돌려주는 경우가 실제로
// 관찰됐다(Gemini의 스키마 강제 출력과 달리 OpenAI json_object는 필드값을 자유 텍스트로
// 생성해 정확한 echo를 보장하지 않는다) — 그러면 knownIds에 없는 id로 필터링돼 캡션이
// 영원히 저장되지 않는다("요약 생성 중…"이 안 풀리던 실제 원인). AI에게 원본 id를 다시
// 뱉게 하는 대신, 프롬프트에 이미 적어준 1-based 번호(index)만 돌려받아 우리가 직접
// versions 배열에서 실제 id를 찾아 붙인다 — AI가 opaque id 문자열을 다룰 필요 자체를 없앤다.
interface RawVersionCaption {
  index?: number
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

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI
  // 모델별 "이 시각 이후에 다시 시도해도 됨" 타임스탬프. 프로세스 수명 동안 유지된다.
  private readonly modelAvailableAt = new Map<string, number>()

  // baseURL이 있으면(패키징된 배포본) 진짜 OpenAI가 아니라 Cloudflare Worker 프록시로
  // 보낸다 — apiKey는 그 경우 프록시 인증용 토큰일 뿐, 진짜 OpenAI 키가 아니다
  // (createAIProvider.ts 참조, worker/ 디렉토리가 그 프록시 구현).
  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }

  async explainTurn(prompt: Prompt, events: ToolEvent[], skillLevel: SkillLevel): Promise<TurnCaption> {
    if (events.length === 0) return { promptId: prompt.id, caption: '', conceptTags: [] }

    const raw = await this.generateJson<RawTurnCaption>(
      buildExplainTurnPrompt(prompt, events, skillLevel),
      '반드시 아래 형태의 JSON 객체 하나로만 답해라(다른 텍스트 없이): {"caption": string, "conceptTags": string[]}',
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

    // OpenAI json_object 모드는 최상위가 반드시 JSON 객체여야 한다(배열 불가) —
    // Gemini의 최상위 배열 스키마와 달리 "steps" 키로 한 번 감싸서 받는다.
    const raw = await this.generateJson<{ steps?: RawStepSummary[] }>(
      buildSummarizeStepsPrompt(steps, skillLevel),
      '반드시 아래 형태의 JSON 객체 하나로만 답해라(다른 텍스트 없이): ' +
        '{"steps": [{"stepId": string, "summary": string, "keyCode": {"explanation": string, "importance": string, "application": string, "conceptTags": string[]} | null}]}',
      {}
    )
    const knownIds = new Set(steps.map((step) => step.stepId))
    const items = raw.steps ?? []

    return items
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

    const raw = await this.generateJson<{ versions?: RawVersionCaption[] }>(
      buildExplainVersionsPrompt(versions, skillLevel),
      '반드시 아래 형태의 JSON 객체 하나로만 답해라(다른 텍스트 없이): ' +
        '{"versions": [{"index": number, "caption": string, "conceptTags": string[], ' +
        '"keyStartLine": number | null, "keyEndLine": number | null}]} ' +
        '— index는 프롬프트의 변경 목록에 적힌 번호(1부터 시작)와 정확히 같아야 한다. ' +
        'versionId 문자열은 절대 다시 출력하지 마라. keyStartLine/keyEndLine은 diff에 매겨진 ' +
        '줄 번호(1부터)이고, 그 줄의 코드 내용을 직접 옮겨 적지 마라 — 번호만 알려주면 된다.',
      {}
    )
    const items = raw.versions ?? []

    return items
      .filter((item) => typeof item.index === 'number' && item.index >= 1 && item.index <= versions.length)
      .map((item) => {
        const version = versions[item.index! - 1]
        return {
          versionId: version.id,
          caption: item.caption,
          conceptTags: item.conceptTags ?? [],
          keySnippet: sliceKeySnippet(version.diff_text, item.keyStartLine, item.keyEndLine)
        }
      })
  }

  async synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string> {
    const prompt = buildLectureNotePrompt(trace, skillLevel)
    return (await this.generateText(prompt)) ?? ''
  }

  async answerQuestion(question: string, context: ContextBundle, skillLevel: SkillLevel): Promise<string> {
    const prompt = buildAnswerQuestionPrompt(question, context, skillLevel)
    return (await this.generateText(prompt)) ?? ''
  }

  private async generateJson<T>(userPrompt: string, jsonShapeInstruction: string, fallback: T): Promise<T> {
    const responseText = await this.generateText(userPrompt, jsonShapeInstruction)
    if (!responseText) return fallback
    try {
      return JSON.parse(responseText) as T
    } catch {
      console.error('[OpenAIProvider] failed to parse response as JSON:', responseText)
      return fallback
    }
  }

  // MODEL_FALLBACK_CHAIN을 순서대로 시도한다. 한 모델이 실패하면(모델 사용 불가,
  // 쿼터 소진 등) 다음 모델로 넘어가고, 마지막 모델까지 실패하면 그 에러를 던진다.
  private async generateText(userPrompt: string, jsonShapeInstruction?: string): Promise<string | undefined> {
    const now = Date.now()
    const candidates = MODEL_FALLBACK_CHAIN.filter((m) => (this.modelAvailableAt.get(m) ?? 0) <= now)
    const chain = candidates.length > 0 ? candidates : MODEL_FALLBACK_CHAIN

    let lastError: unknown
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i]
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: jsonShapeInstruction
            ? [
                { role: 'system', content: jsonShapeInstruction },
                { role: 'user', content: userPrompt }
              ]
            : [{ role: 'user', content: userPrompt }],
          ...(jsonShapeInstruction ? { response_format: { type: 'json_object' as const } } : {})
        })
        return response.choices[0]?.message?.content ?? undefined
      } catch (error) {
        lastError = error
        this.modelAvailableAt.set(model, Date.now() + MODEL_RETRY_COOLDOWN_MS)
        const nextModel = chain[i + 1]
        if (!nextModel) throw error
        console.warn(
          `[OpenAIProvider] ${model} 호출 실패(모델 미지원 또는 쿼터 소진으로 추정) — 다음 모델로 폴백: ${nextModel}`,
          error instanceof Error ? error.message : error
        )
      }
    }
    // 위 for문은 chain이 비어있지 않은 한 항상 return/throw로 끝난다 — 타입 체커용 안전망.
    throw lastError
  }
}
