import type {
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  Prompt,
  Session,
  SkillLevel,
  ToolEvent
} from '@shared/types'

// 턴(prompt) 전체를 하나로 묶은 feature 단위 캡션 — 개별 tool_event가 아니라
// 그 턴에서 실제로 완성된 변경 사항을 요약한다 (관제실 그룹 헤더에 표시).
export interface TurnCaption {
  promptId: string
  caption: string
  conceptTags: string[]
}

export interface VersionCaption {
  versionId: string
  caption: string
  conceptTags: string[]
  // 이 변경에서 AI가 "핵심"이라고 고른 부분 — 다만 AI가 코드를 다시 타이핑하는 게
  // 아니라, diff의 실제 줄 범위를 고르면 우리가 그 줄들을 그대로 잘라 채운다
  // (explainVersionsPrompt.ts의 줄 번호 매김 + 각 Provider의 슬라이싱 참조) — 그래서
  // 이 필드는 항상 diff_text의 정확한 부분 문자열이고, AI가 만들어낸 텍스트가 아니다.
  // null이면 범위를 못 골랐거나(생성 실패 등) diff 전체가 이미 핵심이라고 판단한 경우.
  keySnippet: string | null
}

// 실시간 진행 로그(활동 탭 "바뀐 구조와 변경사항") 전용: 스텝(유휴시간/개수로 나뉜
// 이벤트 묶음) 단위 요약. codeCandidate는 step-worker가 이미 결정론적으로 뽑아둔
// 대표 diff — AI는 이걸 보고 설명만 채우지, 코드 자체를 새로 만들어내지 않는다.
export interface StepInput {
  stepId: string
  noteText: string | null
  events: ToolEvent[]
  codeCandidate: { filePath: string; lang: string; snippet: string; otherFiles: string[] } | null
}

// AIProvider.summarizeSteps가 실제로 채우는 부분 — 이미 주어진 codeCandidate에 대한
// 설명 3필드만. filePath/lang/snippet/otherFiles는 여기 없다(AI 책임 아님).
export interface StepKeyCodeExplanation {
  explanation: string
  importance: string
  application: string
  conceptTags: string[]
}

export interface StepSummary {
  stepId: string
  summary: string
  keyCode: StepKeyCodeExplanation | null
}

// SPEC 4.3.2 강의노트 합성 입력: 세션 전체를 한 번에 컨텍스트로 투입.
export interface SessionTrace {
  session: Session
  prompts: Prompt[]
  toolEvents: ToolEvent[]
  versions: CodeUnitVersionWithUnit[]
}

// SPEC 4.3.3 Q&A 입력: 질문 시점까지의 구조(유닛+엣지) + 세션의 요청(prompt) 이력.
export interface ContextBundle {
  session: Session
  prompts: Prompt[]
  units: CodeUnit[]
  edges: CodeUnitEdge[]
}

// SPEC 4.3의 AIProvider: 실시간 해설(4.3.1, 턴/feature 단위)·코드 유닛 변경 요약(Level 3)·
// 강의노트 합성(4.3.2)·Q&A 챗(4.3.3).
export interface AIProvider {
  // 프롬프트를 보낼 때가 아니라, 그 턴의 코딩 수정이 "완료된" 시점에 한 번만 호출된다
  // (caption-worker.ts의 완료 판정 참조) — Read/Write/Bash 등 개별 tool_event 단위가
  // 아니라 턴 전체를 하나의 feature로 요약해 관제실에 보여준다.
  explainTurn(prompt: Prompt, events: ToolEvent[], skillLevel: SkillLevel): Promise<TurnCaption>
  // 활동 탭의 실시간 진행 로그(SPEC 확장: "실시간 코드 변천사 모니터링") 전용 — 턴이
  // 끝나기 전에도(진행 중에도) 스텝 단위로 호출된다. explainTurn과 달리 턴 완료를
  // 기다리지 않는다(step-worker.ts 참조).
  summarizeSteps(steps: StepInput[], skillLevel: SkillLevel): Promise<StepSummary[]>
  explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]>
  synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string>
  answerQuestion(question: string, context: ContextBundle, skillLevel: SkillLevel): Promise<string>
}

