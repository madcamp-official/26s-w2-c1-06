import { app } from 'electron'
import type { AIProvider } from './types'
import { GeminiKeyPool } from './key-pool/GeminiKeyPool'
import { GeminiProvider } from './gemini-provider/GeminiProvider'
import { OpenAIProvider } from './openai-provider/OpenAIProvider'
import { MockAIProvider } from './mock-provider/MockAIProvider'

// 패키징된(배포된) 앱은 진짜 OpenAI 키를 절대 갖고 있지 않는다 — asar를 풀거나 strings로
// 뒤지면 바로 나오는 값이라, 새어나가면 실과금으로 이어진다. 대신 이 프록시 토큰/URL로
// Vercel 서버리스 함수(vercel-proxy/api/chat/completions.ts가 실제 프록시 구현)를 거쳐서만
// OpenAI를 호출한다. 이 값들은 진짜 OpenAI 키보다는 훨씬 "새도 되는" 값이지만(이 프록시의
// Chat Completions 엔드포인트 하나로만 접근 가능) — 이 리포가 public이라 소스에 리터럴로
// 박아두면 GitHub를 스캔하는 봇에 바로 노출된다. `.env`(dev용, 진짜 OpenAI 키가 들어있음)와
// 완전히 분리된 `.env.production`(gitignore 대상, 배포 빌드에만 번들됨)에서 읽는다 —
// `.env.production.example` 참조.
// (처음엔 Cloudflare Workers로 만들었는데, 같은 키로 직접 호출은 성공하고 Worker를
// 거치면 매번 "unsupported_country_region_territory"로 실패하는 게 확인돼 — Cloudflare
// Workers의 공유 엣지 IP를 OpenAI가 차단하는 것으로 추정 — Vercel의 고정 리전 Node.js
// 서버리스 함수로 옮겼다. openai SDK가 항상 `{baseURL}/chat/completions`로 요청을
// 보내므로, PACKAGED_PROXY_URL은 반드시 `/api`로 끝나야 한다(엔드포인트 파일 경로가
// `vercel-proxy/api/chat/completions.ts` → `/api/chat/completions`).
const PACKAGED_PROXY_URL = process.env.PACKAGED_PROXY_URL
const PACKAGED_PROXY_TOKEN = process.env.PACKAGED_PROXY_TOKEN

// Gemini도 OpenAI와 똑같은 이유로 패키징된 빌드에 진짜 키를 안 담는다 — 무료 티어라
// 새도 금전 피해는 없지만, 새면 구글이 어뷰징으로 보고 그 프로젝트/키를 정지시킬 수
// 있어 "완전 무해"는 아니다. @google/genai SDK는 OpenAI SDK와 인증 방식이 달라서
// (Authorization 헤더가 아니라 x-goog-api-key 헤더, 그리고 baseURL 뒤에 붙는 경로가
// SDK 내부적으로 결정됨) OpenAI 때처럼 baseURL만 바꿔치기하면 끝나는 게 아니라, 프록시
// 쪽(vercel-proxy/api/gemini/[...path].ts)이 경로를 통째로 그대로 포워드하는 범용
// 프록시로 따로 구현돼 있다. GeminiKeyPool의 2키 라운드로빈/쿼터 폴백 로직은 그대로
// 살리기 위해 진짜 키 2개 대신 프록시 전용 토큰 2개를 등록해서 쓴다(각 토큰이 서버
// 쪽에서 대응하는 진짜 키로 치환됨).
const PACKAGED_GEMINI_PROXY_URL = process.env.PACKAGED_GEMINI_PROXY_URL
const PACKAGED_GEMINI_PROXY_TOKENS = [
  process.env.PACKAGED_GEMINI_PROXY_TOKEN_A,
  process.env.PACKAGED_GEMINI_PROXY_TOKEN_B
].filter((token): token is string => Boolean(token))

// 패키징된 빌드는 dev와 같은 순서(OpenAI → Gemini → Mock)의 폴백 체인을 쓰되, 둘 다
// 항상 프록시를 거친다(진짜 키를 하나도 안 가짐). dev 빌드는 기존 그대로 OPENAI_API_KEY/
// GEMINI_KEY_A/B를 직접 쓴다.
export function createAIProvider(): AIProvider {
  if (app.isPackaged) {
    if (PACKAGED_PROXY_URL && PACKAGED_PROXY_TOKEN) {
      return new OpenAIProvider(PACKAGED_PROXY_TOKEN, PACKAGED_PROXY_URL)
    }

    if (PACKAGED_GEMINI_PROXY_URL && PACKAGED_GEMINI_PROXY_TOKENS.length > 0) {
      return new GeminiProvider(new GeminiKeyPool(PACKAGED_GEMINI_PROXY_TOKENS), PACKAGED_GEMINI_PROXY_URL)
    }

    console.warn(
      '[ai] PACKAGED_PROXY_*도 PACKAGED_GEMINI_PROXY_*도 없음(.env.production) — MockAIProvider로 대체, 네트워크 호출 없음'
    )
    return new MockAIProvider()
  }

  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider(process.env.OPENAI_API_KEY)
  }

  const keys = [process.env.GEMINI_KEY_A, process.env.GEMINI_KEY_B].filter(
    (key): key is string => Boolean(key)
  )
  if (keys.length === 0) {
    console.warn(
      '[ai] OPENAI_API_KEY/GEMINI_KEY_A/B not set (.env) — falling back to MockAIProvider, no network calls made'
    )
    return new MockAIProvider()
  }

  return new GeminiProvider(new GeminiKeyPool(keys))
}
