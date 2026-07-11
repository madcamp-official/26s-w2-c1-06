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
  ensureSession(id: string, projectPath: string, startedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_path, started_at, ended_at)
         VALUES (@id, @projectPath, @startedAt, NULL)
         ON CONFLICT(id) DO NOTHING`
      )
      .run({ id, projectPath, startedAt });
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

  updateToolEventResult(toolUseId: string, status: 'success' | 'error', durationMs: number): void {
    this.db
      .prepare(`UPDATE tool_events SET status = @status, duration_ms = @durationMs WHERE id = @toolUseId`)
      .run({ toolUseId, status, durationMs });
  }

  getToolEvent(toolUseId: string): { tool_name: string; file_path: string | null; raw_payload: string; created_at: string } | undefined {
    return this.db
      .prepare(`SELECT tool_name, file_path, raw_payload, created_at FROM tool_events WHERE id = ?`)
      .get(toolUseId) as never;
  }

  // --- code_units / code_unit_versions --------------------------------------
  upsertCodeUnit(params: { id: string; filePath: string; unitName: string; unitType: string; timestamp: string }): void {
    this.db
      .prepare(
        `INSERT INTO code_units (id, file_path, unit_name, unit_type, first_seen_at, last_seen_at)
         VALUES (@id, @filePath, @unitName, @unitType, @timestamp, @timestamp)
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
  findUnitId(filePath: string, unitName: string): string | undefined {
    const row = this.db.prepare(`SELECT id FROM code_units WHERE file_path = ? AND unit_name = ?`).get(filePath, unitName) as
      | { id: string }
      | undefined;
    return row?.id;
  }

  // code_unit_edges는 "현재 상태" 스냅샷이라(SPEC 4.2), 파일을 재파싱할 때마다 그 파일 소속
  // 유닛이 from인 기존 엣지를 전부 지우고 새로 추출한 것만 다시 넣는다. 삭제된 유닛(과거에는
  // 있었지만 지금은 code_unit_versions에서 deleted 처리된 것)의 엣지도 여기서 함께 정리된다.
  deleteEdgesFromFile(filePath: string): void {
    this.db
      .prepare(
        `DELETE FROM code_unit_edges WHERE from_unit_id IN (SELECT id FROM code_units WHERE file_path = ?)`
      )
      .run(filePath);
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
