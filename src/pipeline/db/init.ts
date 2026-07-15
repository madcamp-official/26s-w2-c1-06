import Database from 'better-sqlite3';
import fs from 'node:fs';

// schemaPath는 호출부가 넘긴다 — config.ts의 SCHEMA_PATH를 여기서 import하면
// import.meta.url 기반 계산이 Electron main 번들(CJS)에 끌려 들어가 깨진다.
export function initDb(dbPath: string, schemaPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  // schema.sql은 CREATE TABLE IF NOT EXISTS라 기존 DB에 새로 추가된 컬럼이 반영되지
  // 않는다 — Electron 경로는 db/connection.ts의 applyMigrations가 처리하지만, CLI로
  // 파이프라인만 단독 실행하는 경로는 여기가 유일한 초기화 지점이라 같은 마이그레이션을
  // 최소한으로 반복한다(파이프라인이 실제로 쓰는 컬럼만).
  addColumnIfMissing(db, 'prompts', 'completed_at', 'DATETIME');
  addColumnIfMissing(db, 'prompts', 'pending_plan_source_text', 'TEXT');
  addColumnIfMissing(db, 'sessions', 'completed_at', 'DATETIME');
  addColumnIfMissing(db, 'sessions', 'hooks_alive', 'INTEGER NOT NULL DEFAULT 0');
  return db;
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
