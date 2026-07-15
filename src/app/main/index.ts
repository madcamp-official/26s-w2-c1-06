import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { config as loadEnv } from 'dotenv'
import { join } from 'node:path'
import { applySchema, openDatabase } from '@db/connection'
import { createAIProvider } from '@ai/createAIProvider'
import type {
  AiExplanation,
  AssistantNote,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  DataChangeKind,
  LectureNote,
  OnboardingProfile,
  PipelineHandle,
  Project,
  Prompt,
  SessionWithPreview,
  SkillLevel,
  StepWithExplanation,
  ToolEvent
} from '@shared/types'
import { groupIntoSteps, STEP_IDLE_GAP_MS } from '@shared/steps'
import type { LiveStatus } from '@shared/stepProgress'
import { startPipeline } from '@pipeline/index'
import { startCaptionWorker } from './caption-worker'
import { startLectureNoteWorker } from './lecture-note-worker'
import { startStepWorker } from './step-worker'
import { createContextBundleLoader, createSessionTraceLoader } from './session-trace'

loadEnv({ path: join(app.getAppPath(), '.env'), quiet: true })

// asar로 패키징되면 앱 리소스 경로가 읽기 전용이라 better-sqlite3가 그 안에
// .db 파일을 쓸 수 없다 (SPEC 4.6) — 패키징된 빌드에서는 사용자별 쓰기 가능
// 경로(userData)에 DB를 두고, 스키마 SQL 텍스트는 계속 앱 리소스에서 읽기만 한다.
const dbPath = app.isPackaged
  ? join(app.getPath('userData'), 'factcoding.db')
  : join(app.getAppPath(), 'db', 'factcoding.db')
const schemaPath = join(app.getAppPath(), 'db', 'schema.sql')

const db = openDatabase(dbPath)
applySchema(db, schemaPath)

// 비정상 종료(강제 종료, 크래시, dev 서버 재시작 등)로 "완료"를 못 누르고 끝난 세션은
// ended_at이 영원히 NULL로 남는다 — 이 프로세스가 막 시작된 지금 시점엔 아직 어떤
// pipeline도 연 적이 없으므로, 이 시점에 ended_at이 NULL인 세션은 전부 이전 실행의
// 잔재다. 그대로 두면 caption-worker/lecture-note-worker가 "다음 턴 시작 또는 세션
// 종료" 조건을 영원히 못 만족해 마지막 턴 캡션과 강의노트가 영구히 안 생긴다 — 앱을
// 새로 띄울 때마다 한 번 정리해 다음 턴 시작을 기다리지 않고 바로 완료 처리한다.
db.prepare(
  `UPDATE sessions SET ended_at = @ended_at WHERE ended_at IS NULL`
).run({ ended_at: new Date().toISOString() })

// SPEC 4.6 "파이프라인 이벤트 → IPC push": main이 DB를 갱신할 때마다 렌더러로
// 'data-changed'를 push해 폴링 주기를 기다리지 않고 즉시 재조회하게 한다. 같은
// kind가 짧은 시간에 여러 번 발생해도(예: 빠른 연속 tool_use) IPC를 한 번만 보내도록
// kind별로 짧게 디바운스한다. 렌더러 폴링은 이 push를 놓친 경우의 안전망으로 남는다.
let mainWindow: BrowserWindow | null = null
const broadcastDebounceByKind = new Map<DataChangeKind, ReturnType<typeof setTimeout>>()
function broadcastDataChanged(kind: DataChangeKind): void {
  const existing = broadcastDebounceByKind.get(kind)
  if (existing) clearTimeout(existing)
  broadcastDebounceByKind.set(
    kind,
    setTimeout(() => {
      broadcastDebounceByKind.delete(kind)
      mainWindow?.webContents.send('data-changed', kind)
    }, 150)
  )
}

const aiProvider = createAIProvider()
const captionWorker = startCaptionWorker(db, aiProvider, () => broadcastDataChanged('explanation'))
const stopLectureNoteWorker = startLectureNoteWorker(db, aiProvider, () => broadcastDataChanged('lecture-note'))
// 실시간 진행 로그(활동 탭 "바뀐 구조와 변경사항") — 턴 완료를 기다리는 caption-worker와
// 달리 스텝(유휴시간/개수 단위) 하나가 끝날 때마다 즉시 요약한다. 스텝 요약도
// ai_explanations 행이라 같은 'explanation' kind로 push하면 기존 훅이 그대로 재조회한다.
const stepWorker = startStepWorker(db, aiProvider, {
  onExplanationSaved: () => broadcastDataChanged('explanation'),
  onLiveUpdate: (status) => mainWindow?.webContents.send('step-live-status', status)
})
const loadSessionTrace = createSessionTraceLoader(db)
const loadContextBundle = createContextBundleLoader(db)

