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
  MatchStats,
  PipelineHandle,
  Prompt,
  Session,
  SkillLevel,
  ToolEvent,
  UnitMatchStat
} from '@shared/types'
import type { LiveStatus, ProgressState, ProgressUpdate } from '@shared/progress'
import type { QuizLesson } from '@shared/quiz'
import { startPipeline } from '@pipeline/index'
import { startProgressWorker } from './progress-worker'
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

function broadcastProgress(update: ProgressUpdate): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('progress:update', update)
  }
}

function broadcastLiveStatus(status: LiveStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('progress:live-status', status)
  }
}

const progressWorker = startProgressWorker(db, aiProvider, {
  onUpdate: broadcastProgress,
  onLiveUpdate: broadcastLiveStatus
})
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

const getLatestSessionStmt = db.prepare(`
  SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1
`)

const getMatchStatsStmt = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM tool_events WHERE session_id = @session_id AND status = 'success') AS success,
    (SELECT COUNT(*) FROM tool_events WHERE session_id = @session_id AND status = 'error') AS error,
    (SELECT COUNT(*) FROM tool_events WHERE session_id = @session_id AND status = 'pending') AS pending,
    (
      SELECT COUNT(*) FROM code_unit_versions v
      LEFT JOIN tool_events te ON te.id = v.tool_event_id
      LEFT JOIN prompts p ON p.id = v.prompt_id
      WHERE v.change_type = 'created'
        AND (te.session_id = @session_id OR p.session_id = @session_id)
    ) AS created
`)

const getCreatedToolEventIdsStmt = db.prepare(`
  SELECT DISTINCT v.tool_event_id AS id
  FROM code_unit_versions v
  JOIN tool_events te ON te.id = v.tool_event_id
  WHERE v.change_type = 'created'
    AND te.session_id = @session_id
    AND v.tool_event_id IS NOT NULL
`)

const getUnitMatchStatsStmt = db.prepare(`
  SELECT
    u.id AS unitId,
    COUNT(v.id) AS versionCount,
    (
      SELECT v2.change_type FROM code_unit_versions v2
      WHERE v2.unit_id = u.id
      ORDER BY v2.version_no DESC LIMIT 1
    ) AS latestChangeType,
    (
      SELECT v3.step_id FROM code_unit_versions v3
      WHERE v3.unit_id = u.id
      ORDER BY v3.version_no DESC LIMIT 1
    ) AS latestStepId,
    u.last_seen_at AS lastSeenAt
  FROM code_units u
  LEFT JOIN code_unit_versions v ON v.unit_id = u.id
  GROUP BY u.id
  ORDER BY u.file_path ASC, u.unit_name ASC
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

