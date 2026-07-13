import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { getClaudeProjectDir, findLatestSessionFile } from './observation/session-locator.js';
import { tailFile, type FileTailer } from './observation/jsonl-tail.js';
import { parseTranscriptLine, extractResultText } from './observation/transcript-parser.js';
import { SnapshotCache } from './observation/snapshot-cache.js';
import { PlanTracker } from './observation/plan-extractor.js';
import { installHooks } from './observation/hook-installer.js';
import { tailSessionEvents } from './observation/session-events-tail.js';
import { watchManualEdits } from './observation/manual-watch.js';
import { initDb } from './db/init.js';
import { Repo } from './db/repo.js';
import { configureParser, parseSource, langForFilePath } from './ast-diff/parser.js';
import { extractUnits, type CodeUnitCandidate } from './ast-diff/unit-extractor.js';
import { matchUnits } from './ast-diff/unit-matcher.js';
import { extractEdges } from './ast-diff/edge-extractor.js';
import { computeUnitId } from './ast-diff/unit-id.js';
import type { PipelineConfig, PipelineHandle, TranscriptEvent } from '../shared/types.js';

const SESSION_FILE_POLL_MS = 2000;
// 빠른 연속 Edit을 배칭하기 위한 디바운스 — 매 Edit마다 파싱하면 의미 없는 중간 modified
// 버전이 난립한다. tool_events 기록/캐시 치환은 디바운스 없이 즉시 처리하고, AST 파싱만 늦춘다.
const AST_DIFF_DEBOUNCE_MS = 500;
// chokidar가 에이전트 자신의 Edit/Write로 인한 디스크 변화까지 "수동 수정"으로 잡지 않도록
// 직전에 에이전트가 같은 파일을 건드렸으면 이 시간 동안은 manual-watch 콜백을 무시한다.
const MANUAL_EDIT_DEDUP_WINDOW_MS = 2000;

interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

interface WriteInput {
  file_path: string;
  content: string;
}

/**
 * 라이브러리 진입점 — Node CLI(cli.ts)와 Electron main 프로세스(Day 5+, SPEC 4.6) 양쪽에서
 * 그대로 import해서 쓸 수 있어야 하므로 콘솔 출력/process 제어를 하지 않고 이벤트만 emit한다.
 */
