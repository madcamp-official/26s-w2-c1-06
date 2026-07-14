// tool_events / code_units / code_unit_versions에 목업 데이터를 채우는 시드 스크립트.
// Person A의 실제 파이프라인이 붙기 전까지 이 데이터로 UI를 개발한다.
// sessions/prompts는 tool_events의 FK(foreign_keys=ON) 무결성을 위해 최소한만 함께 채운다.
// 실행: npm run db:seed (db:init을 먼저 실행해 스키마가 있어야 함)

import { randomUUID } from 'node:crypto'
import { openDatabase } from './connection.js'
import { DEFAULT_DB_PATH } from './paths.js'

const db = openDatabase(DEFAULT_DB_PATH)

const now = Date.now()
const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString()

const projectId = randomUUID()
const sessionId = randomUUID()
const promptIds = [randomUUID(), randomUUID(), randomUUID()]
const toolEventIds = Array.from({ length: 8 }, () => randomUUID())
const codeUnitIds = {
  tracePanel: randomUUID(),
  useToolEvents: randomUUID(),
  formatDuration: randomUUID()
}

const insertProject = db.prepare(`
  INSERT INTO projects (id, name, workspace_path, created_at)
  VALUES (@id, @name, @workspace_path, @created_at)
`)

const insertSession = db.prepare(`
  INSERT INTO sessions (id, project_id, project_path, started_at, ended_at)
  VALUES (@id, @project_id, @project_path, @started_at, @ended_at)
`)

const insertPrompt = db.prepare(`
  INSERT INTO prompts (id, session_id, turn_index, user_text, plan_text, created_at)
  VALUES (@id, @session_id, @turn_index, @user_text, @plan_text, @created_at)
`)

const insertToolEvent = db.prepare(`
  INSERT INTO tool_events
    (id, session_id, prompt_id, tool_name, file_path, source, status, duration_ms, raw_payload, created_at)
  VALUES
    (@id, @session_id, @prompt_id, @tool_name, @file_path, @source, @status, @duration_ms, @raw_payload, @created_at)
`)

const insertCodeUnit = db.prepare(`
  INSERT INTO code_units (id, project_id, file_path, unit_name, unit_type, first_seen_at, last_seen_at)
  VALUES (@id, @project_id, @file_path, @unit_name, @unit_type, @first_seen_at, @last_seen_at)
`)

const insertCodeUnitVersion = db.prepare(`
  INSERT INTO code_unit_versions
    (id, unit_id, version_no, change_type, diff_text, tool_event_id, prompt_id, created_at)
  VALUES
    (@id, @unit_id, @version_no, @change_type, @diff_text, @tool_event_id, @prompt_id, @created_at)
`)

const insertCodeUnitEdge = db.prepare(`
  INSERT INTO code_unit_edges (from_unit_id, to_unit_id, edge_type)
  VALUES (@from_unit_id, @to_unit_id, @edge_type)
`)

