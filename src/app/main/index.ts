import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
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
  LectureNote,
  PipelineHandle,
  Prompt,
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

const aiProvider = createAIProvider()
const stopCaptionWorker = startCaptionWorker(db, aiProvider)
const stopLectureNoteWorker = startLectureNoteWorker(db, aiProvider)
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

let pipeline: PipelineHandle | null = null
if (process.env.FACTCODING_DISABLE_PIPELINE !== '1') {
  pipeline = startPipeline({
    projectPath: process.env.FACTCODING_PROJECT_PATH ?? app.getAppPath(),
    dbPath,
    assets: pipelineAssets
  })
  pipeline.on('error', (err) => console.error('[pipeline]', err))
  pipeline.on('session-file-changed', (filePath) =>
    console.log('[pipeline] tailing session file:', filePath)
  )
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

const getAssistantNotesBySession = db.prepare(`
  SELECT * FROM assistant_notes
  WHERE session_id = @session_id
  ORDER BY created_at ASC, rowid ASC
`)

const getLatestSessionId = db.prepare(`
  SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1
`)

const getSkillLevelStmt = db.prepare(`
  SELECT value FROM user_settings WHERE key = 'skill_level'
`)

const setSkillLevelStmt = db.prepare(`
  INSERT INTO user_settings (key, value) VALUES ('skill_level', @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

const getExplanationsBySession = db.prepare(`
  SELECT ae.* FROM ai_explanations ae
  JOIN tool_events te ON te.id = ae.target_id
  WHERE ae.target_type = 'tool_event' AND te.session_id = @session_id AND ae.skill_level = @skill_level
`)

// 스텝 요약 캡션. target_id = 스텝 대표 assistant_notes.id라, assistant_notes에
// 조인해 세션으로 필터한다(ai_explanations 자체엔 session_id가 없음).
const getStepExplanationsBySession = db.prepare(`
  SELECT ae.* FROM ai_explanations ae
  JOIN assistant_notes an ON an.id = ae.target_id
  WHERE ae.target_type = 'step' AND an.session_id = @session_id AND ae.skill_level = @skill_level
`)

const getCodeUnitsStmt = db.prepare(`
  SELECT * FROM code_units ORDER BY file_path ASC, unit_name ASC
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

const getAllCodeUnitEdges = db.prepare(`
  SELECT * FROM code_unit_edges
`)

const getAllLectureNotes = db.prepare(`
  SELECT * FROM lecture_notes ORDER BY created_at DESC
`)

const getOnboardingCompletedStmt = db.prepare(`
  SELECT value FROM user_settings WHERE key = 'onboarding_completed'
`)

const setOnboardingCompletedStmt = db.prepare(`
  INSERT INTO user_settings (key, value) VALUES ('onboarding_completed', '1')
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
  ipcMain.handle('db:getLatestSessionId', (): string | null => {
    const row = getLatestSessionId.get() as { id: string } | undefined
    return row?.id ?? null
  })

  ipcMain.handle('db:getToolEvents', (_event, sessionId: string): ToolEvent[] => {
    return getToolEventsBySession.all({ session_id: sessionId }) as ToolEvent[]
  })

  ipcMain.handle('db:getPrompts', (_event, sessionId: string): Prompt[] => {
    return getPromptsBySession.all({ session_id: sessionId }) as Prompt[]
  })

  ipcMain.handle('db:getAssistantNotes', (_event, sessionId: string): AssistantNote[] => {
    return getAssistantNotesBySession.all({ session_id: sessionId }) as AssistantNote[]
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

  ipcMain.handle(
    'db:getStepExplanations',
    (_event, sessionId: string, skillLevel: SkillLevel): AiExplanation[] => {
      return getStepExplanationsBySession.all({
        session_id: sessionId,
        skill_level: skillLevel
      }) as AiExplanation[]
    }
  )

  ipcMain.handle('db:getCodeUnits', (): CodeUnit[] => {
    return getCodeUnitsStmt.all() as CodeUnit[]
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

  ipcMain.handle('db:getCodeUnitEdges', (): CodeUnitEdge[] => {
    return getAllCodeUnitEdges.all() as CodeUnitEdge[]
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
    async (_event, sessionId: string, question: string, skillLevel: SkillLevel): Promise<string> => {
      const context = loadContextBundle(sessionId)
      if (!context) return '세션 정보를 찾을 수 없습니다.'
      return aiProvider.answerQuestion(question, context, skillLevel)
    }
  )
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
  pipeline?.stop() // 파이프라인이 자기 DB 커넥션을 닫는다 — 우리 커넥션 close보다 먼저
  db.close()
  if (process.platform !== 'darwin') app.quit()
})
