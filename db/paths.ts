import { join } from 'node:path'

// db:init/db:seed는 항상 `npm run`으로 저장소 루트에서 실행되므로 cwd 기준으로 계산한다.
// (Electron main 프로세스는 app.getAppPath() 기준으로 별도 계산 — src/app/main/index.ts 참고)
export const SCHEMA_PATH = join(process.cwd(), 'db', 'schema.sql')
export const DEFAULT_DB_PATH = join(process.cwd(), 'db', 'factcoding.db')
