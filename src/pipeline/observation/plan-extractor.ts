export interface TodoItem {
  content: string;
  status: string;
  activeForm: string;
}

interface TurnState {
  hasTentativeText: boolean;
  hasTodoWrite: boolean;
}

/**
 * 턴별 plan_text 후보를 추적한다 (SPEC 4.1 — 훅이 아니라 TodoWrite tool_use에서 추출).
 * 우선순위: TodoWrite가 항상 최종 — 텍스트보다 늦게 도착해도 덮어쓴다.
 * 텍스트는 턴의 "첫" assistant 텍스트만 잠정값으로 채택하고, 그 이후 텍스트는 무시한다.
 * 단, 사용자에게 되묻는 질문(예: "~할까요?")은 "계획"이 아니므로 후보에서 제외하고
 * 같은 턴의 다음 텍스트를 계속 기다린다 — 그렇지 않으면 "이번 프롬프트의 계획" 카드에
 * 질문 문장이 그대로 노출된다.
 */
export class PlanTracker {
  private stateBySession = new Map<string, TurnState>();

  startTurn(sessionId: string): void {
    this.stateBySession.set(sessionId, { hasTentativeText: false, hasTodoWrite: false });
  }

  /** 반영해야 할 텍스트가 있으면 반환, 없으면(이미 후보가 있거나 TodoWrite가 먼저 왔거나 질문이면) null. */
  considerAssistantText(sessionId: string, text: string): string | null {
    const state = this.stateBySession.get(sessionId);
    if (!state || state.hasTentativeText || state.hasTodoWrite) return null;
    if (looksLikeClarifyingQuestion(text)) return null;
    state.hasTentativeText = true;
    return text;
  }

  /** TodoWrite는 매번 최신 계획으로 최종 반영한다. */
  considerTodoWrite(sessionId: string, todos: TodoItem[]): string {
    const state = this.stateBySession.get(sessionId);
    if (state) state.hasTodoWrite = true;
    return formatTodoPlan(todos);
  }
}

function formatTodoPlan(todos: TodoItem[]): string {
  return todos.map((t) => `- [${t.status}] ${t.content}`).join('\n');
}

/** 마지막 문장이 물음표로 끝나면 사용자에게 되묻는 질문으로 간주한다(단순 휴리스틱). */
function looksLikeClarifyingQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lastChar = trimmed[trimmed.length - 1];
  return lastChar === '?' || lastChar === '?';
}