// SPEC 4.6 통합 모드: Person A의 관찰 파이프라인을 main 프로세스 내 모듈로 실행
// (SQLite 동시 쓰기 문제 원천 차단). 파이프라인은 같은 DB 파일에 자기 커넥션을
// 하나 더 여는데, WAL + busy_timeout이라 단일 프로세스 내 2-커넥션은 안전하다.
// 관찰 대상 프로젝트는 FACTCODING_PROJECT_PATH로 지정, 없으면 이 앱을 실행한
// 리포 자체를 관찰한다 (dev에서 셀프 관찰 데모가 됨).
// 정적 자산 경로는 import.meta/__dirname 대신 여기서 명시적으로 계산해 주입한다
// (번들링되면 그 경로들이 산출물 위치를 가리키게 되므로 — db/connection.ts와 같은 이유).
// packaged 빌드는 electron-builder.yml의 extraResources로 담아준 바이너리를 쓴다.
// dev 모드는 아직 앱에 번들링된 바이너리가 없으므로, 이 머신에 Homebrew로 설치된
// 경로 후보를 먼저 찾고(Apple Silicon/Intel 경로가 다름) 못 찾으면 PATH 조회에 맡긴다
// (GUI로 띄운 Electron은 로그인 셸의 PATH를 못 물려받을 수 있어 완전히 안전하진 않다 —
// `npm run dev`처럼 터미널에서 띄우면 문제없다).
function resolveDevCtagsBinary(): string {
  const candidates = ['/opt/homebrew/bin/ctags', '/usr/local/bin/ctags']
  return candidates.find((p) => existsSync(p)) ?? 'ctags'
}

