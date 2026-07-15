// GeminiProvider(@google/genai SDK)는 OpenAI SDK와 달리 인증을 `x-goog-api-key`
// 헤더로 보내고(쿼리 파라미터 아님), generateContent 외에도 SDK 버전/설정에 따라
// 실제로 치는 경로가 조금씩 다를 수 있다 — 그래서 이 프록시는 특정 엔드포인트 하나만
// 알고 있는 대신, `/api/gemini/` 뒤에 오는 경로+쿼리스트링을 그대로
// generativelanguage.googleapis.com에 포워드하는 범용 통과형으로 만들었다(어떤
// 경로가 오든 안전 — GeminiProvider가 이 baseUrl 아래로만 요청을 보내는 한 항상 맞다).
//
// GeminiKeyPool이 두 키(GEMINI_KEY_A/B)를 라운드로빈/쿼터 폴백하는 기존 로직을 그대로
// 살리기 위해, 앱은 진짜 키 대신 이 프록시 전용 토큰 두 개(PROXY_GEMINI_TOKEN_A/B)를
// 들고 있고, 이 프록시가 어느 토큰으로 왔는지 보고 대응하는 진짜 키로 바꿔친다.

const UPSTREAM_HOST = 'https://generativelanguage.googleapis.com'

function realKeyForToken(token: string | undefined): string | undefined {
  if (!token) return undefined
  if (token === process.env.PROXY_GEMINI_TOKEN_A) return process.env.GEMINI_KEY_A
  if (token === process.env.PROXY_GEMINI_TOKEN_B) return process.env.GEMINI_KEY_B
  return undefined
}

export default async function handler(req: any, res: any) {
  const proxyToken = req.headers['x-goog-api-key'] as string | undefined
  const realKey = realKeyForToken(proxyToken)
  if (!realKey) {
    res.status(401).json({ error: { message: 'invalid proxy token' } })
    return
  }

  // req.url은 "/api/gemini/..." 형태의 원본 경로+쿼리스트링을 그대로 담고 있다 —
  // 딱 이 라우트 접두사만 잘라내면 나머지는 손댈 필요 없이 그대로 업스트림 경로가 된다.
  const upstreamPath = (req.url as string).replace(/^\/api\/gemini/, '')

  const upstream = await fetch(`${UPSTREAM_HOST}${upstreamPath}`, {
    method: req.method,
    headers: {
      'x-goog-api-key': realKey,
      'Content-Type': req.headers['content-type'] ?? 'application/json'
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body)
  })

  const text = await upstream.text()
  res.status(upstream.status)
  res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
  res.send(text)
}
