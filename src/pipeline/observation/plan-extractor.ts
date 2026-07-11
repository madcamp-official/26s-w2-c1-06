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
 */
export class PlanTracker {
  private stateBySession = new Map<string, TurnState>();

  startTurn(sessionId: string): void {
    this.stateBySession.set(sessionId, { hasTentativeText: false, hasTodoWrite: false });
  }

  /** 반영해야 할 텍스트가 있으면 반환, 없으면(이미 후보가 있거나 TodoWrite가 먼저 왔으면) null. */
  considerAssistantText(sessionId: string, text: string): string | null {
    const state = this.stateBySession.get(sessionId);
    if (!state || state.hasTentativeText || state.hasTodoWrite) return null;
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