const pipelineAssets = app.isPackaged
  ? {
      schemaPath,
      coreWasmPath: join(process.resourcesPath, 'pipeline', 'tree-sitter.wasm'),
      grammarsDir: join(process.resourcesPath, 'pipeline', 'grammars'),
      hookScriptPath: join(process.resourcesPath, 'pipeline', 'hooks', 'session-event-hook.mjs'),
      ctagsBinaryPath: join(process.resourcesPath, 'pipeline', 'ctags', 'ctags')
    }
  : {
      schemaPath,
      coreWasmPath: join(app.getAppPath(), 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
      grammarsDir: join(app.getAppPath(), 'src', 'pipeline', 'ast-diff', 'grammars'),
      hookScriptPath: join(app.getAppPath(), 'src', 'pipeline', 'hooks', 'session-event-hook.mjs'),
      ctagsBinaryPath: resolveDevCtagsBinary()
    }

// 프로젝트: 코드베이스 단위 묶음(이름 + 워크스페이스 경로). 관제실/구조도/강의노트는
// 전부 이 project_id로 스코프된다 — 앱을 켜면 항상 프로젝트 탭이 먼저 뜨고, 사용자가
// 프로젝트를 고르거나 새로 등록해야 그 프로젝트의 데이터를 볼 수 있다.
const getAllProjectsStmt = db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`)
const getProjectByIdStmt = db.prepare(`SELECT * FROM projects WHERE id = @id`)
const getProjectByPathStmt = db.prepare(`SELECT * FROM projects WHERE workspace_path = @workspace_path`)
const insertProjectStmt = db.prepare(`
  INSERT INTO projects (id, name, workspace_path, created_at)
  VALUES (@id, @name, @workspace_path, @created_at)
`)

// 프로젝트 삭제 시 함께 지워야 하는 관측 이력 — schema.sql의 FK(foreign_keys = ON,
// db/connection.ts)를 지키려면 자식 행부터 순서대로 지워야 한다. ai_explanations는
// target_id에 FK가 없어 안 지워도 에러는 안 나지만, 그대로 두면 프롬프트/버전이 사라진
// 뒤에도 고아 해설 캐시로 남으므로 같이 정리한다.
const deleteExplanationsByPromptStmt = db.prepare(`
  DELETE FROM ai_explanations
  WHERE target_type = 'prompt' AND target_id IN (
    SELECT p.id FROM prompts p
    JOIN sessions s ON s.id = p.session_id
    WHERE s.project_id = @project_id
  )
`)
const deleteExplanationsByVersionStmt = db.prepare(`
  DELETE FROM ai_explanations
  WHERE target_type = 'code_unit_version' AND target_id IN (
    SELECT v.id FROM code_unit_versions v
    JOIN code_units u ON u.id = v.unit_id
    WHERE u.project_id = @project_id
  )
`)
// 실시간 진행 로그(step-worker.ts)의 step 행 target_id는 그 스텝 첫 tool_event의 id다.
const deleteExplanationsByStepStmt = db.prepare(`
  DELETE FROM ai_explanations
  WHERE target_type = 'step' AND target_id IN (
    SELECT te.id FROM tool_events te
    WHERE te.session_id IN (SELECT id FROM sessions WHERE project_id = @project_id)
  )
`)
const deleteEdgesByProjectStmt = db.prepare(`
  DELETE FROM code_unit_edges
  WHERE from_unit_id IN (SELECT id FROM code_units WHERE project_id = @project_id)
     OR to_unit_id IN (SELECT id FROM code_units WHERE project_id = @project_id)
`)
const deleteVersionsByProjectStmt = db.prepare(`
  DELETE FROM code_unit_versions
  WHERE unit_id IN (SELECT id FROM code_units WHERE project_id = @project_id)
`)
const deleteToolEventsByProjectStmt = db.prepare(`
  DELETE FROM tool_events
  WHERE session_id IN (SELECT id FROM sessions WHERE project_id = @project_id)
`)
// assistant_notes.session_id/prompt_id 둘 다 FK(foreign_keys=ON)라 sessions/prompts보다 먼저 지워야 한다.
const deleteAssistantNotesByProjectStmt = db.prepare(`
  DELETE FROM assistant_notes
  WHERE session_id IN (SELECT id FROM sessions WHERE project_id = @project_id)
`)
const deletePromptsByProjectStmt = db.prepare(`
  DELETE FROM prompts
  WHERE session_id IN (SELECT id FROM sessions WHERE project_id = @project_id)
`)
const deleteLectureNotesByProjectStmt = db.prepare(`
  DELETE FROM lecture_notes
  WHERE session_id IN (SELECT id FROM sessions WHERE project_id = @project_id)
`)
const deleteSessionsByProjectStmt = db.prepare(`DELETE FROM sessions WHERE project_id = @project_id`)
const deleteCodeUnitsByProjectStmt = db.prepare(`DELETE FROM code_units WHERE project_id = @project_id`)
const deleteProjectStmt = db.prepare(`DELETE FROM projects WHERE id = @id`)

function getOrCreateProject(name: string, workspacePath: string): Project {
  const existing = getProjectByPathStmt.get({ workspace_path: workspacePath }) as Project | undefined
  if (existing) return existing
  const row: Project = {
    id: randomUUID(),
    name,
    workspace_path: workspacePath,
    created_at: new Date().toISOString()
  }
  insertProjectStmt.run(row)
  return row
}

// 사용자가 여러 AI 에이전트/프로젝트를 동시에 다룰 수 있어(코딩이 아닌 작업도 포함),
// 앱을 켜자마자 무조건 관찰을 시작하지 않는다 — 헤더의 "시작하기"를 눌러야 그 시점부터만
// 관찰을 켠다(PipelineConfig.startAtEnd: true로 그 이전 내용은 스킵). "완료"를 누르면
// 관찰을 멈추고 그 세션을 종료 처리해 강의노트 자동 합성을 트리거한다(SPEC 4.3.2).
let pipeline: PipelineHandle | null = null
let monitoringSessionId: string | null = null
let monitoringProjectId: string | null = null

function buildPipelineConfig(project: Project) {
  return {
    projectId: project.id,
    projectPath: project.workspace_path,
    dbPath,
    assets: pipelineAssets,
    startAtEnd: true
  }
}

function startMonitoring(projectId: string): void {
  if (pipeline) return // 이미 관찰 중이면 아무것도 안 함 (버튼 연타 방지)
  const project = getProjectByIdStmt.get({ id: projectId }) as Project | undefined
  if (!project) throw new Error(`unknown project: ${projectId}`)
  monitoringSessionId = null
  monitoringProjectId = project.id
  pipeline = startPipeline(buildPipelineConfig(project))
  pipeline.on('error', (err) => console.error('[pipeline]', err))
  pipeline.on('session-file-changed', (filePath) => {
    console.log('[pipeline] tailing session file:', filePath)
  })
  // "완료" 클릭 시 markSessionEnded에 넘길 id는 파일명(session-file-changed)이 아니라
  // 여기서 추적한다 — 같은 JSONL을 "완료" 후 재개하면 파이프라인이 새 논리 세션 id를
  // 발급하는데(세션 PK 재사용 방지), 파일명 기반 id는 그 재개를 반영하지 못한다.
  pipeline.on('session-resolved', (sessionId) => {
    monitoringSessionId = sessionId
    broadcastDataChanged('session')
  })
  // prompt/tool_use/tool_result 등 모든 트랜스크립트 이벤트가 prompts/tool_events를
  // 건드린다 — 렌더러의 트레이스/턴 목록이 다음 폴링을 기다리지 않고 갱신되게 push.
  pipeline.on('transcript-event', () => broadcastDataChanged('trace'))
  // Stop 훅(턴 종료)으로 prompts.completed_at이 갱신됨 — 진행중 스피너/진행바가
  // 유휴시간 추정이나 AI 요약 도착을 기다리지 않고 즉시 완료 상태로 바뀌게 push.
  // 턴이 완료됐다는 건 caption-worker가 그 턴 캡션을 만들 수 있게 됐다는 뜻이기도 하니
  // 5초 폴링을 기다리지 않고 바로 한 번 더 시도하게 한다("요약 생성 중…" 체감 지연 단축).
  pipeline.on('turn-completed', () => {
    broadcastDataChanged('trace')
    captionWorker.triggerTick()
  })
  // AST diff가 code_unit_versions를 새로 커밋한 직후 — 이 유닛들의 캡션도 곧바로
  // 시도한다(같은 이유, code-units-changed는 code_unit_version 캡션 대상이 막 생겼다는 신호).
  pipeline.on('code-units-changed', () => {
    broadcastDataChanged('code-units')
    captionWorker.triggerTick()
  })
  pipeline.on('session-updated', () => broadcastDataChanged('session'))
}

// 사용자가 UI의 "완료" 버튼을 눌렀을 때만 기록되는 세션 완료 표식 — SessionEnd 훅,
// 앱 종료, 고아 세션 정리처럼 ended_at만 채워지는 경로와 구분된다. 강의노트 자동
// 합성(lecture-note-worker)은 ended_at이 아니라 이 값을 게이트로 쓴다.
const markSessionCompletedStmt = db.prepare(
  `UPDATE sessions SET completed_at = @completed_at WHERE id = @id`
)

// userCompleted: "완료" 버튼 경로만 true — 창을 그냥 닫는 경로(window-all-closed)는
// 관찰 종료 처리(ended_at)까지만 하고 completed_at은 남기지 않아 강의노트가 자동
// 생성되지 않는다(사용자가 명시적으로 완료했다고 표시한 세션만 노트를 만든다).
async function completeMonitoring(userCompleted: boolean): Promise<void> {
  if (!pipeline) return
  const stopping = pipeline
  // 핸들을 먼저 비워서, stop()이 flush를 기다리는 동안 "시작하기"를 다시 눌러도
  // 새 파이프라인을 정상적으로 띄울 수 있게 한다 (stop은 내부 stopped 플래그로 멱등).
  pipeline = null
  const sessionId = monitoringSessionId
  monitoringSessionId = null
  monitoringProjectId = null
  if (sessionId) {
    stopping.markSessionEnded(sessionId)
    if (userCompleted) {
      markSessionCompletedStmt.run({ id: sessionId, completed_at: new Date().toISOString() })
    }
    broadcastDataChanged('session')
  }
  // 종료 직전 Edit들의 AST diff가 DB에 기록될 때까지 기다린다 — 이걸 기다려야
  // 이어지는 강의노트 합성이 마지막 변경까지 포함한다.
  await stopping.stop()
}

// 지금 파이프라인이 관찰 중인 프로젝트는 지울 수 없다 — 지우고 나면 파이프라인이
// 죽은 project_id로 계속 행을 쓰게 된다. 렌더러도 같은 조건으로 삭제 버튼을 막지만,
// 여기서도 한 번 더 막아둔다(다른 창/경합 대비).
function deleteProject(projectId: string): void {
  if (monitoringProjectId === projectId) {
    throw new Error('관찰 중인 프로젝트는 삭제할 수 없어요. 먼저 완료를 눌러주세요.')
  }
  const run = db.transaction((id: string): void => {
    deleteExplanationsByPromptStmt.run({ project_id: id })
    deleteExplanationsByVersionStmt.run({ project_id: id })
    deleteExplanationsByStepStmt.run({ project_id: id })
    deleteEdgesByProjectStmt.run({ project_id: id })
    deleteVersionsByProjectStmt.run({ project_id: id })
    deleteToolEventsByProjectStmt.run({ project_id: id })
    // assistant_notes.prompt_id/session_id 둘 다 FK라 prompts/sessions보다 먼저 지워야 한다.
    deleteAssistantNotesByProjectStmt.run({ project_id: id })
    deletePromptsByProjectStmt.run({ project_id: id })
    deleteLectureNotesByProjectStmt.run({ project_id: id })
    deleteSessionsByProjectStmt.run({ project_id: id })
    deleteCodeUnitsByProjectStmt.run({ project_id: id })
    deleteProjectStmt.run({ id })
  })
  run(projectId)
}

if (process.env.FACTCODING_AUTOSTART_PIPELINE === '1') {
  // 데모/디버깅 전용 뒷문 — 기본 동작은 항상 수동 "시작하기"다. 프로젝트를 아직 하나도
  // 등록하지 않았을 수 있으니, 자체 관찰용 프로젝트를 없으면 만들어서 바로 시작한다.
  const selfProject = getOrCreateProject(
    'factcoding (self)',
    process.env.FACTCODING_PROJECT_PATH ?? app.getAppPath()
  )
  startMonitoring(selfProject.id)
}

const getToolEventsBySession = db.prepare(`
  SELECT * FROM tool_events
  WHERE session_id = @session_id
  ORDER BY created_at ASC, rowid ASC
`)

const getPromptsBySession = db.prepare(`
  SELECT * FROM prompts
  WHERE session_id = @session_id
  ORDER BY turn_index ASC
`)

const getNotesBySessionStmt = db.prepare(`
  SELECT * FROM assistant_notes
  WHERE session_id = @session_id
  ORDER BY created_at ASC, rowid ASC
`)

// step-worker와 동일한 skill_level 스코프로 조회 — target_id(스텝 id)는 그 스텝의
// 첫 tool_event id라 세션 경계 없이도 전역 유일하므로 세션으로 다시 스코프할 필요 없다.
const getStepExplanationsStmt = db.prepare(`
  SELECT * FROM ai_explanations WHERE target_type = 'step' AND skill_level = @skill_level
`)

const getSessionEndedAtStmt = db.prepare(`SELECT ended_at FROM sessions WHERE id = @id`)

// db:getSteps의 "진행 중" 판정용 — Stop 훅으로 이미 완료 처리된 턴의 스텝은
// 세션이 아직 안 끝났어도 진행 중으로 보지 않는다.
const getCompletedPromptIdsStmt = db.prepare(`
  SELECT id FROM prompts WHERE session_id = @session_id AND completed_at IS NOT NULL
`)

// 세션 재개(resume)로 발급된 논리 id들은 원본 세션의 started_at을 그대로 물려받아
// 서로 값이 같을 수 있다(resolveLogicalSessionId 참조) — started_at만으로 정렬하면
// 동점 처리 순서가 SQLite 쿼리 플래너에 좌우돼 "진짜 최근 것"이 안 나올 수 있으므로
// rowid(삽입 순서) DESC를 2차 정렬 기준으로 둬 항상 가장 나중에 만들어진 행이 이긴다.
const getLatestSessionId = db.prepare(`
  SELECT id FROM sessions WHERE project_id = @project_id ORDER BY started_at DESC, rowid DESC LIMIT 1
`)

const getSkillLevelStmt = db.prepare(`
  SELECT value FROM user_settings WHERE key = 'skill_level'
`)

const setSkillLevelStmt = db.prepare(`
  INSERT INTO user_settings (key, value) VALUES ('skill_level', @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

// target_id는 tool_event가 아니라 prompt(턴) id다 — 관제실은 개별 액션이 아니라
// "코딩 수정이 완료된 턴" 단위로만 해설을 받는다(caption-worker.ts 참조).
const getExplanationsBySession = db.prepare(`
  SELECT ae.* FROM ai_explanations ae
  JOIN prompts p ON p.id = ae.target_id
  WHERE ae.target_type = 'prompt' AND p.session_id = @session_id AND ae.skill_level = @skill_level
`)

const getCodeUnitsStmt = db.prepare(`
  SELECT * FROM code_units WHERE project_id = @project_id ORDER BY file_path ASC, unit_name ASC
`)

const getVersionsByUnit = db.prepare(`
  SELECT v.*, u.unit_name, u.unit_type, u.file_path
  FROM code_unit_versions v
  JOIN code_units u ON u.id = v.unit_id
  WHERE v.unit_id = @unit_id
  ORDER BY v.version_no ASC
`)

const getVersionExplanationsByUnit = db.prepare(`
  SELECT ae.* FROM ai_explanations ae
  JOIN code_unit_versions v ON v.id = ae.target_id
  WHERE ae.target_type = 'code_unit_version' AND v.unit_id = @unit_id AND ae.skill_level = @skill_level
`)

// 관제실의 "턴 상세" 화면: 이 턴에서 실제로 바뀐 코드 유닛 버전(diff)들을 턴 단위로
// 조회한다. prompt_id가 NULL인 경우(수동 수정 등, SPEC 4.1 fallback)는 별도
// 쿼리로 처리 — better-sqlite3는 `= NULL` 비교를 바인딩할 수 없어서 나눴다.
const getVersionsByPrompt = db.prepare(`
  SELECT v.*, u.unit_name, u.unit_type, u.file_path
  FROM code_unit_versions v
  JOIN code_units u ON u.id = v.unit_id
  WHERE v.prompt_id = @prompt_id
  ORDER BY v.created_at ASC
`)

const getOrphanVersions = db.prepare(`
  SELECT v.*, u.unit_name, u.unit_type, u.file_path
  FROM code_unit_versions v
  JOIN code_units u ON u.id = v.unit_id
  JOIN tool_events te ON te.id = v.tool_event_id
  WHERE v.prompt_id IS NULL AND te.session_id = @session_id
  ORDER BY v.created_at ASC
`)

const getVersionExplanationsByPrompt = db.prepare(`
  SELECT ae.* FROM ai_explanations ae
  JOIN code_unit_versions v ON v.id = ae.target_id
  WHERE ae.target_type = 'code_unit_version' AND v.prompt_id = @prompt_id AND ae.skill_level = @skill_level
`)

const getOrphanVersionExplanations = db.prepare(`
  SELECT ae.* FROM ai_explanations ae
  JOIN code_unit_versions v ON v.id = ae.target_id
  JOIN tool_events te ON te.id = v.tool_event_id
  WHERE ae.target_type = 'code_unit_version' AND v.prompt_id IS NULL
    AND te.session_id = @session_id AND ae.skill_level = @skill_level
`)

// from/to unit id 둘 다 해시에 project_id가 포함돼 있어(unit-id.ts) 한쪽만 조인해도 충분하다.
const getAllCodeUnitEdges = db.prepare(`
  SELECT e.* FROM code_unit_edges e
  JOIN code_units u ON u.id = e.from_unit_id
  WHERE u.project_id = @project_id
`)

// 노트 패널은 특정 프로젝트가 아니라 모든 프로젝트에서 만들어진 강의노트를 하나의
// 누적 목록으로 보여준다 — project_id로 스코프하지 않고, 어느 프로젝트에서 나왔는지
// 표시할 수 있도록 project 이름만 조인해 함께 반환한다.
const getAllLectureNotes = db.prepare(`
  SELECT ln.*, p.id AS project_id, p.name AS project_name
  FROM lecture_notes ln
  JOIN sessions s ON s.id = ln.session_id
  JOIN projects p ON p.id = s.project_id
  ORDER BY ln.created_at DESC
`)

// 사이드바 "지난 턴" 목록은 세션을 짧은 id(커밋 해시처럼 보임) 대신 그 세션의 첫 프롬프트
// 내용으로 식별해서 보여준다 — 세션당 첫 turn_index의 user_text 하나를 상관 서브쿼리로 붙인다.
const getAllSessions = db.prepare(`
  SELECT s.*, (
    SELECT p.user_text FROM prompts p
    WHERE p.session_id = s.id
    ORDER BY p.turn_index ASC
    LIMIT 1
  ) AS first_prompt_text
  FROM sessions s
  WHERE s.project_id = @project_id
  ORDER BY s.started_at DESC
`)

const getOnboardingCompletedStmt = db.prepare(`
  SELECT value FROM user_settings WHERE key = 'onboarding_completed'
`)

const setOnboardingCompletedStmt = db.prepare(`
  INSERT INTO user_settings (key, value) VALUES ('onboarding_completed', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

// 온보딩 3단계(수강 과목/프로젝트 경험/교육 스타일) 전체를 JSON 한 덩어리로 저장 —
// 별도 테이블 없이 user_settings 키-값에 얹는다 (skill_level/onboarding_completed와 같은 패턴).
const getOnboardingProfileStmt = db.prepare(`
  SELECT value FROM user_settings WHERE key = 'onboarding_profile'
`)

const setOnboardingProfileStmt = db.prepare(`
  INSERT INTO user_settings (key, value) VALUES ('onboarding_profile', @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

const getVersionByIdStmt = db.prepare(`
  SELECT v.*, u.unit_name, u.unit_type, u.file_path
  FROM code_unit_versions v
  JOIN code_units u ON u.id = v.unit_id
  WHERE v.id = @id
`)

const getCachedExplanationStmt = db.prepare(`
  SELECT * FROM ai_explanations
  WHERE target_type = @target_type AND target_id = @target_id AND skill_level = @skill_level
`)

const upsertExplanationStmt = db.prepare(`
  INSERT INTO ai_explanations (id, target_type, target_id, skill_level, content, concept_tags, key_code_snippet, created_at)
  VALUES (@id, @target_type, @target_id, @skill_level, @content, @concept_tags, @key_code_snippet, @created_at)
  ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
    content = excluded.content,
    concept_tags = excluded.concept_tags,
    key_code_snippet = excluded.key_code_snippet,
    created_at = excluded.created_at
`)

const getCachedLectureNoteStmt = db.prepare(`
  SELECT * FROM lecture_notes WHERE session_id = @session_id AND skill_level = @skill_level
  ORDER BY created_at DESC LIMIT 1
`)

const insertLectureNoteStmt = db.prepare(`
  INSERT INTO lecture_notes (id, session_id, markdown, skill_level, created_at)
  VALUES (@id, @session_id, @markdown, @skill_level, @created_at)
`)

function registerIpcHandlers(): void {
  ipcMain.handle('project:list', (): Project[] => {
    return getAllProjectsStmt.all() as Project[]
  })

  ipcMain.handle('project:create', (_event, name: string, workspacePath: string): Project => {
    return getOrCreateProject(name, workspacePath)
  })

  ipcMain.handle('project:selectFolder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '코드 워크스페이스 폴더 선택'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('project:delete', (_event, projectId: string): void => {
    deleteProject(projectId)
  })

  ipcMain.handle('db:getLatestSessionId', (_event, projectId: string): string | null => {
    const row = getLatestSessionId.get({ project_id: projectId }) as { id: string } | undefined
    return row?.id ?? null
  })

  ipcMain.handle('pipeline:startMonitoring', (_event, projectId: string): void => {
    startMonitoring(projectId)
  })

  // Promise를 그대로 반환해 renderer의 "완료" 버튼이 마지막 AST diff flush까지
  // 기다렸다가 pending을 풀게 한다 (await 없이 버리면 unhandled rejection이 되기도 함).
  ipcMain.handle('pipeline:completeMonitoring', (): Promise<void> => {
    return completeMonitoring(true)
  })

  ipcMain.handle(
    'pipeline:getMonitoringStatus',
    (): { isMonitoring: boolean; sessionId: string | null; projectId: string | null } => {
      return { isMonitoring: pipeline !== null, sessionId: monitoringSessionId, projectId: monitoringProjectId }
    }
  )

  // 렌더러 마운트 캐치업용 pull — 'step-live-status' push는 워커가 이 모듈 로드
  // 시점(창이 아직 없을 때)에 쏘는 최초 상태를 유실할 수 있어, 마운트 시 한 번
  // 당겨와야 한다(step-worker.ts의 getLiveStatus 참조).
  ipcMain.handle('step:getLiveStatus', (): LiveStatus => {
    return stepWorker.getLiveStatus()
  })

  ipcMain.handle('db:getSessions', (_event, projectId: string): SessionWithPreview[] => {
    return getAllSessions.all({ project_id: projectId }) as SessionWithPreview[]
  })

  ipcMain.handle('db:getToolEvents', (_event, sessionId: string): ToolEvent[] => {
    return getToolEventsBySession.all({ session_id: sessionId }) as ToolEvent[]
  })

  ipcMain.handle('db:getPrompts', (_event, sessionId: string): Prompt[] => {
    return getPromptsBySession.all({ session_id: sessionId }) as Prompt[]
  })

  ipcMain.handle('db:getSkillLevel', (): SkillLevel => {
    const row = getSkillLevelStmt.get() as { value: string } | undefined
    return (row?.value as SkillLevel | undefined) ?? 'intermediate'
  })

  ipcMain.handle('db:setSkillLevel', (_event, level: SkillLevel): void => {
    setSkillLevelStmt.run({ value: level })
  })

  ipcMain.handle(
    'db:getExplanations',
    (_event, sessionId: string, skillLevel: SkillLevel): AiExplanation[] => {
      return getExplanationsBySession.all({
        session_id: sessionId,
        skill_level: skillLevel
      }) as AiExplanation[]
    }
  )

  // 실시간 진행 로그(활동 탭 "바뀐 구조와 변경사항"): step-worker와 똑같은 방식으로
  // (동일한 groupIntoSteps 알고리즘) 세션의 이벤트/노트를 다시 스텝으로 나눈 뒤,
  // 이미 생성된 ai_explanations(target_type='step')를 조인해 붙인다 — 스텝을 별도
  // 테이블에 저장하지 않고 항상 이렇게 파생시켜서 두 곳(worker/조회)의 경계 정의가
  // 어긋날 일이 없다.
  ipcMain.handle(
    'db:getSteps',
    (_event, sessionId: string, skillLevel: SkillLevel): StepWithExplanation[] => {
      const session = getSessionEndedAtStmt.get({ id: sessionId }) as { ended_at: string | null } | undefined
      const events = getToolEventsBySession.all({ session_id: sessionId }) as ToolEvent[]
      const notes = getNotesBySessionStmt.all({ session_id: sessionId }) as AssistantNote[]
      const steps = groupIntoSteps(notes, events)
      const explanationsByStepId = new Map(
        (getStepExplanationsStmt.all({ skill_level: skillLevel }) as AiExplanation[]).map((e) => [
          e.target_id,
          e
        ])
      )
      const lastStep = steps[steps.length - 1]
      // 마지막 스텝이라도 "진행 중"으로 보지 않는 경우: 그 스텝이 속한 턴이 Stop 훅으로
      // 이미 완료됐거나(completed_at), 마지막 이벤트 후 스텝 유휴시간이 지났을 때 —
      // 세션 종료만 기준으로 삼으면 에이전트가 일을 끝낸 뒤에도 계속 진행 중으로 보인다.
      const completedPromptIds = new Set(
        (getCompletedPromptIdsStmt.all({ session_id: sessionId }) as { id: string }[]).map((r) => r.id)
      )
      const lastEvent = lastStep?.events[lastStep.events.length - 1]
      const lastEventStale = lastEvent?.created_at
        ? Date.now() - Date.parse(lastEvent.created_at) > STEP_IDLE_GAP_MS
        : false
      const lastStepInProgress =
        (session?.ended_at ?? null) === null &&
        lastStep !== undefined &&
        !(lastStep.promptId !== null && completedPromptIds.has(lastStep.promptId)) &&
        !lastEventStale

      return steps.map((step) => ({
        stepId: step.id,
        promptId: step.promptId,
        startedAt: new Date(step.startedAt).toISOString(),
        inProgress: lastStepInProgress && step === lastStep,
        explanation: explanationsByStepId.get(step.id) ?? null,
        toolEventIds: step.events.map((e) => e.id)
      }))
    }
  )

  ipcMain.handle('db:getCodeUnits', (_event, projectId: string): CodeUnit[] => {
    return getCodeUnitsStmt.all({ project_id: projectId }) as CodeUnit[]
  })

  ipcMain.handle('db:getUnitVersions', (_event, unitId: string): CodeUnitVersionWithUnit[] => {
    return getVersionsByUnit.all({ unit_id: unitId }) as CodeUnitVersionWithUnit[]
  })

  ipcMain.handle(
    'db:getUnitVersionExplanations',
    (_event, unitId: string, skillLevel: SkillLevel): AiExplanation[] => {
      return getVersionExplanationsByUnit.all({
        unit_id: unitId,
        skill_level: skillLevel
      }) as AiExplanation[]
    }
  )

  // 관제실 "턴 상세": promptId가 있으면 그 턴에서 바뀐 버전만, null이면(수동 수정 등)
  // 같은 세션의 prompt_id 없는 버전들을 대신 조회한다.
  ipcMain.handle(
    'db:getUnitVersionsByPrompt',
    (_event, promptId: string | null, sessionId: string): CodeUnitVersionWithUnit[] => {
      if (promptId) {
        return getVersionsByPrompt.all({ prompt_id: promptId }) as CodeUnitVersionWithUnit[]
      }
      return getOrphanVersions.all({ session_id: sessionId }) as CodeUnitVersionWithUnit[]
    }
  )

  ipcMain.handle(
    'db:getUnitVersionExplanationsByPrompt',
    (_event, promptId: string | null, sessionId: string, skillLevel: SkillLevel): AiExplanation[] => {
      if (promptId) {
        return getVersionExplanationsByPrompt.all({
          prompt_id: promptId,
          skill_level: skillLevel
        }) as AiExplanation[]
      }
      return getOrphanVersionExplanations.all({
        session_id: sessionId,
        skill_level: skillLevel
      }) as AiExplanation[]
    }
  )

  ipcMain.handle('db:getCodeUnitEdges', (_event, projectId: string): CodeUnitEdge[] => {
    return getAllCodeUnitEdges.all({ project_id: projectId }) as CodeUnitEdge[]
  })

  ipcMain.handle('db:getLectureNotes', (): LectureNote[] => {
    return getAllLectureNotes.all() as LectureNote[]
  })

  ipcMain.handle('db:isOnboardingComplete', (): boolean => {
    const row = getOnboardingCompletedStmt.get() as { value: string } | undefined
    return row?.value === '1'
  })

  ipcMain.handle('db:completeOnboarding', (): void => {
    setOnboardingCompletedStmt.run()
  })

  ipcMain.handle('db:getOnboardingProfile', (): OnboardingProfile | null => {
    const row = getOnboardingProfileStmt.get() as { value: string } | undefined
    return row ? (JSON.parse(row.value) as OnboardingProfile) : null
  })

  ipcMain.handle('db:saveOnboardingProfile', (_event, profile: OnboardingProfile): void => {
    setOnboardingProfileStmt.run({ value: JSON.stringify(profile) })
  })

  // SPEC 5.1 항목별 오버라이드: 전역 skill_level을 바꾸지 않고 이 유닛 버전 하나만
  // 다른 난이도로 조회 — ai_explanations 캐시를 먼저 보고, 없으면 온디맨드 생성.
  ipcMain.handle(
    'db:explainVersionOverride',
    async (_event, versionId: string, skillLevel: SkillLevel): Promise<AiExplanation | null> => {
      const cached = getCachedExplanationStmt.get({
        target_type: 'code_unit_version',
        target_id: versionId,
        skill_level: skillLevel
      }) as AiExplanation | undefined
      if (cached) return cached

      const version = getVersionByIdStmt.get({ id: versionId }) as
        | CodeUnitVersionWithUnit
        | undefined
      if (!version) return null

      const [caption] = await aiProvider.explainUnitVersions([version], skillLevel)
      if (!caption) return null

      const row: AiExplanation = {
        id: randomUUID(),
        target_type: 'code_unit_version',
        target_id: versionId,
        skill_level: skillLevel,
        content: caption.caption,
        key_code_snippet: caption.keySnippet,
        key_code_lang: null,
        key_code_file: null,
        key_code_other_files: null,
        key_code_explanation: null,
        key_code_importance: null,
        key_code_application: null,
        error_detail: null,
        status: null,
        concept_tags: JSON.stringify(caption.conceptTags),
        created_at: new Date().toISOString()
      }
      upsertExplanationStmt.run(row)
      return row
    }
  )

  // SPEC 4.3.2 온디맨드 재생성: 세션당 자동 생성은 1회뿐이라, 다른 난이도로
  // 다시 보고 싶을 때 뷰어에서 호출. 같은 (session, skill_level) 조합은 캐시.
  ipcMain.handle(
    'db:regenerateLectureNote',
    async (_event, sessionId: string, skillLevel: SkillLevel): Promise<LectureNote | null> => {
      const cached = getCachedLectureNoteStmt.get({
        session_id: sessionId,
        skill_level: skillLevel
      }) as LectureNote | undefined
      if (cached) return cached

      const trace = loadSessionTrace(sessionId)
      if (!trace) return null

      const markdown = await aiProvider.synthesizeLectureNote(trace, skillLevel)
      const row: LectureNote = {
        id: randomUUID(),
        session_id: sessionId,
        markdown,
        skill_level: skillLevel,
        created_at: new Date().toISOString()
      }
      insertLectureNoteStmt.run(row)
      return row
    }
  )

  ipcMain.handle(
    'db:answerQuestion',
    async (_event, sessionId: string, question: string, skillLevel: SkillLevel): Promise<string> => {
      const context = loadContextBundle(sessionId)
      if (!context) return '세션 정보를 찾을 수 없습니다.'
      return aiProvider.answerQuestion(question, context, skillLevel)
    }
  )
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // broadcastDataChanged가 push할 대상 — 창을 닫으면 참조를 비워 죽은 webContents로
  // send()를 시도하지 않게 한다.
  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.on('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  captionWorker.stop()
  stopLectureNoteWorker()
  stepWorker.stop()
  void (async () => {
    try {
      // "완료" 버튼을 안 누르고 창을 그냥 닫아도(Cmd+Q 등) 지금 관찰 중이던 세션을
      // ended_at 기록까지 마친 뒤 종료한다 — 안 그러면 이 세션의 마지막 턴이 다음 실행
      // 시작 때 위 고아 세션 정리 로직에 걸릴 때까지 "완료" 신호를 못 받는다.
      // userCompleted=false: 명시적 "완료"가 아니므로 completed_at은 남기지 않는다
      // (강의노트는 완료 버튼을 누른 세션에만 자동 생성).
      await completeMonitoring(false)
    } catch (err) {
      console.error('[pipeline] stop failed:', err)
    }
    db.close()
    if (process.platform !== 'darwin') app.quit()
  })()
})
