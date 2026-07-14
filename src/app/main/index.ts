import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { config as loadEnv } from 'dotenv'
import { join } from 'node:path'
import { applySchema, openDatabase } from '@db/connection'
import { createAIProvider } from '@ai/createAIProvider'
import type {
  AiExplanation,
  CodeUnit,
  CodeUnitEdge,
  CodeUnitVersionWithUnit,
  DataChangeKind,
  LectureNote,
  OnboardingProfile,
  PipelineHandle,
  Project,
  Prompt,
  QnaHistoryEntry,
  Session,
  SkillLevel,
  ToolEvent
} from '@shared/types'
import { startPipeline } from '@pipeline/index'
import { startCaptionWorker } from './caption-worker'
import { startLectureNoteWorker } from './lecture-note-worker'
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
const stopCaptionWorker = startCaptionWorker(db, aiProvider, () => broadcastDataChanged('explanation'))
const stopLectureNoteWorker = startLectureNoteWorker(db, aiProvider, () => broadcastDataChanged('lecture-note'))
const loadSessionTrace = createSessionTraceLoader(db)
const loadContextBundle = createContextBundleLoader(db)

// SPEC 4.6 통합 모드: Person A의 관찰 파이프라인을 main 프로세스 내 모듈로 실행
// (SQLite 동시 쓰기 문제 원천 차단). 파이프라인은 같은 DB 파일에 자기 커넥션을
// 하나 더 여는데, WAL + busy_timeout이라 단일 프로세스 내 2-커넥션은 안전하다.
// 관찰 대상 프로젝트는 FACTCODING_PROJECT_PATH로 지정, 없으면 이 앱을 실행한
// 리포 자체를 관찰한다 (dev에서 셀프 관찰 데모가 됨).
// 정적 자산 경로는 import.meta/__dirname 대신 여기서 명시적으로 계산해 주입한다
// (번들링되면 그 경로들이 산출물 위치를 가리키게 되므로 — db/connection.ts와 같은 이유).
const pipelineAssets = app.isPackaged
  ? {
      schemaPath,
      coreWasmPath: join(process.resourcesPath, 'pipeline', 'tree-sitter.wasm'),
      grammarsDir: join(process.resourcesPath, 'pipeline', 'grammars'),
      hookScriptPath: join(process.resourcesPath, 'pipeline', 'hooks', 'session-event-hook.mjs')
    }
  : {
      schemaPath,
      coreWasmPath: join(app.getAppPath(), 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
      grammarsDir: join(app.getAppPath(), 'src', 'pipeline', 'ast-diff', 'grammars'),
      hookScriptPath: join(app.getAppPath(), 'src', 'pipeline', 'hooks', 'session-event-hook.mjs')
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
  pipeline.on('code-units-changed', () => broadcastDataChanged('code-units'))
  pipeline.on('session-updated', () => broadcastDataChanged('session'))
}

async function completeMonitoring(): Promise<void> {
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
    broadcastDataChanged('session')
  }
  // 종료 직전 Edit들의 AST diff가 DB에 기록될 때까지 기다린다 — 이걸 기다려야
  // 이어지는 강의노트 합성이 마지막 변경까지 포함한다.
  await stopping.stop()
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

const getLatestSessionId = db.prepare(`
  SELECT id FROM sessions WHERE project_id = @project_id ORDER BY started_at DESC LIMIT 1
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

const getAllLectureNotes = db.prepare(`
  SELECT ln.* FROM lecture_notes ln
  JOIN sessions s ON s.id = ln.session_id
  WHERE s.project_id = @project_id
  ORDER BY ln.created_at DESC
`)

const getAllSessions = db.prepare(`
  SELECT * FROM sessions WHERE project_id = @project_id ORDER BY started_at DESC
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
  INSERT INTO ai_explanations (id, target_type, target_id, skill_level, content, concept_tags, created_at)
  VALUES (@id, @target_type, @target_id, @skill_level, @content, @concept_tags, @created_at)
  ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
    content = excluded.content,
    concept_tags = excluded.concept_tags,
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
    return completeMonitoring()
  })

  ipcMain.handle(
    'pipeline:getMonitoringStatus',
    (): { isMonitoring: boolean; sessionId: string | null; projectId: string | null } => {
      return { isMonitoring: pipeline !== null, sessionId: monitoringSessionId, projectId: monitoringProjectId }
    }
  )

  ipcMain.handle('db:getSessions', (_event, projectId: string): Session[] => {
    return getAllSessions.all({ project_id: projectId }) as Session[]
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

  ipcMain.handle('db:getLectureNotes', (_event, projectId: string): LectureNote[] => {
    return getAllLectureNotes.all({ project_id: projectId }) as LectureNote[]
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
    async (
      _event,
      sessionId: string,
      question: string,
      history: QnaHistoryEntry[],
      skillLevel: SkillLevel
    ): Promise<string> => {
      const context = loadContextBundle(sessionId)
      if (!context) return '세션 정보를 찾을 수 없습니다.'
      return aiProvider.answerQuestion(question, context, history, skillLevel)
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
  stopCaptionWorker()
  stopLectureNoteWorker()
  void (async () => {
    try {
      // 파이프라인이 진행 중인 AST diff를 마저 기록하고 자기 DB 커넥션을 닫을 때까지
      // 기다린다 — 기다리지 않고 quit하면 종료 직전 변경이 유실된다.
      await pipeline?.stop()
    } catch (err) {
      console.error('[pipeline] stop failed:', err)
    }
    db.close()
    if (process.platform !== 'darwin') app.quit()
  })()
})
