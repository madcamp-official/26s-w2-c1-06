import type Database from 'better-sqlite3';

export interface CodeUnitRow {
  id: string;
  file_path: string;
  unit_name: string;
  unit_type: string;
}

/**
 * sessions/prompts/tool_events/code_units/code_unit_versions/code_unit_edges에 대한 CRUD.
 */
export class Repo {
  constructor(private db: Database.Database) {}

  // --- sessions -------------------------------------------------------
  ensureSession(id: string, projectId: string, projectPath: string, startedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, project_path, started_at, ended_at)
         VALUES (@id, @projectId, @projectPath, @startedAt, NULL)
         ON CONFLICT(id) DO NOTHING`
      )
      .run({ id, projectId, projectPath, startedAt });
  }

  // SessionStart 훅 마커는 transcript보다 먼저 도착할 수도, 나중에 도착할 수도 있다.
  // ensureSession(있으면 무시)과 달리 이건 훅이 주는 권위 있는 시각으로 항상 덮어쓴다.
  setSessionStartedAt(id: string, startedAt: string): void {
    this.db.prepare(`UPDATE sessions SET started_at = @startedAt WHERE id = @id`).run({ id, startedAt });
  }

  // SessionEnd 훅 마커 수신 시 기록. Person B는 이 값의 NULL→NOT NULL 전이를 강의노트 합성 트리거로 쓴다.
  setSessionEndedAt(id: string, endedAt: string): void {
    this.db.prepare(`UPDATE sessions SET ended_at = @endedAt WHERE id = @id`).run({ id, endedAt });
  }

  // 세션 재개(resume) 감지용: 이 id로 이미 종료 처리된 세션 행이 있는지 확인한다
  // (index.ts의 resolveLogicalSessionId 참조 — 같은 JSONL 세션을 "완료" 후 다시
  // "시작하기"로 재개하면 새 논리 세션 id를 발급해야 강의노트 재생성이 걸린다).
  getSession(id: string): { ended_at: string | null } | undefined {
    return this.db.prepare(`SELECT ended_at FROM sessions WHERE id = ?`).get(id) as
      | { ended_at: string | null }
      | undefined;
  }

  // --- prompts ----------------------------------------------------------
  // id는 호출부에서 결정론적으로 생성해 전달한다(JSONL 라인 uuid 기반) — 세션 재관찰/재시작 시
  // 같은 히스토리를 다시 리플레이해도 중복 행 없이 안전하게 재실행되도록(INSERT OR IGNORE).
  insertPrompt(params: { id: string; sessionId: string; turnIndex: number; userText: string; createdAt: string }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO prompts (id, session_id, turn_index, user_text, plan_text, created_at)
         VALUES (@id, @sessionId, @turnIndex, @userText, NULL, @createdAt)`
      )
      .run(params);
  }

  updatePromptPlanText(promptId: string, planText: string): void {
    this.db.prepare(`UPDATE prompts SET plan_text = @planText WHERE id = @promptId`).run({ promptId, planText });
  }

  // --- tool_events --------------------------------------------------------
  insertToolEvent(params: {
    id: string;
    // manual-watch가 감지한 수정은 특정 turn/세션에 묶이지 않을 수 있어(에이전트 없이 발생) nullable.
    sessionId: string | null;
    promptId: string | null;
    toolName: string;
    filePath: string | null;
    source: 'agent' | 'manual';
    rawPayload: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO tool_events (id, session_id, prompt_id, tool_name, file_path, source, status, duration_ms, raw_payload, created_at)
         VALUES (@id, @sessionId, @promptId, @toolName, @filePath, @source, 'pending', NULL, @rawPayload, @createdAt)`
      )
      .run(params);
  }

  // resultContent: tool_result의 텍스트화된 내용(성공 출력/에러 메시지, truncate됨) —
  // 실시간 진행 로그(step-worker.ts)가 실패 이유를 보여줄 근거. 없으면(추출 실패 등) null.
  updateToolEventResult(
    toolUseId: string,
    status: 'success' | 'error',
    durationMs: number,
    resultContent: string | null
  ): void {
    this.db
      .prepare(
        `UPDATE tool_events SET status = @status, duration_ms = @durationMs, result_content = @resultContent WHERE id = @toolUseId`
      )
      .run({ toolUseId, status, durationMs, resultContent });
  }

  // --- assistant_notes ----------------------------------------------------
  // 턴당 1개만 살아남는 prompts.plan_text 폴백과 달리, assistant_text 조각 전부를
  // 보존한다 — 실시간 진행 로그의 스텝 카드가 "그때 에이전트가 남긴 말"을 참고
  // 텍스트로 붙일 때 쓴다(step-worker.ts). id는 호출부가 결정론적으로 구성해
  // 전달한다(세션+timestamp+텍스트 해시) — 리플레이 시 안전하게 재실행되도록.
  insertAssistantNote(params: {
    id: string;
    sessionId: string;
    promptId: string | null;
    text: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO assistant_notes (id, session_id, prompt_id, text, created_at)
         VALUES (@id, @sessionId, @promptId, @text, @createdAt)`
      )
      .run(params);
  }

  getToolEvent(toolUseId: string): { tool_name: string; file_path: string | null; raw_payload: string; created_at: string } | undefined {
    return this.db
      .prepare(`SELECT tool_name, file_path, raw_payload, created_at FROM tool_events WHERE id = ?`)
      .get(toolUseId) as never;
  }

  // --- code_units / code_unit_versions --------------------------------------
  upsertCodeUnit(params: {
    id: string;
    projectId: string;
    filePath: string;
    unitName: string;
    unitType: string;
    timestamp: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO code_units (id, project_id, file_path, unit_name, unit_type, first_seen_at, last_seen_at)
         VALUES (@id, @projectId, @filePath, @unitName, @unitType, @timestamp, @timestamp)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = @timestamp`
      )
      .run(params);
  }

  getNextVersionNo(unitId: string): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM code_unit_versions WHERE unit_id = ?`)
      .get(unitId) as { next: number };
    return row.next;
  }

  // id는 호출부에서 `${toolEventId}:${unitId}`처럼 결정론적으로 구성해 전달한다 —
  // 같은 tool_event가 같은 unit에 대해 두 번 버전을 만들 수 없으므로 유일성이 보장되고,
  // 리플레이 시 INSERT OR IGNORE로 조용히 스킵된다(PK 충돌, UNIQUE(unit_id,version_no) 충돌 모두 커버).
  insertCodeUnitVersion(params: {
    id: string;
    unitId: string;
    versionNo: number;
    changeType: 'created' | 'modified' | 'deleted';
    diffText: string | null;
    toolEventId: string;
    promptId: string | null;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO code_unit_versions (id, unit_id, version_no, change_type, diff_text, tool_event_id, prompt_id, created_at)
         VALUES (@id, @unitId, @versionNo, @changeType, @diffText, @toolEventId, @promptId, @createdAt)`
      )
      .run(params);
  }

  // --- code_unit_edges --------------------------------------------------
  // project_id로도 스코프한다 — 서로 다른 프로젝트가 같은 상대경로+유닛명을 가질 수 있어
  // (예: 둘 다 src/App.tsx의 App), 이걸 빼면 엣지가 다른 프로젝트의 유닛을 잘못 가리킬 수 있다.
  findUnitId(projectId: string, filePath: string, unitName: string): string | undefined {
    const row = this.db
      .prepare(`SELECT id FROM code_units WHERE project_id = ? AND file_path = ? AND unit_name = ?`)
      .get(projectId, filePath, unitName) as { id: string } | undefined;
    return row?.id;
  }

  // code_unit_edges는 "현재 상태" 스냅샷이라(SPEC 4.2), 파일을 재파싱할 때마다 그 파일 소속
  // 유닛이 from인 기존 엣지를 전부 지우고 새로 추출한 것만 다시 넣는다. 삭제된 유닛(과거에는
  // 있었지만 지금은 code_unit_versions에서 deleted 처리된 것)의 엣지도 여기서 함께 정리된다.
  // findUnitId와 같은 이유로 project_id 스코프 필수 — 다른 프로젝트가 같은 상대경로를 가지면
  // (예: 둘 다 src/App.tsx) 그 프로젝트의 엣지까지 지워버린다.
  deleteEdgesFromFile(projectId: string, filePath: string): void {
    this.db
      .prepare(
        `DELETE FROM code_unit_edges WHERE from_unit_id IN (SELECT id FROM code_units WHERE project_id = ? AND file_path = ?)`
      )
      .run(projectId, filePath);
  }

  insertEdge(params: { fromUnitId: string; toUnitId: string; edgeType: 'imports' | 'calls' | 'renders' }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO code_unit_edges (from_unit_id, to_unit_id, edge_type) VALUES (@fromUnitId, @toUnitId, @edgeType)`
      )
      .run(params);
  }

  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
