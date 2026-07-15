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

  // 훅 마커(SessionStart/Stop/SessionEnd)를 하나라도 관찰한 세션 표시 — 이 세션은 턴 완료가
  // Stop 훅으로 즉시 오므로, completeIdlePrompts의 "유휴 = 완료" 추측을 보수적(긴 컷오프)으로만
  // 적용한다. 호출 시점엔 행이 항상 존재한다 — 마커 처리도 resolveLogicalSessionId를 먼저
  // 통과하는데 그 안의 ensureSession이 행을 만든다(pipeline/index.ts).
  markSessionHooksAlive(id: string): void {
    this.db.prepare(`UPDATE sessions SET hooks_alive = 1 WHERE id = @id AND hooks_alive = 0`).run({ id });
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

  // 화면에 보여줄 실제(완성된) 계획을 확정한다 — TodoWrite 경로가 직접 호출한다.
  // 뒤늦게 도착할 수 있는 plan-worker의 AI 변환 결과가 이미 확정된 이 값을 덮어쓰지
  // 않도록 pending_plan_source_text도 함께 비운다(Repo.stagePendingPlanSourceText 참조).
  updatePromptPlanText(promptId: string, planText: string): void {
    this.db
      .prepare(
        `UPDATE prompts SET plan_text = @planText, pending_plan_source_text = NULL WHERE id = @promptId`
      )
      .run({ promptId, planText });
  }

  // TodoWrite 없이 남은 턴의 첫 assistant 텍스트(의도 선언문)를 곧장 "계획"으로 쓰지
  // 않고 일단 대기시킨다 — plan-worker(caption-worker.ts)가 이걸 실제 단계별 계획으로
  // 정리한 뒤에야 plan_text가 채워진다. TodoWrite가 이미 도착해 plan_text가 차 있으면
  // 건드리지 않는다(TodoWrite가 항상 우선).
  stagePendingPlanSourceText(promptId: string, text: string): void {
    this.db
      .prepare(
        `UPDATE prompts SET pending_plan_source_text = @text WHERE id = @promptId AND plan_text IS NULL`
      )
      .run({ promptId, text });
  }

  // Stop 훅(턴 종료) 마커 수신 시: 이 세션에서 마커 시각 이전에 시작됐고 아직 완료
  // 표시가 없는 프롬프트를 전부 완료 처리한다. "현재 프롬프트 하나"만 찍지 않는 이유:
  // 두 tail(transcript / session-events)의 도착 순서가 엄밀히 보장되지 않아, 마커가
  // 늦게 도착했을 때 이미 다음 턴이 시작돼 있을 수 있다 — created_at <= 마커 시각
  // 조건이면 그 새 턴을 잘못 완료 처리하지 않으면서 이전 턴들은 전부 안전하게 닫힌다.
  // 반환값은 실제로 갱신된 행 수(0이면 호출자가 UI push를 생략해도 된다).
  completePromptsThrough(sessionId: string, ts: string): number {
    const result = this.db
      .prepare(
        `UPDATE prompts SET completed_at = @ts
         WHERE session_id = @sessionId AND completed_at IS NULL AND created_at <= @ts`
      )
      .run({ sessionId, ts });
    return result.changes;
  }

  // Stop 훅 폴백: Claude Code는 훅 설정을 CLI 세션 시작 시점에 한 번만 읽으므로, 사용자가
  // "시작하기"를 누르기 전부터 이미 열려있던 세션은 installHooks가 나중에 settings.json을
  // 갱신해도 그 세션엔 절대 적용되지 않는다 — Stop 훅이 영원히 안 와서 completed_at이
  // 안 채워지고, UI의 진행중 스피너가 코드 작업이 끝난 뒤에도 영원히 안 멈추는 실제 버그였다.
  // caption-worker.ts의 getNextCompletedTurn과 같은 "완료로 볼 조건"(다음 턴 시작/세션 종료/
  // 유휴시간 초과)이지만, 그쪽은 캡션 생성 후보 선정에만 쓰고 completed_at 자체는 안 건드려서
  // 이 문제를 못 풀었다 — 여기서는 실제로 컬럼을 채워 turn-completed 이벤트가 걸리게 한다.
  // 유휴시간 조건에만(다음 턴 시작/세션 종료는 그 자체로 확실한 신호라 예외) 오판 가드를 건다:
  // - pending tool_event가 없어야 한다 — tool_events.created_at은 도구를 "호출한" 시각이라
  //   tool_result 완료 시각을 반영하지 못하므로, 이 가드가 없으면 빌드/테스트처럼 오래 걸리는
  //   도구가 아직 실행 중인데도 유휴로 오판해 "완료"로 잘못 찍을 수 있다.
  // - "마지막 활동"에 assistant_notes도 포함한다 — 에이전트가 도구 없이 텍스트/서술만 이어가는
  //   구간을 유휴로 오판하지 않도록.
  // - 이 턴에서 관찰된 활동(tool_event 또는 note)이 하나라도 있어야 한다 — 턴 시작 직후 긴
  //   thinking 구간(아무것도 아직 안 나옴)을 prompts.created_at + 유휴시간만으로 완료 처리하면
  //   진행바가 시작하자마자 100%로 튀었다가 첫 tool_use의 reopenPrompt로 되돌아오는 플리커가
  //   실제로 났다. 아무 활동도 없이 끝나는 턴은 다음 턴 시작/세션 종료 조건이 결국 닫아준다.
  // - 훅 마커를 관찰한 세션(hooks_alive)은 Stop 훅이 완료를 즉시 찍어주므로, 추측 폴백은
  //   훨씬 긴 컷오프(@hookedIdleCutoff, Stop 마커 유실 대비 안전망)로만 적용한다.
  completeIdlePrompts(idleCutoffIso: string, hookedIdleCutoffIso: string): number {
    const result = this.db
      .prepare(
        `UPDATE prompts
         SET completed_at = MAX(
           prompts.created_at,
           COALESCE((SELECT MAX(te.created_at) FROM tool_events te WHERE te.prompt_id = prompts.id), ''),
           COALESCE((SELECT MAX(an.created_at) FROM assistant_notes an WHERE an.prompt_id = prompts.id), '')
         )
         WHERE completed_at IS NULL
           AND (
             EXISTS (SELECT 1 FROM prompts nxt WHERE nxt.session_id = prompts.session_id AND nxt.turn_index > prompts.turn_index)
             OR EXISTS (SELECT 1 FROM sessions s WHERE s.id = prompts.session_id AND s.ended_at IS NOT NULL)
             OR (
                  (
                    EXISTS (SELECT 1 FROM tool_events te WHERE te.prompt_id = prompts.id)
                    OR EXISTS (SELECT 1 FROM assistant_notes an WHERE an.prompt_id = prompts.id)
                  )
                  AND MAX(
                    prompts.created_at,
                    COALESCE((SELECT MAX(te.created_at) FROM tool_events te WHERE te.prompt_id = prompts.id), ''),
                    COALESCE((SELECT MAX(an.created_at) FROM assistant_notes an WHERE an.prompt_id = prompts.id), '')
                  ) <= CASE
                    WHEN EXISTS (SELECT 1 FROM sessions s WHERE s.id = prompts.session_id AND s.hooks_alive = 1)
                    THEN @hookedIdleCutoff
                    ELSE @idleCutoff
                  END
                  AND NOT EXISTS (
                    SELECT 1 FROM tool_events te WHERE te.prompt_id = prompts.id AND te.status = 'pending'
                  )
                )
           )`
      )
      .run({ idleCutoff: idleCutoffIso, hookedIdleCutoff: hookedIdleCutoffIso });
    return result.changes;
  }

  // completeIdlePrompts는 어디까지나 추측(유휴시간)이라 틀릴 수 있다 — 유휴 판정 이후에도
  // 에이전트가 실제로는 아직 살아있어서 새 tool_use가 들어오면, 잘못 찍은 완료를 되돌려
  // UI 스피너가 다시 진행중으로 돌아가게 한다. 실제 Stop 훅으로 완료된 턴엔 그 다음부터
  // 새 tool_use가 절대 오지 않으므로(다음 사용자 턴은 새 prompt_id를 받음) 이 호출 자체가
  // 실질적으로 fallback 오판이 있었던 경우에만 일어난다.
  reopenPrompt(promptId: string): boolean {
    const result = this.db
      .prepare(`UPDATE prompts SET completed_at = NULL WHERE id = @promptId AND completed_at IS NOT NULL`)
      .run({ promptId });
    return result.changes > 0;
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
