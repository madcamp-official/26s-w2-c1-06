import type { AiExplanation, AssistantNote, Prompt, ToolEvent } from '@shared/types'
import { parseConceptTags, parseStepExplanation } from '@shared/format'
import { groupIntoSteps } from '@shared/steps'

/** 세션 시작 시각 기준 경과 분 (최소 0). */
export function matchMinute(sessionStartedAt: string | null | undefined, atIso?: string | null): number {
  if (!sessionStartedAt) return 0
  const start = Date.parse(sessionStartedAt)
  const at = atIso ? Date.parse(atIso) : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(at)) return 0
  return Math.max(0, Math.floor((at - start) / 60_000))
}

export function formatMatchMinute(minute: number): string {
  return `${minute}'`
}

export interface LiveHeadline {
  title: string
  tags: string[]
  minute: number
}

function headlineFromExplanation(explanation: AiExplanation, minute: number): LiveHeadline | null {
  const parsed = parseStepExplanation(explanation.content)
  if (!parsed.title && !parsed.body) return null
  return {
    title: parsed.title || parsed.body.slice(0, 40),
    tags: parseConceptTags(explanation.concept_tags).slice(0, 3),
    minute
  }
}

/** 지금 캐스터 음성이 낭독 중인 stepId 기준 헤드라인 — 화면 티커를 오디오와 동기화할 때 사용. */
export function headlineForStep(
  stepId: string,
  notes: AssistantNote[],
  events: ToolEvent[],
  stepExplanations: Map<string, AiExplanation>,
  sessionStartedAt: string | null
): LiveHeadline | null {
  const explanation = stepExplanations.get(stepId)
  if (!explanation) return null
  const step = groupIntoSteps(notes, events).find((s) => s.id === stepId)
  const minute = matchMinute(sessionStartedAt, step?.note?.created_at ?? explanation.created_at)
  return headlineFromExplanation(explanation, minute)
}

export function latestLiveHeadline(
  prompts: Prompt[],
  notes: AssistantNote[],
  events: ToolEvent[],
  stepExplanations: Map<string, AiExplanation>,
  sessionStartedAt: string | null
): LiveHeadline {
  const currentTurn = prompts.length > 0 ? prompts[prompts.length - 1] : null
  const steps = groupIntoSteps(notes, events)

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]
    if (!step.id) continue
    const explanation = stepExplanations.get(step.id)
    if (!explanation) continue
    const headline = headlineFromExplanation(
      explanation,
      matchMinute(sessionStartedAt, step.note?.created_at ?? explanation.created_at)
    )
    if (headline) return headline
  }

  if (currentTurn?.plan_text) {
    return {
      title: currentTurn.plan_text.split('\n')[0].slice(0, 60),
      tags: [],
      minute: matchMinute(sessionStartedAt, currentTurn.created_at)
    }
  }
  if (currentTurn?.user_text) {
    return {
      title: currentTurn.user_text.slice(0, 60),
      tags: [],
      minute: matchMinute(sessionStartedAt, currentTurn.created_at)
    }
  }
  return { title: '킥오프 대기', tags: [], minute: matchMinute(sessionStartedAt) }
}

export type UnitTypePos = 'FW' | 'MF' | 'DF' | 'GK'

export function unitTypeToPos(unitType: string): UnitTypePos {
  switch (unitType) {
    case 'component':
      return 'FW'
    case 'hook':
      return 'MF'
    case 'class':
      return 'DF'
    default:
      return 'MF'
  }
}
