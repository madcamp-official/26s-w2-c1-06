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
}
