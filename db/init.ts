// db/schema.sql을 로드해 db/factcoding.db를 초기화한다.
// 모든 CREATE TABLE이 IF NOT EXISTS이므로 반복 실행해도 안전하다.
// 실행: npm run db:init

import { applySchema, openDatabase } from './connection.js'
import { DEFAULT_DB_PATH, SCHEMA_PATH } from './paths.js'

const db = openDatabase(DEFAULT_DB_PATH)
applySchema(db, SCHEMA_PATH)
db.close()

console.log(`[db:init] schema applied → ${DEFAULT_DB_PATH}`)
