import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

// __dirname/import.meta.url는 vite가 이 모듈을 번들에 인라인하는 순간
// out/main처럼 엉뚱한 산출물 경로를 가리키게 되므로 사용하지 않는다.
// 경로는 항상 호출부(스크립트는 process.cwd(), Electron은 app.getAppPath())가 정해서 넘긴다.

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  return db
}

export function applySchema(db: Database.Database, schemaPath: string): void {
  db.exec(readFileSync(schemaPath, 'utf-8'))
  applyMigrations(db)
}

// schema.sql은 CREATE TABLE IF NOT EXISTS라 새 테이블은 자동으로 생기지만, 이미 존재하는
// 테이블에 컬럼을 추가하는 건 반영되지 않는다(SQLite는 ALTER TABLE ADD COLUMN에
// IF NOT EXISTS를 지원하지 않는다) — 그래서 이미 만들어진 로컬 DB에도 실시간 진행
// 로그(step-worker.ts)에 필요한 컬럼이 채워지도록 컬럼 존재 여부를 직접 확인하고
// 없을 때만 ALTER한다. 매 앱 부팅(db:init 포함)마다 실행돼도 안전하다.
function applyMigrations(db: Database.Database): void {
  addColumnIfMissing(db, 'tool_events', 'result_content', 'TEXT')
  addColumnIfMissing(db, 'code_unit_versions', 'step_id', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'key_code_snippet', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'key_code_lang', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'key_code_file', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'key_code_other_files', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'key_code_explanation', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'key_code_importance', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'key_code_application', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'error_detail', 'TEXT')
  addColumnIfMissing(db, 'ai_explanations', 'status', 'TEXT')
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}
