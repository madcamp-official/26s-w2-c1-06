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

// CREATE TABLE IF NOT EXISTS는 이미 만들어진 테이블에 새 컬럼을 추가해주지 않는다.
// db/*.db는 gitignore 대상이라 스키마가 바뀔 때마다 지우고 새로 만들어도 되지만,
// 로컬에 쌓인 세션 데이터를 보존하려면 컬럼 단위로 있는지 확인 후 없으면 ALTER한다.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'ai_explanations', column: 'status', ddl: `ALTER TABLE ai_explanations ADD COLUMN status TEXT DEFAULT 'success'` },
  { table: 'code_unit_versions', column: 'step_id', ddl: `ALTER TABLE code_unit_versions ADD COLUMN step_id TEXT REFERENCES assistant_notes(id)` }
]

function migrateColumns(db: Database.Database): void {
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    const tableExists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table)
    if (!tableExists) continue

    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!columns.some((c) => c.name === column)) db.exec(ddl)
  }
}

export function applySchema(db: Database.Database, schemaPath: string): void {
  db.exec(readFileSync(schemaPath, 'utf-8'))
  migrateColumns(db)
}
