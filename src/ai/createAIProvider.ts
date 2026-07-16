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
// 주의: 이 프록시 값들은 반드시 createAIProvider() **함수 안에서** process.env로 읽어야
// 한다. 모듈 최상단 const로 캡처하면 안 된다 — 이 모듈은 index.ts가 import하는 순간
// (그 파일의 dotenv `loadEnv()`가 실행되기 *전에*, ES import는 호이스팅되므로) 평가되어,
// 그 시점엔 .env.production이 아직 로드되지 않아 값이 전부 undefined로 굳는다. 그러면
// 패키징된 앱이 프록시 설정을 못 찾고 MockAIProvider로 폴백해 "AI 연동이 안 되는" 것처럼
// 보인다(dev 경로가 멀쩡했던 건 아래에서 OPENAI_API_KEY를 호출 시점에 읽기 때문). 함수
// 안에서 읽으면 loadEnv() 이후(app 준비 시점 createAIProvider 호출)라 값이 채워져 있다.

// 패키징된 빌드는 dev와 같은 순서(OpenAI → Gemini → Mock)의 폴백 체인을 쓰되, 둘 다
// 항상 프록시를 거친다(진짜 키를 하나도 안 가짐). dev 빌드는 기존 그대로 OPENAI_API_KEY/
// GEMINI_KEY_A/B를 직접 쓴다.
export function createAIProvider(): AIProvider {
  // 패키징된(배포된) 앱은 진짜 OpenAI 키를 절대 갖고 있지 않는다 — asar를 풀거나 strings로
  // 뒤지면 바로 나오는 값이라, 새어나가면 실과금으로 이어진다. 대신 이 프록시 토큰/URL로
  // Vercel 서버리스 함수(vercel-proxy/api/chat/completions.ts가 실제 프록시 구현)를 거쳐서만
  // OpenAI를 호출한다. 값은 .env.production(gitignore, 배포 빌드에만 번들)에서 온다 —
  // .env.production.example 참조. openai SDK가 항상 `{baseURL}/chat/completions`로 요청을
  // 보내므로 PACKAGED_PROXY_URL은 반드시 `/api`로 끝나야 한다.
  const PACKAGED_PROXY_URL = process.env.PACKAGED_PROXY_URL
  const PACKAGED_PROXY_TOKEN = process.env.PACKAGED_PROXY_TOKEN

  // Gemini도 OpenAI와 똑같은 이유로 패키징된 빌드에 진짜 키를 안 담는다. @google/genai SDK는
  // 인증 방식이 달라(x-goog-api-key 헤더, 경로도 SDK 내부 결정) 프록시 쪽
  // (vercel-proxy/api/gemini/[...path].ts)이 경로를 통째로 포워드하는 범용 프록시로 따로
  // 구현돼 있다. GeminiKeyPool의 2키 라운드로빈/쿼터 폴백을 살리기 위해 진짜 키 2개 대신
  // 프록시 전용 토큰 2개를 등록해 쓴다(서버 쪽에서 대응하는 진짜 키로 치환).
  const PACKAGED_GEMINI_PROXY_URL = process.env.PACKAGED_GEMINI_PROXY_URL
  const PACKAGED_GEMINI_PROXY_TOKENS = [
    process.env.PACKAGED_GEMINI_PROXY_TOKEN_A,
    process.env.PACKAGED_GEMINI_PROXY_TOKEN_B
  ].filter((token): token is string => Boolean(token))

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