export function startPipeline(config: PipelineConfig): PipelineHandle {
  const emitter = new EventEmitter();
  const projectDir = getClaudeProjectDir(config.projectPath);

  configureParser(config.assets);
  const db = initDb(config.dbPath, config.assets.schemaPath);
  const repo = new Repo(db);
  const snapshotCache = new SnapshotCache();
  const planTracker = new PlanTracker();

  const seenSessions = new Set<string>();
  const turnIndexBySession = new Map<string, number>();
  const currentPromptIdBySession = new Map<string, string | null>();
  // manual-watch 콜백은 특정 transcript 이벤트에 딸려오지 않으므로 "지금 관찰 중인 세션"이
  // 필요할 때 이 값을 쓴다(세션을 전혀 못 봤으면 null — tool_events.session_id는 nullable).
  let mostRecentSessionId: string | null = null;
  // chokidar가 에이전트 자신의 Edit/Write로 인한 디스크 변화를 "수동 수정"으로 다시 잡지
  // 않도록, 성공한 에이전트 Edit/Write 직후 파일별 타임스탬프를 남겨 dedup에 쓴다.
  const lastAgentEditAtByFile = new Map<string, number>();
  // 같은 파일에 대한 AST diff(비동기 파싱+DB 기록)는 파일 단위로 반드시 순차 실행해야 한다.
  // runAstDiff는 parseSource의 await 지점에서 이벤트 루프에 양보하므로, await 없이 그대로
  // fire-and-forget하면 같은 파일에 연달아 발생한 Edit들의 완료 순서가 뒤섞여
  // version_no/변경 타입이 실제 시간 순서와 어긋날 수 있다(파일별 프라미스 체인으로 직렬화).
  const astDiffQueueByFile = new Map<string, Promise<void>>();

  function enqueueAstDiff(filePath: string, task: () => Promise<void>): Promise<void> {
    const previous = astDiffQueueByFile.get(filePath) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    astDiffQueueByFile.set(filePath, next);
    return next;
  }

  // 빠른 연속 Edit 배칭: 같은 파일에 새 Edit이 오면 타이머를 리셋하고 "burst 시작 시점의
  // before"는 유지한 채 최신 toolEventId/promptId/timestamp로만 갱신 → 타이머가 마지막으로
  // 만료될 때 캐시의 "현재" 상태를 after로 삼아 diff 1회만 실행한다.
  interface PendingDiff {
    before: string;
    timer: ReturnType<typeof setTimeout>;
    toolEventId: string;
    promptId: string | null;
    timestamp: string;
  }
  const pendingDiffByFile = new Map<string, PendingDiff>();

  function scheduleAstDiff(filePath: string, before: string, toolEventId: string, promptId: string | null, timestamp: string) {
    const existing = pendingDiffByFile.get(filePath);
    if (existing) {
      clearTimeout(existing.timer);
      existing.toolEventId = toolEventId;
      existing.promptId = promptId;
      existing.timestamp = timestamp;
      existing.timer = setTimeout(() => flushPendingDiff(filePath), AST_DIFF_DEBOUNCE_MS);
    } else {
      pendingDiffByFile.set(filePath, {
        before,
        timer: setTimeout(() => flushPendingDiff(filePath), AST_DIFF_DEBOUNCE_MS),
        toolEventId,
        promptId,
        timestamp,
      });
    }
  }

  function flushPendingDiff(filePath: string) {
    const pending = pendingDiffByFile.get(filePath);
    if (!pending) return;
    pendingDiffByFile.delete(filePath);
    const after = snapshotCache.get(filePath);
    enqueueAstDiff(filePath, () =>
      runAstDiff(filePath, pending.before, after, pending.toolEventId, pending.promptId, pending.timestamp)
    ).catch((err) => emitter.emit('error', err));
  }

  function ensureSessionSeen(sessionId: string, timestamp: string) {
    if (seenSessions.has(sessionId)) return;
    seenSessions.add(sessionId);
    repo.ensureSession(sessionId, config.projectPath, timestamp);
  }

  // setImmediate로 미룬다: startPipeline()이 핸들을 반환하기 전에(=호출자가 아직 'error'
  // 리스너를 붙이기 전에) 동기적으로 emit('error', ...)가 발생하면 리스너가 없는 EventEmitter는
  // 그 에러를 그대로 throw해 프로세스를 죽인다. 호출자가 handle.on('error', ...)을 붙일 시간을 준다.
  setImmediate(() => {
    try {
      installHooks(config.projectPath, config.assets.hookScriptPath);
    } catch (err) {
      // 훅 설치 실패(권한 문제 등)가 파이프라인 전체를 멈추면 안 된다 — 나머지 관찰은 계속 동작해야 함.
      emitter.emit('error', err);
    }
  });

  async function runAstDiff(
    filePath: string,
    before: string,
    after: string,
    toolEventId: string,
    promptId: string | null,
    timestamp: string
  ) {
    if (!langForFilePath(filePath)) return; // MVP: JS/TS/TSX 외 확장자는 스킵 (SPEC 7)

    const [beforeParsed, afterParsed] = await Promise.all([parseSource(filePath, before), parseSource(filePath, after)]);
    if (!beforeParsed || !afterParsed) return;

    const beforeUnits = extractUnits(beforeParsed);
    const afterUnits = extractUnits(afterParsed);
    const changes = matchUnits(beforeUnits, afterUnits);
    // edges는 "현재 상태" 스냅샷이라(SPEC 4.2) unit 본문 텍스트 변화가 없어도 다시 계산할 가치가
    // 있다(예: 본문은 그대로인데 새 import가 추가돼 이전엔 미해석이던 참조가 풀리는 경우, 혹은
    // 반대로 참조가 제거돼 기존 엣지가 stale해지는 경우) — changes.length가 0이어도 항상 실행한다.
    const edges = extractEdges(afterParsed, filePath, afterUnits);

    repo.runInTransaction(() => {
      // code_unit_edges/code_unit_versions는 모두 code_units에 FK로 걸려있다(foreign_keys=ON).
      // edges는 afterUnits 전체(변경 안 된 유닛 포함)를 from/to로 참조할 수 있으므로, "changes에
      // 있는 유닛만" upsert하면 안 건드린 유닛을 참조하는 edge insert에서 FK 위반이 나 트랜잭션
      // 전체가 롤백된다(실제로 재현·확인된 버그) — 이 파일에 현재/직전에 존재했던 유닛 전부를
      // 먼저 upsert해 code_units row를 보장한다.
      const allKnownUnits = new Map<string, CodeUnitCandidate>();
      for (const unit of beforeUnits) allKnownUnits.set(unit.unitName, unit);
      for (const unit of afterUnits) allKnownUnits.set(unit.unitName, unit); // 존재하면 최신 정보로 덮어씀
      for (const unit of allKnownUnits.values()) {
        const unitId = computeUnitId(filePath, unit.unitName);
        repo.upsertCodeUnit({ id: unitId, filePath, unitName: unit.unitName, unitType: unit.unitType, timestamp });
      }

      for (const change of changes) {
        const unitId = computeUnitId(filePath, change.unitName);
        const versionNo = repo.getNextVersionNo(unitId);
        repo.insertCodeUnitVersion({
          // toolEventId+unitId로 결정론적 id를 구성 — 같은 tool_event가 같은 unit을 두 번 바꿀 수
          // 없으므로 유일성이 보장되고, 세션 리플레이 시 중복 삽입 없이 안전하게 재실행된다.
          id: `${toolEventId}:${unitId}`,
          unitId,
          versionNo,
          changeType: change.changeType,
          diffText: change.diffText,
          toolEventId,
          promptId,
          createdAt: timestamp,
        });
      }

      // "현재 상태" 스냅샷: 이 파일 소속 from 엣지를 전부 지우고 새로 추출한 것만 다시 넣는다.
      repo.deleteEdgesFromFile(filePath);
      for (const edge of edges) {
        const fromUnitId = computeUnitId(filePath, edge.fromUnitName);
        const toUnitId = repo.findUnitId(edge.toFilePath, edge.toUnitName);
        if (!toUnitId) continue; // 대상 유닛이 아직 관찰되지 않음 — 스킵(SPEC 4.2)
        repo.insertEdge({ fromUnitId, toUnitId, edgeType: edge.edgeType });
      }
    });
  }

  async function handleTranscriptEvent(event: TranscriptEvent) {
    ensureSessionSeen(event.sessionId, event.timestamp);
    mostRecentSessionId = event.sessionId;

    switch (event.kind) {
      case 'prompt': {
        const turnIndex = (turnIndexBySession.get(event.sessionId) ?? -1) + 1;
        turnIndexBySession.set(event.sessionId, turnIndex);
        // event.uuid는 JSONL 라인 자체에서 결정론적으로 파생된 값(transcript-parser.ts) —
        // randomUUID()를 쓰면 세션을 다시 리플레이할 때마다 prompt id가 달라져 중복 행이 쌓인다.
        const promptId = event.uuid;
        currentPromptIdBySession.set(event.sessionId, promptId);
        repo.insertPrompt({
          id: promptId,
          sessionId: event.sessionId,
          turnIndex,
          userText: event.userText,
          createdAt: event.timestamp,
        });
        planTracker.startTurn(event.sessionId);
        break;
      }

      case 'tool_use': {
        const promptId = currentPromptIdBySession.get(event.sessionId) ?? null;
        repo.insertToolEvent({
          id: event.toolUseId,
          sessionId: event.sessionId,
          promptId,
          toolName: event.toolName,
          filePath: event.filePath ?? null,
          source: 'agent',
          rawPayload: JSON.stringify(event),
          createdAt: event.timestamp,
        });
        // Read는 파일을 바꾸지 않으므로 관찰 시점에 바로 시딩해도 레이스 컨디션이 없다.
        if (event.toolName === 'Read' && event.filePath) {
          snapshotCache.seedFromDisk(event.filePath);
        }
        break;
      }

      case 'tool_result': {
        const row = repo.getToolEvent(event.toolUseId);
        if (!row) break; // 대응하는 tool_use를 관찰하지 못함(세션 파일 중간부터 tail 등) — 무시

        const status = event.isError ? 'error' : 'success';
        const durationMs = Math.max(0, Date.parse(event.timestamp) - Date.parse(row.created_at));
        const resultContent = extractResultText(event.content);
        repo.updateToolEventResult(event.toolUseId, status, durationMs, resultContent);

        if (status !== 'success') break;
        if (row.tool_name !== 'Edit' && row.tool_name !== 'Write') break;

        const original = JSON.parse(row.raw_payload) as { input: EditInput | WriteInput; filePath?: string };
        const filePath = row.file_path;
        if (!filePath) break;

        // after는 여기서 쓰지 않는다 — applyEdit/applyWrite가 캐시를 이미 갱신했고,
        // 실제 after는 디바운스 만료 시점에 flushPendingDiff가 캐시에서 다시 읽는다.
        let before: string;
        if (row.tool_name === 'Edit') {
          if (!snapshotCache.has(filePath)) {
            // 캐시 미스 폴백(설계상 드문 경로): Read 없이 첫 Edit이 온 경우 등.
            // Write에는 절대 적용하면 안 된다 — Write는 캐시 미스=신규 생성이 정상 의미이고,
            // 여기서 디스크를 읽으면 리플레이 시점의 "최종" 상태를 그 시점의 before로
            // 잘못 끌어와 버려서(과거 Write를 지금 디스크 상태와 비교) diff가 완전히 깨진다.
            snapshotCache.seedFromDisk(filePath);
          }
          const input = original.input as EditInput;
          ({ before } = snapshotCache.applyEdit(filePath, input.old_string, input.new_string, Boolean(input.replace_all)));
        } else {
          const input = original.input as WriteInput;
          ({ before } = snapshotCache.applyWrite(filePath, input.content));
        }

        const promptIdForVersion = currentPromptIdBySession.get(event.sessionId) ?? null;
        const timestamp = event.timestamp;
        lastAgentEditAtByFile.set(filePath, Date.now());
        scheduleAstDiff(filePath, before, event.toolUseId, promptIdForVersion, timestamp);
        break;
      }

      case 'assistant_text': {
        const promptId = currentPromptIdBySession.get(event.sessionId) ?? null;

        const planCandidate = planTracker.considerAssistantText(event.sessionId, event.text);
        if (planCandidate !== null && promptId) repo.updatePromptPlanText(promptId, planCandidate);

        // 턴의 첫 텍스트만 남기는 plan_text 폴백과 달리, 서사 표시용으로는
        // 텍스트 조각 전부를 보존한다. 같은 timestamp에 여러 text 블록이 나올 수
        // 있어(transcript-parser.ts) 텍스트 해시를 id에 섞어 충돌을 피한다.
        const noteHash = createHash('sha1').update(event.text).digest('hex').slice(0, 12);
        repo.insertAssistantNote({
          id: `${event.sessionId}:${event.timestamp}:${noteHash}`,
          sessionId: event.sessionId,
          promptId,
          text: event.text,
          createdAt: event.timestamp,
        });
        break;
      }

      case 'todo_write': {
        const planText = planTracker.considerTodoWrite(event.sessionId, event.todos);
        const promptId = currentPromptIdBySession.get(event.sessionId);
        if (promptId) repo.updatePromptPlanText(promptId, planText);
        break;
      }
    }
  }

  let currentFile: string | null = null;
  let currentTailer: FileTailer | null = null;
  let stopped = false;

  function attachTo(filePath: string) {
    currentTailer?.stop();
    currentFile = filePath;
    currentTailer = tailFile(
      filePath,
      (line) => {
        const events = parseTranscriptLine(line);
        for (const event of events) {
          emitter.emit('transcript-event', event);
          handleTranscriptEvent(event).catch((err) => {
            emitter.emit('error', err);
          });
        }
      },
      { onError: (err) => emitter.emit('error', err) }
    );
    emitter.emit('session-file-changed', filePath);
  }

  function checkForNewerSession() {
    // setInterval 콜백 안에서 예외가 나면(디렉토리 스캔 권한 문제 등) Node가 처리 안 된
    // 예외로 프로세스를 죽일 수 있다 — 여기서 흡수해 다음 polling도 계속 돌게 한다.
    try {
      const latest = findLatestSessionFile(projectDir);
      if (latest && latest !== currentFile) {
        attachTo(latest);
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  }

  const initial = findLatestSessionFile(projectDir);
  if (initial) attachTo(initial);

  const sessionCheckTimer = setInterval(checkForNewerSession, SESSION_FILE_POLL_MS);

  // SessionStart/SessionEnd 훅이 남기는 마커 tail. sessions.started_at/ended_at을
  // 훅이 주는 권위 있는 시각으로 기록한다(ended_at은 Person B의 강의노트 합성 트리거 신호).
  const sessionEventsTailer = tailSessionEvents(
    config.projectPath,
    (marker) => {
      if (marker.type === 'start') {
        seenSessions.add(marker.sessionId);
        repo.ensureSession(marker.sessionId, config.projectPath, marker.ts);
        repo.setSessionStartedAt(marker.sessionId, marker.ts);
      } else {
        repo.setSessionEndedAt(marker.sessionId, marker.ts);
      }
    },
    (err) => emitter.emit('error', err)
  );

  // 에이전트가 아닌 수동 파일 수정 감지 (SPEC 4.1 fallback).
  const manualWatcher = watchManualEdits(
    config.projectPath,
    (filePath) => {
      const lastAgentEditAt = lastAgentEditAtByFile.get(filePath);
      return lastAgentEditAt !== undefined && Date.now() - lastAgentEditAt < MANUAL_EDIT_DEDUP_WINDOW_MS;
    },
    (filePath) => {
      const before = snapshotCache.get(filePath);
      snapshotCache.syncFromDisk(filePath);
      const after = snapshotCache.get(filePath);
      if (before === after) return; // 실제 내용 변화 없음(touch 등) — 스킵

      const toolEventId = randomUUID();
      const timestamp = new Date().toISOString();
      repo.insertToolEvent({
        id: toolEventId,
        sessionId: mostRecentSessionId,
        promptId: null, // 수동 수정은 특정 turn에 속하지 않는다
        toolName: 'ManualEdit',
        filePath,
        source: 'manual',
        rawPayload: JSON.stringify({ before, after }),
        createdAt: timestamp,
      });
      repo.updateToolEventResult(toolEventId, 'success', 0, null);
      scheduleAstDiff(filePath, before, toolEventId, null, timestamp);
    },
    (err) => emitter.emit('error', err)
  );

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      currentTailer?.stop();
      sessionEventsTailer.stop();
      manualWatcher.stop();
      // 대기 중인 디바운스 타이머는 완료를 기다리지 않고 취소한다 — 이미 async 파싱 작업이
      // db.close() 이후까지 걸쳐 실행되는 걸 막기 위한 단순한 선택(알려진 한계: 종료 직전
      // 500ms 이내의 마지막 연속 Edit 배치 하나는 유실될 수 있음, IMPLEMENTATION_PLAN_A.md 참조).
      for (const pending of pendingDiffByFile.values()) clearTimeout(pending.timer);
      pendingDiffByFile.clear();
      clearInterval(sessionCheckTimer);
      db.close();
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
    },
    markSessionEnded(sessionId: string) {
      // SessionEnd 훅과 동일하게 처리하되, 트리거 주체가 훅이 아니라 UI의 명시적 사용자 액션이다.
      repo.setSessionEndedAt(sessionId, new Date().toISOString());
    },
  } as PipelineHandle;
}