// 복습 퀴즈 소재: 이 세션에서 실제로 바뀐 코드 유닛 최근 순 N개. getMatchStatsStmt의
// created 서브쿼리와 동일한 join 패턴(tool_event 경유/prompt 직결 양쪽 다 커버)을 쓴다.
const QUIZ_VERSION_LIMIT = 8
const getRecentVersionsForQuizStmt = db.prepare(`
  SELECT v.*, u.unit_name, u.unit_type, u.file_path
  FROM code_unit_versions v
  JOIN code_units u ON u.id = v.unit_id
  LEFT JOIN tool_events te ON te.id = v.tool_event_id
  LEFT JOIN prompts p ON p.id = v.prompt_id
  WHERE te.session_id = @session_id OR p.session_id = @session_id
  ORDER BY v.created_at DESC
  LIMIT ${QUIZ_VERSION_LIMIT}
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

// progress-worker의 progress:update는 push라 렌더러가 아직 마운트되기 전에 끝난
// 스텝은 유실될 수 있다(Electron IPC는 버퍼링 안 함) — 렌더러 마운트 시 이 조회로
// "지금까지 쌓인 상태"를 한 번 당겨와 초기화한다(useProgress 참고).
// 6에서 늘림: StepLog의 "이전 진행상황 더 보기" 접기/펼치기(SPEC 패치 v2 #7)가
// 이 캐치업 조회로 채워진 history를 그대로 쓰므로, 접힌 카드까지 한 번에 갖고 있어야
// 별도 IPC 없이 순수 클라이언트 렌더링만으로 펼치기가 동작한다.
const PROGRESS_HISTORY_LIMIT = 100
const getRecentStepProgressStmt = db.prepare(`
  SELECT target_id, summary, key_code_snippet, key_code_lang, key_code_file, key_code_other_files,
         key_code_explanation, key_code_importance, key_code_application, error_detail,
         step_percent, status
  FROM ai_explanations
  WHERE target_type = 'step' AND step_percent IS NOT NULL
  ORDER BY created_at DESC
  LIMIT ${PROGRESS_HISTORY_LIMIT}
`)

const upsertExplanationStmt = db.prepare(`
  INSERT INTO ai_explanations (
    id, target_type, target_id, skill_level, summary,
    key_code_snippet, key_code_lang, key_code_file, key_code_other_files,
    key_code_explanation, key_code_importance, key_code_application,
    error_detail, step_percent, status, concept_tags, created_at
  )
  VALUES (
    @id, @target_type, @target_id, @skill_level, @summary,
    @key_code_snippet, @key_code_lang, @key_code_file, @key_code_other_files,
    @key_code_explanation, @key_code_importance, @key_code_application,
    @error_detail, @step_percent, @status, @concept_tags, @created_at
  )
  ON CONFLICT(target_type, target_id, skill_level) DO UPDATE SET
    summary = excluded.summary,
    key_code_snippet = excluded.key_code_snippet,
    key_code_lang = excluded.key_code_lang,
    key_code_file = excluded.key_code_file,
    key_code_other_files = excluded.key_code_other_files,
    key_code_explanation = excluded.key_code_explanation,
    key_code_importance = excluded.key_code_importance,
    key_code_application = excluded.key_code_application,
    error_detail = excluded.error_detail,
    step_percent = excluded.step_percent,
    status = excluded.status,
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

  ipcMain.handle('db:getLatestSession', (): Session | null => {
    return (getLatestSessionStmt.get() as Session | undefined) ?? null
  })

  ipcMain.handle('db:getMatchStats', (_event, sessionId: string): MatchStats => {
    const row = getMatchStatsStmt.get({ session_id: sessionId }) as MatchStats | undefined
    return row ?? { success: 0, error: 0, pending: 0, created: 0 }
  })

  ipcMain.handle('db:getUnitMatchStats', (): UnitMatchStat[] => {
    return getUnitMatchStatsStmt.all() as UnitMatchStat[]
  })

  ipcMain.handle('db:getProgressState', (): ProgressState => {
    const rows = getRecentStepProgressStmt.all() as {
      target_id: string
      summary: string
      key_code_snippet: string | null
      key_code_lang: string | null
      key_code_file: string | null
      key_code_other_files: string | null
      key_code_explanation: string | null
      key_code_importance: string | null
      key_code_application: string | null
      error_detail: string | null
      step_percent: number
      status: 'success' | 'failed' | null
    }[]
    return {
      percent: rows[0]?.step_percent ?? 0,
      history: rows.map((row) => ({
        stepId: row.target_id,
        summary: row.summary,
        keyCode:
          row.key_code_snippet && row.key_code_lang && row.key_code_file &&
          row.key_code_explanation && row.key_code_importance && row.key_code_application
            ? {
                snippet: row.key_code_snippet,
                lang: row.key_code_lang,
                filePath: row.key_code_file,
                otherFiles: row.key_code_other_files ? JSON.parse(row.key_code_other_files) : [],
                explanation: row.key_code_explanation,
                importance: row.key_code_importance,
                application: row.key_code_application
              }
            : null,
        errorDetail: row.error_detail,
        status: row.status ?? 'success'
      }))
    }
  })

  // progress:live-status도 push라 렌더러 마운트 전에 발생한 상태 변화(특히 이 워커가
  // BrowserWindow 생성 전에 쏘는 최초 tick)는 유실될 수 있다 — useLiveStatus 마운트 시
  // 한 번 당겨와 초기화한다(getProgressState와 동일한 캐치업 패턴).
  ipcMain.handle('db:getLiveStatus', (): LiveStatus => {
    return progressWorker.getLiveStatus()
  })

  ipcMain.handle('db:getCreatedToolEventIds', (_event, sessionId: string): string[] => {
    return (getCreatedToolEventIdsStmt.all({ session_id: sessionId }) as { id: string }[]).map(
      (row) => row.id
    )
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
        summary: caption.caption,
        key_code_snippet: null,
        key_code_lang: null,
        key_code_file: null,
        key_code_other_files: null,
        key_code_explanation: null,
        key_code_importance: null,
        key_code_application: null,
        error_detail: null,
        step_percent: null,
        status: 'success',
        concept_tags: JSON.stringify(caption.conceptTags),
        created_at: new Date().toISOString()
      }
      upsertExplanationStmt.run(row)

      return row
    }
  )

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

  // useQna와 같은 이유로 캐시하지 않는다(SPEC 패치 v3) — 매번 새로 생성해야 "같은 문제
  // 반복" 없이 게임성이 유지된다. 바뀐 코드가 없으면 빈 배열(렌더러가 안내 문구 표시).
  ipcMain.handle(
    'db:generateQuiz',
    async (_event, sessionId: string, skillLevel: SkillLevel): Promise<QuizLesson[]> => {
      const versions = getRecentVersionsForQuizStmt.all({
        session_id: sessionId
      }) as CodeUnitVersionWithUnit[]
      if (versions.length === 0) return []
      return aiProvider.generateQuiz(versions, skillLevel)
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
  progressWorker.stop()
  stopLectureNoteWorker()
  pipeline?.stop()
  db.close()
  if (process.platform !== 'darwin') app.quit()
})
