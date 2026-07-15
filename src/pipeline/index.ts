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
import { extractUnits, type UnitLike } from './ast-diff/unit-extractor.js';
import { matchUnits, type UnitChange } from './ast-diff/unit-matcher.js';
import { extractEdges, type EdgeCandidate } from './ast-diff/edge-extractor.js';
import { configureCtags, isCtagsCandidate, extractWithCtags } from './ast-diff/ctags-extractor.js';
import { computeUnitId } from './ast-diff/unit-id.js';
import type { PipelineConfig, PipelineHandle, TranscriptEvent } from '../shared/types.js';

const SESSION_FILE_POLL_MS = 2000;
// 빠른 연속 Edit을 배칭하기 위한 디바운스 — 매 Edit마다 파싱하면 의미 없는 중간 modified
// 버전이 난립한다. tool_events 기록/캐시 치환은 디바운스 없이 즉시 처리하고, AST 파싱만 늦춘다.
const AST_DIFF_DEBOUNCE_MS = 500;
// chokidar가 에이전트 자신의 Edit/Write로 인한 디스크 변화까지 "수동 수정"으로 잡지 않도록
// 직전에 에이전트가 같은 파일을 건드렸으면 이 시간 동안은 manual-watch 콜백을 무시한다.
const MANUAL_EDIT_DEDUP_WINDOW_MS = 2000;
// Stop 훅 폴백(completeIdlePrompts)이 "유휴"로 볼 시간. caption-worker.ts의
// STEP_IDLE_GAP_MS(90초, 강의노트용 스텝 묶기 기준)와는 목적이 달라 일부러 분리한다 —
// 그쪽은 백그라운드 캡션 생성이라 늦어도 체감이 없지만, 이건 사용자가 보고 있는 로딩
// 스피너라 90초는 너무 길다. repo.completeIdlePrompts의 pending tool_event 가드 덕분에
// 오래 걸리는 도구 실행 중엔 절대 오판하지 않고, 설령 판단이 틀려도(에이전트가 실제로는
// 계속 생각 중이었던 경우) 새 tool_use가 오는 순간 reopenPrompt로 즉시 되돌리므로 짧게
// 잡아도 안전하다.
const FALLBACK_IDLE_GAP_MS = 20_000;
// 위 유휴 임계값을 체감 지연 없이 잡아내기 위한 체크 주기.
const IDLE_COMPLETION_CHECK_MS = 5_000;

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
  configureCtags(config.assets.ctagsBinaryPath);
  const db = initDb(config.dbPath, config.assets.schemaPath);
  const repo = new Repo(db);
  const snapshotCache = new SnapshotCache();
  const planTracker = new PlanTracker();

  // JSONL의 세션 id(파일명, "원본 id") → sessions 테이블에 실제로 쓰는 id("논리 id")
  // 매핑. 평소엔 1:1이지만, 같은 원본 id가 이미 ended_at 처리된 뒤(= "완료"를 누르고
  // 같은 터미널에서 "시작하기"로 재개한 경우) 다시 관찰되면 새 논리 id를 발급한다 —
  // 그래야 이미 강의노트가 있는 세션 행을 재사용하지 않고 재개 이후 내용이 새 세션으로
  // 잡혀 강의노트 자동 합성이 다시 걸린다(resolveLogicalSessionId 참조).
  const logicalSessionIdByRawId = new Map<string, string>();
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

  // rawId(JSONL 파일명 = Claude Code 세션 UUID)를 논리 세션 id로 변환한다. 처음 보는
  // rawId면 그대로 사용(흔한 경우), 이미 종료 처리된 세션이면 재개로 판단해 새 id를
  // 발급하고 새 sessions 행을 만든다. 같은 rawId에 대해 이 pipeline 인스턴스 수명 동안
  // 한 번만 DB를 조회하고(Map으로 캐시), 이후엔 캐시된 값을 즉시 반환한다.
  function resolveLogicalSessionId(rawId: string, timestamp: string): string {
    const cached = logicalSessionIdByRawId.get(rawId);
    if (cached) return cached;

    const existing = repo.getSession(rawId);
    const isResume = existing !== undefined && existing.ended_at !== null;
    const logicalId = isResume ? `${rawId}#${randomUUID()}` : rawId;

    logicalSessionIdByRawId.set(rawId, logicalId);
    repo.ensureSession(logicalId, config.projectId, config.projectPath, timestamp);
    // Electron main이 "완료" 버튼에 넘길 세션 id를 이 논리 id로 추적할 수 있게 알려준다
    // (SPEC 4.6 IPC push와 같은 목적 — session-file-changed는 파일명 기반이라 재개
    // 시나리오에서 실제로 쓰이는 논리 id와 다를 수 있다).
    emitter.emit('session-resolved', logicalId);
    return logicalId;
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

  // tree-sitter 경로(JS/TS/TSX)와 ctags 경로(그 외 언어, SPEC 7 확장) 둘 다 결과를
  // UnitLike[]/UnitChange[]/EdgeCandidate[]로 맞춰 내놓으므로, DB에 반영하는 로직은
  // 공통으로 하나만 둔다 — 두 경로의 차이(grammar 유무, calls/renders 엣지 유무)는
  // 여기 도달하기 전에 이미 흡수되어 있다.
  function persistUnitsAndEdges(
    filePath: string,
    beforeUnits: UnitLike[],
    afterUnits: UnitLike[],
    changes: UnitChange[],
    edges: EdgeCandidate[],
    toolEventId: string,
    promptId: string | null,
    timestamp: string
  ) {
    repo.runInTransaction(() => {
      // code_unit_edges/code_unit_versions는 모두 code_units에 FK로 걸려있다(foreign_keys=ON).
      // edges는 afterUnits 전체(변경 안 된 유닛 포함)를 from/to로 참조할 수 있으므로, "changes에
      // 있는 유닛만" upsert하면 안 건드린 유닛을 참조하는 edge insert에서 FK 위반이 나 트랜잭션
      // 전체가 롤백된다(실제로 재현·확인된 버그) — 이 파일에 현재/직전에 존재했던 유닛 전부를
      // 먼저 upsert해 code_units row를 보장한다.
      const allKnownUnits = new Map<string, UnitLike>();
      for (const unit of beforeUnits) allKnownUnits.set(unit.unitName, unit);
      for (const unit of afterUnits) allKnownUnits.set(unit.unitName, unit); // 존재하면 최신 정보로 덮어씀
      for (const unit of allKnownUnits.values()) {
        const unitId = computeUnitId(config.projectId, filePath, unit.unitName);
        repo.upsertCodeUnit({
          id: unitId,
          projectId: config.projectId,
          filePath,
          unitName: unit.unitName,
          unitType: unit.unitType,
          timestamp
        });
      }

      for (const change of changes) {
        const unitId = computeUnitId(config.projectId, filePath, change.unitName);
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
      repo.deleteEdgesFromFile(config.projectId, filePath);
      for (const edge of edges) {
        const fromUnitId = computeUnitId(config.projectId, filePath, edge.fromUnitName);
        const toUnitId = repo.findUnitId(config.projectId, edge.toFilePath, edge.toUnitName);
        if (!toUnitId) continue; // 대상 유닛이 아직 관찰되지 않음 — 스킵(SPEC 4.2)
        repo.insertEdge({ fromUnitId, toUnitId, edgeType: edge.edgeType });
      }
    });

    // 구조도/타임라인이 이 커밋을 즉시 반영할 수 있도록 신호를 보낸다(SPEC 4.6 IPC push).
    emitter.emit('code-units-changed');
  }

  async function runAstDiff(
    filePath: string,
    before: string,
    after: string,
    toolEventId: string,
    promptId: string | null,
    timestamp: string
  ) {
    if (langForFilePath(filePath)) {
      const [beforeParsed, afterParsed] = await Promise.all([parseSource(filePath, before), parseSource(filePath, after)]);
      if (!beforeParsed || !afterParsed) return;

      const beforeUnits = extractUnits(beforeParsed);
      const afterUnits = extractUnits(afterParsed);
      const changes = matchUnits(beforeUnits, afterUnits);
      // edges는 "현재 상태" 스냅샷이라(SPEC 4.2) unit 본문 텍스트 변화가 없어도 다시 계산할 가치가
      // 있다(예: 본문은 그대로인데 새 import가 추가돼 이전엔 미해석이던 참조가 풀리는 경우, 혹은
      // 반대로 참조가 제거돼 기존 엣지가 stale해지는 경우) — changes.length가 0이어도 항상 실행한다.
      const edges = extractEdges(afterParsed, filePath, afterUnits, config.projectPath);
      persistUnitsAndEdges(filePath, beforeUnits, afterUnits, changes, edges, toolEventId, promptId, timestamp);
      return;
    }

    if (!isCtagsCandidate(filePath)) return; // 코드로 보기 어려운 확장자(설정/문서/자산 등) — 스킵

    // ctags 경로: tree-sitter grammar가 없는 언어 전부(Go/Java/... — SPEC 7 확장, Python은
    // tree-sitter 경로로 이관됨). 정의(함수/클래스)만 나오고 엣지는 없다(참조/호출 해석
    // 불가 — ctags-extractor.ts 상단 주석 참조).
    const [beforeCtags, afterCtags] = await Promise.all([
      extractWithCtags(filePath, before),
      extractWithCtags(filePath, after),
    ]);
    const changes = matchUnits(beforeCtags.units, afterCtags.units);
    persistUnitsAndEdges(
      filePath,
      beforeCtags.units,
      afterCtags.units,
      changes,
      afterCtags.edges,
      toolEventId,
      promptId,
      timestamp
    );
  }

  async function handleTranscriptEvent(event: TranscriptEvent) {
    // event.sessionId는 JSONL의 "원본" 세션 id — 재개 시나리오를 감지해 실제로 DB에
    // 쓰는 "논리" 세션 id로 변환한다. 아래는 전부 이 논리 id 기준으로 동작한다.
    const sessionId = resolveLogicalSessionId(event.sessionId, event.timestamp);
    mostRecentSessionId = sessionId;

    switch (event.kind) {
      case 'prompt': {
        const turnIndex = (turnIndexBySession.get(sessionId) ?? -1) + 1;
        turnIndexBySession.set(sessionId, turnIndex);
        // event.uuid는 JSONL 라인 자체에서 결정론적으로 파생된 값(transcript-parser.ts) —
        // randomUUID()를 쓰면 세션을 다시 리플레이할 때마다 prompt id가 달라져 중복 행이 쌓인다.
        const promptId = event.uuid;
        currentPromptIdBySession.set(sessionId, promptId);
        repo.insertPrompt({
          id: promptId,
          sessionId,
          turnIndex,
          userText: event.userText,
          createdAt: event.timestamp,
        });
        planTracker.startTurn(sessionId);
        break;
      }

      case 'tool_use': {
        const promptId = currentPromptIdBySession.get(sessionId) ?? null;
        // completeIdlePrompts 폴백이 유휴로 오판해 이 프롬프트를 이미 "완료"로 찍었을 수
        // 있다 — 그런데 지금 새 tool_use가 왔다는 건 에이전트가 실제로는 계속 작업 중이었다는
        // 뜻이므로, 완료 표시를 되돌린다. 이 이벤트 자체가 이미 'transcript-event'로
        // broadcastDataChanged('trace')를 걸어 렌더러가 다시 조회하므로 별도 emit은 불필요.
        if (promptId) repo.reopenPrompt(promptId);
        repo.insertToolEvent({
          id: event.toolUseId,
          sessionId,
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
        // Edit/Write는 tool_result(성공 확인)를 기다리지 않고 지금 바로 dedup 타임스탬프를
        // 남긴다. 실제 디스크 쓰기는 이 tool_use 로그 다음에 일어나므로, 여기서 찍어두면
        // manual-watch의 chokidar가 그 디스크 변화를 감지하는 시점(awaitWriteFinish
        // stabilityThreshold 300ms 포함)보다 반드시 먼저다 — tool_result 시점까지 기다리면
        // (우리 자신의 JSONL tail 폴링 지연 때문에) chokidar가 먼저 감지해버려 매 agent
        // Edit/Write가 "수동 수정"으로 중복 기록되는 레이스가 실제로 있었다.
        if ((event.toolName === 'Edit' || event.toolName === 'Write') && event.filePath) {
          lastAgentEditAtByFile.set(event.filePath, Date.now());
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

        const promptIdForVersion = currentPromptIdBySession.get(sessionId) ?? null;
        const timestamp = event.timestamp;
        lastAgentEditAtByFile.set(filePath, Date.now());
        scheduleAstDiff(filePath, before, event.toolUseId, promptIdForVersion, timestamp);
        break;
      }

      case 'assistant_text': {
        const promptId = currentPromptIdBySession.get(sessionId) ?? null;

        const planCandidate = planTracker.considerAssistantText(sessionId, event.text);
        if (planCandidate !== null && promptId) repo.stagePendingPlanSourceText(promptId, planCandidate);

        // 턴의 첫 텍스트만 남기는 plan_text 폴백과 달리, 실시간 진행 로그는 텍스트
        // 조각 전부를 참고 텍스트로 쓸 수 있어야 해서 전부 보존한다. 같은 timestamp에
        // 여러 text 블록이 나올 수 있어(transcript-parser.ts) 텍스트 해시를 id에
        // 섞어 충돌을 피한다.
        const noteHash = createHash('sha1').update(event.text).digest('hex').slice(0, 12);
        repo.insertAssistantNote({
          id: `${sessionId}:${event.timestamp}:${noteHash}`,
          sessionId,
          promptId,
          text: event.text,
          createdAt: event.timestamp
        });
        break;
      }

      case 'todo_write': {
        const planText = planTracker.considerTodoWrite(sessionId, event.todos);
        const promptId = currentPromptIdBySession.get(sessionId);
        if (promptId) repo.updatePromptPlanText(promptId, planText);
        break;
      }
    }
  }

  let currentFile: string | null = null;
  let currentTailer: FileTailer | null = null;
  let stopped = false;

  function attachTo(filePath: string, skipExisting: boolean) {
    currentTailer?.stop();
    currentFile = filePath;
    // startAtEnd(관찰 시작 이전 내용은 스킵)는 이 파이프라인 인스턴스의 "첫 attach"에만
    // 적용한다 — 그 뒤로 checkForNewerSession이 새 세션 파일을 발견해 attachTo를 다시
    // 부르는 경우(사용자가 관찰 도중 새 대화를 시작함)는 그 세션 전체가 "관찰 시작 이후"
    // 생긴 것이라 스킵할 과거가 없다. 여기서도 매번 startAtEnd를 쓰면, 새 세션 파일이
    // 폴링 주기(SESSION_FILE_POLL_MS, 2초) 안에 이미 첫 prompt 줄까지 쓰인 뒤에야
    // 감지되는 흔한 경우, 그 첫 줄(=currentPromptIdBySession을 채우는 유일한 계기)을
    // 통째로 건너뛰어 그 세션의 모든 tool_use가 promptId 없는 고아 이벤트로 영원히
    // 남는 버그가 있었다(실제로 재현됨: prompts 테이블은 텅 빈 채로 tool_events만 계속
    // 쌓여 "현재 프롬프트" 카드가 영원히 "첫 작업을 기다리는 중"으로 멈춰 있었음).
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
      { startAtEnd: skipExisting, onError: (err) => emitter.emit('error', err) }
    );
    emitter.emit('session-file-changed', filePath);
  }

  function checkForNewerSession() {
    // setInterval 콜백 안에서 예외가 나면(디렉토리 스캔 권한 문제 등) Node가 처리 안 된
    // 예외로 프로세스를 죽일 수 있다 — 여기서 흡수해 다음 polling도 계속 돌게 한다.
    try {
      const latest = findLatestSessionFile(projectDir);
      if (latest && latest !== currentFile) {
        // 여기서 새로 발견되는 세션 파일은 관찰이 이미 시작된 뒤에 생긴 파일이다 — 그 안의
        // 모든 내용(첫 프롬프트 포함)이 관찰 대상이어야 하므로 절대 skipExisting을 켜면 안
        // 된다. 예전엔 이 경로도 config.startAtEnd(true)를 그대로 물려받아서, checkForNewerSession의
        // 2초 폴링 지연 동안 세션이 이미 첫 프롬프트+tool_use 몇 개를 다 써버린 뒤에야 우리가
        // attach하면 그 시점의 파일 크기를 "이미 지나간 내용"으로 착각해 스킵해버렸다 — 실제로
        // 겪은 버그: 첫 prompt 이벤트만 유실되고(prompt_id가 영영 안 잡힘) 그 프롬프트의
        // tool_use/tool_result는 이미 파일에 남아있던 나머지가 새로 도착하는 것처럼 잡혀
        // orphan(수동 수정 취급)으로 떨어졌다.
        attachTo(latest, false);
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  }

  // installHooks와 같은 이유로 setImmediate: attachTo가 여기서 바로 실행되면
  // 'session-file-changed'가 startPipeline()이 핸들을 반환하기도 전에 동기적으로 emit돼,
  // 호출자가 handle.on('session-file-changed', ...)을 붙이기 전에 첫 이벤트를 놓친다
  // (실제로 겪은 버그: Electron main이 그 이벤트로 현재 session id를 추적하는데 항상 null이었음).
  // 이 최초 파일은 관찰을 켜기 *이전부터* 있던 세션일 수 있으므로(사용자가 "시작하기"를
  // 누르기 전부터 대화 중이었을 경우), 그 경우에 한해 config.startAtEnd로 과거 내용을 스킵한다.
  const initial = findLatestSessionFile(projectDir);
  if (initial) setImmediate(() => attachTo(initial, config.startAtEnd ?? false));

  const sessionCheckTimer = setInterval(checkForNewerSession, SESSION_FILE_POLL_MS);

  // Stop 훅 폴백(repo.completeIdlePrompts 주석 참조): 훅이 이 세션에 적용 안 됐을 수 있으므로
  // 주기적으로 "완료로 볼 조건"을 직접 확인해 completed_at을 채운다. Stop 훅이 정상적으로 온
  // 세션은 이미 completed_at이 채워져 있어 여기서 매치되는 행이 없으므로 중복 처리 걱정은 없다.
  function checkIdleCompletion() {
    try {
      const idleCutoff = new Date(Date.now() - FALLBACK_IDLE_GAP_MS).toISOString();
      const changed = repo.completeIdlePrompts(idleCutoff);
      if (changed > 0) emitter.emit('turn-completed');
    } catch (err) {
      emitter.emit('error', err);
    }
  }
  const idleCompletionTimer = setInterval(checkIdleCompletion, IDLE_COMPLETION_CHECK_MS);

  // SessionStart/SessionEnd 훅이 남기는 마커 tail. sessions.started_at/ended_at을
  // 훅이 주는 권위 있는 시각으로 기록한다(ended_at은 Person B의 강의노트 합성 트리거 신호).
  // marker.sessionId도 transcript-event와 동일한 "원본" id라 resolveLogicalSessionId를
  // 그대로 통과시킨다 — 재개된 세션이면 transcript-event 쪽에서 이미 만든 논리 id를
  // 그대로 재사용하고(캐시 hit), 재개가 아니면 원본 id를 그대로 쓴다(기존 동작과 동일).
  const sessionEventsTailer = tailSessionEvents(
    config.projectPath,
    (marker) => {
      const sessionId = resolveLogicalSessionId(marker.sessionId, marker.ts);
      if (marker.type === 'start') {
        repo.setSessionStartedAt(sessionId, marker.ts);
        emitter.emit('session-updated');
      } else if (marker.type === 'end') {
        repo.setSessionEndedAt(sessionId, marker.ts);
        emitter.emit('session-updated');
      } else {
        // Stop 훅(매 턴 종료): 에이전트 작업이 실제로 끝난 시각 — 이 세션의 미완료
        // 프롬프트를 완료 처리해 UI의 진행중 스피너/진행바가 즉시 멈추게 한다.
        const changed = repo.completePromptsThrough(sessionId, marker.ts);
        if (changed > 0) emitter.emit('turn-completed');
      }
    },
    (err) => emitter.emit('error', err)
  );

  // 에이전트가 아닌 수동 파일 생성/수정/삭제 감지 (SPEC 4.1 fallback).
  // syncFromDisk는 파일이 없으면(unlink) 캐시 항목을 지우고 get()이 ''을 돌려주므로,
  // add(before='' → after=내용)/change/unlink(before=내용 → after='') 세 경우 모두
  // 이 한 로직으로 처리된다 — unlink는 matchUnits에서 자연스럽게 "모든 유닛 삭제"로 잡힌다.
  const manualWatcher = watchManualEdits(
    config.projectPath,
    (filePath) => {
      const lastAgentEditAt = lastAgentEditAtByFile.get(filePath);
      return lastAgentEditAt !== undefined && Date.now() - lastAgentEditAt < MANUAL_EDIT_DEDUP_WINDOW_MS;
    },
    (filePath, kind, isBulk) => {
      const before = snapshotCache.get(filePath);
      snapshotCache.syncFromDisk(filePath);
      const after = snapshotCache.get(filePath);
      if (before === after) return; // 실제 내용 변화 없음(touch 등) — 스킵

      if (isBulk) {
        // git checkout/브랜치 전환 등 대량 변경 — 캐시는 위에서 이미 동기화됐으니
        // 여기서 끝낸다. 개별 파일마다 "수동 수정" tool_event/AST diff를 만들면
        // 사용자가 직접 타이핑한 것처럼 트레이스가 오염되고 파싱 비용도 크다.
        return;
      }

      const toolEventId = randomUUID();
      const timestamp = new Date().toISOString();
      repo.insertToolEvent({
        id: toolEventId,
        sessionId: mostRecentSessionId,
        promptId: null, // 수동 수정은 특정 turn에 속하지 않는다
        toolName: kind === 'add' ? 'ManualCreate' : kind === 'unlink' ? 'ManualDelete' : 'ManualEdit',
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
    async stop() {
      if (stopped) return;
      stopped = true;
      currentTailer?.stop();
      sessionEventsTailer.stop();
      manualWatcher.stop();
      clearInterval(sessionCheckTimer);
      clearInterval(idleCompletionTimer);
      // 대기 중인 디바운스 diff는 버리지 않고 즉시 플러시해 큐에 넣는다 — 예전엔 타이머만
      // 취소해서 종료 직전 500ms 이내의 마지막 Edit 배치가 유실됐다(알려진 한계였음).
      for (const filePath of [...pendingDiffByFile.keys()]) {
        const pending = pendingDiffByFile.get(filePath);
        if (pending) clearTimeout(pending.timer);
        flushPendingDiff(filePath);
      }
      // 진행/대기 중인 AST diff(비동기 파싱 → DB 기록)가 전부 끝난 뒤에 커넥션을 닫는다.
      // 예전엔 동기적으로 바로 close해서, parseSource를 await하던 작업이 재개될 때
      // "Database is closed"로 죽고 종료 직전 변경 내역이 통째로 유실되는 레이스가 있었다.
      await Promise.allSettled([...astDiffQueueByFile.values()]);
      db.close();
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
    },
    markSessionEnded(sessionId: string) {
      if (stopped) return; // stop() 이후엔 커넥션이 닫혀 있다 — 호출 순서 실수로 죽지 않게 방어
      // SessionEnd 훅과 동일하게 처리하되, 트리거 주체가 훅이 아니라 UI의 명시적 사용자 액션이다.
      repo.setSessionEndedAt(sessionId, new Date().toISOString());
    },
  } as PipelineHandle;
}