const seed = db.transaction(() => {
  insertProject.run({
    id: projectId,
    name: 'campus-market (demo)',
    workspace_path: '/Users/demo/campus-market',
    created_at: iso(-25 * 60_000)
  })

  insertSession.run({
    id: sessionId,
    project_id: projectId,
    project_path: '/Users/demo/campus-market',
    started_at: iso(-20 * 60_000),
    ended_at: null
  })

  insertPrompt.run({
    id: promptIds[0],
    session_id: sessionId,
    turn_index: 0,
    user_text: '실시간 트레이스 패널 컴포넌트를 만들어줘',
    plan_text:
      '1. tool_events를 시간순으로 읽어오는 IPC 핸들러 작성\n2. TracePanel 컴포넌트에서 목록 렌더\n3. 상태(success/error/pending)에 따라 표시 스타일 구분',
    created_at: iso(-20 * 60_000)
  })
  insertPrompt.run({
    id: promptIds[1],
    session_id: sessionId,
    turn_index: 1,
    user_text: 'duration_ms도 같이 보여줘',
    plan_text: '1. formatDuration 유틸 함수 추가\n2. TracePanel 항목에 소요시간 표시',
    created_at: iso(-12 * 60_000)
  })
  insertPrompt.run({
    id: promptIds[2],
    session_id: sessionId,
    turn_index: 2,
    user_text: '커밋 전에 빌드 한번 확인해줘',
    plan_text: null,
    created_at: iso(-3 * 60_000)
  })

  const toolEventSeeds = [
    {
      id: toolEventIds[0],
      prompt_id: promptIds[0],
      tool_name: 'Read',
      file_path: 'src/app/renderer/src/App.tsx',
      source: 'agent',
      status: 'success',
      duration_ms: 42,
      offset: -20 * 60_000
    },
    {
      id: toolEventIds[1],
      prompt_id: promptIds[0],
      tool_name: 'Write',
      file_path: 'src/app/renderer/src/components/TracePanel.tsx',
      source: 'agent',
      status: 'success',
      duration_ms: 88,
      offset: -19 * 60_000 + 30_000
    },
    {
      id: toolEventIds[2],
      prompt_id: promptIds[0],
      tool_name: 'Edit',
      file_path: 'src/app/renderer/src/App.tsx',
      source: 'agent',
      status: 'success',
      duration_ms: 65,
      offset: -19 * 60_000
    },
    {
      id: toolEventIds[3],
      prompt_id: promptIds[0],
      tool_name: 'Bash',
      file_path: null,
      source: 'agent',
      status: 'success',
      duration_ms: 1250,
      offset: -18 * 60_000
    },
    {
      id: toolEventIds[4],
      prompt_id: promptIds[1],
      tool_name: 'Write',
      file_path: 'src/shared/format.ts',
      source: 'agent',
      status: 'success',
      duration_ms: 55,
      offset: -12 * 60_000
    },
    {
      id: toolEventIds[5],
      prompt_id: promptIds[1],
      tool_name: 'Edit',
      file_path: 'src/app/renderer/src/components/TracePanel.tsx',
      source: 'agent',
      status: 'success',
      duration_ms: 71,
      offset: -11 * 60_000 + 30_000
    },
    {
      id: toolEventIds[6],
      prompt_id: promptIds[1],
      tool_name: 'Edit',
      file_path: 'src/app/renderer/src/components/TracePanel.tsx',
      source: 'manual',
      status: 'success',
      duration_ms: null,
      offset: -8 * 60_000
    },
    {
      id: toolEventIds[7],
      prompt_id: promptIds[2],
      tool_name: 'Bash',
      file_path: null,
      source: 'agent',
      status: 'error',
      duration_ms: 3400,
      offset: -3 * 60_000
    }
  ] as const

  for (const evt of toolEventSeeds) {
    insertToolEvent.run({
      id: evt.id,
      session_id: sessionId,
      prompt_id: evt.prompt_id,
      tool_name: evt.tool_name,
      file_path: evt.file_path,
      source: evt.source,
      status: evt.status,
      duration_ms: evt.duration_ms,
      raw_payload: null,
      created_at: iso(evt.offset)
    })
  }

  insertCodeUnit.run({
    id: codeUnitIds.tracePanel,
    project_id: projectId,
    file_path: 'src/app/renderer/src/components/TracePanel.tsx',
    unit_name: 'TracePanel',
    unit_type: 'component',
    first_seen_at: iso(-19 * 60_000 + 30_000),
    last_seen_at: iso(-8 * 60_000)
  })
  insertCodeUnit.run({
    id: codeUnitIds.useToolEvents,
    project_id: projectId,
    file_path: 'src/app/renderer/src/hooks/useToolEvents.ts',
    unit_name: 'useToolEvents',
    unit_type: 'hook',
    first_seen_at: iso(-19 * 60_000),
    last_seen_at: iso(-19 * 60_000)
  })
  insertCodeUnit.run({
    id: codeUnitIds.formatDuration,
    project_id: projectId,
    file_path: 'src/shared/format.ts',
    unit_name: 'formatDuration',
    unit_type: 'function',
    first_seen_at: iso(-12 * 60_000),
    last_seen_at: iso(-12 * 60_000)
  })

  insertCodeUnitVersion.run({
    id: randomUUID(),
    unit_id: codeUnitIds.tracePanel,
    version_no: 1,
    change_type: 'created',
    diff_text: '+ export function TracePanel(props: TracePanelProps) { ... }',
    tool_event_id: toolEventIds[1],
    prompt_id: promptIds[0],
    created_at: iso(-19 * 60_000 + 30_000)
  })
  insertCodeUnitVersion.run({
    id: randomUUID(),
    unit_id: codeUnitIds.useToolEvents,
    version_no: 1,
    change_type: 'created',
    diff_text: '+ export function useToolEvents(sessionId: string) { ... }',
    tool_event_id: toolEventIds[2],
    prompt_id: promptIds[0],
    created_at: iso(-19 * 60_000)
  })
  insertCodeUnitVersion.run({
    id: randomUUID(),
    unit_id: codeUnitIds.formatDuration,
    version_no: 1,
    change_type: 'created',
    diff_text: '+ export function formatDuration(ms: number): string { ... }',
    tool_event_id: toolEventIds[4],
    prompt_id: promptIds[1],
    created_at: iso(-12 * 60_000)
  })
  insertCodeUnitVersion.run({
    id: randomUUID(),
    unit_id: codeUnitIds.tracePanel,
    version_no: 2,
    change_type: 'modified',
    diff_text: '- <span>{event.tool_name}</span>\n+ <span>{event.tool_name} · {formatDuration(event.duration_ms)}</span>',
    tool_event_id: toolEventIds[5],
    prompt_id: promptIds[1],
    created_at: iso(-11 * 60_000 + 30_000)
  })
  insertCodeUnitVersion.run({
    id: randomUUID(),
    unit_id: codeUnitIds.tracePanel,
    version_no: 3,
    change_type: 'modified',
    diff_text: '- className="trace-item"\n+ className="trace-item trace-item--compact"',
    tool_event_id: toolEventIds[6],
    prompt_id: null,
    created_at: iso(-8 * 60_000)
  })

  // TracePanel이 useToolEvents 훅과 formatDuration 함수를 import + 호출.
  // SPEC 4.2: 엣지는 "현재 상태" 스냅샷이라 재파싱 시 from 기준 삭제 후 재삽입되지만,
  // 시드에서는 최초 1회만 채운다.
  for (const edgeType of ['imports', 'calls'] as const) {
    insertCodeUnitEdge.run({
      from_unit_id: codeUnitIds.tracePanel,
      to_unit_id: codeUnitIds.useToolEvents,
      edge_type: edgeType
    })
    insertCodeUnitEdge.run({
      from_unit_id: codeUnitIds.tracePanel,
      to_unit_id: codeUnitIds.formatDuration,
      edge_type: edgeType
    })
  }
})

seed()
db.close()

console.log(`[db:seed] session ${sessionId} seeded with ${toolEventIds.length} tool_events, 3 code_units`)
