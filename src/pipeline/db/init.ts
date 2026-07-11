import Database from 'better-sqlite3';
import fs from 'node:fs';
import { SCHEMA_PATH } from '../config.js';

export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  return db;
}
