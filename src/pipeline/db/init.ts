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
  return db;
}
