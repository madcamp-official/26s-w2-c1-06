import type Database from 'better-sqlite3'
import type { ContextBundle, SessionTrace, StepSummaryForNote } from '@ai/types'
import type {
  AiExplanation,
  AssistantNote,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  Prompt,
  Session,
  ToolEvent
} from '@shared/types'
import { parseConceptTags, parseStepExplanation } from '@shared/format'
import { groupIntoSteps } from '@shared/steps'

// lecture-note-worker(자동 합성)와 온디맨드 재생성 IPC가 동일한 조회 로직을 쓰도록
// 공유한다 — 강의노트에 실제로 반영되는 범위가 두 경로에서 어긋나지 않게 하기 위함.
export function createSessionTraceLoader(
  db: Database.Database
): (sessionId: string) => SessionTrace | null {
  const getSession = db.prepare(`SELECT * FROM sessions WHERE id = @session_id`)

  const getPrompts = db.prepare(`
    SELECT * FROM prompts WHERE session_id = @session_id ORDER BY turn_index ASC
  `)

  const getToolEvents = db.prepare(`
    SELECT * FROM tool_events WHERE session_id = @session_id ORDER BY created_at ASC
  `)

  const getNotes = db.prepare(`
    SELECT * FROM assistant_notes WHERE session_id = @session_id ORDER BY created_at ASC, rowid ASC
  `)

  const getStepExplanations = db.prepare(`
    SELECT ae.*
    FROM ai_explanations ae
    JOIN assistant_notes an ON an.id = ae.target_id
    WHERE ae.target_type = 'step' AND an.session_id = @session_id
  `)

  const getVersions = db.prepare(`
    SELECT DISTINCT v.*, u.unit_name, u.unit_type, u.file_path
    FROM code_unit_versions v
    JOIN code_units u ON u.id = v.unit_id
    LEFT JOIN tool_events te ON te.id = v.tool_event_id
    LEFT JOIN prompts p ON p.id = v.prompt_id
    WHERE te.session_id = @session_id OR p.session_id = @session_id
    ORDER BY v.created_at ASC
  `)

  return (sessionId: string): SessionTrace | null => {
    const session = getSession.get({ session_id: sessionId }) as Session | undefined
    if (!session) return null

    const notes = getNotes.all({ session_id: sessionId }) as AssistantNote[]
    const events = getToolEvents.all({ session_id: sessionId }) as ToolEvent[]
    const explanations = getStepExplanations.all({ session_id: sessionId }) as AiExplanation[]
    const byId = new Map(explanations.map((e) => [e.target_id, e]))

    const steps: StepSummaryForNote[] = groupIntoSteps(notes, events)
      .filter((step) => step.id !== null && step.events.length > 0)
      .map((step) => {
        const explanation = byId.get(step.id!)
        if (explanation) {
          const parsed = parseStepExplanation(explanation.content)
          return {
            title: parsed.title,
            body: parsed.body,
            why: parsed.why,
            conceptTags: parseConceptTags(explanation.concept_tags)
          }
        }
        // 캡션 없으면 note 앞부분으로 최소 서사라도 넣는다.
        return {
          title: '',
          body: step.note?.text?.slice(0, 200) ?? '',
          why: '',
          conceptTags: []
        }
      })
      .filter((step) => step.body.length > 0)

    return {
      session,
      prompts: getPrompts.all({ session_id: sessionId }) as Prompt[],
      toolEvents: events,
      versions: getVersions.all({ session_id: sessionId }) as CodeUnitVersionWithUnit[],
      steps
    }
  }
}

// SPEC 4.3.3 Q&A 컨텍스트: 구조(유닛+엣지) + 세션 요청 이력. tool_event 원시
// 스트림까지는 넣지 않는다 — 세션이 길면 프롬프트가 과도하게 커져 RPM/토큰 낭비.
export function createContextBundleLoader(
  db: Database.Database
): (sessionId: string) => ContextBundle | null {
  const getSession = db.prepare(`SELECT * FROM sessions WHERE id = @session_id`)
  const getPrompts = db.prepare(`
    SELECT * FROM prompts WHERE session_id = @session_id ORDER BY turn_index ASC
  `)
  const getUnits = db.prepare(`SELECT * FROM code_units ORDER BY file_path ASC, unit_name ASC`)
  const getEdges = db.prepare(`SELECT * FROM code_unit_edges`)

  return (sessionId: string): ContextBundle | null => {
    const session = getSession.get({ session_id: sessionId }) as Session | undefined
    if (!session) return null

    return {
      session,
      prompts: getPrompts.all({ session_id: sessionId }) as Prompt[],
      units: getUnits.all() as CodeUnit[],
      edges: getEdges.all() as CodeUnitEdge[]
    }
  }
}
