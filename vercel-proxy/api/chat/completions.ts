// Cloudflare Workers 프록시가 OpenAI의 리전/IP 차단에 걸려서(같은 키로 직접 호출은
// 성공, Worker 경유는 unsupported_country_region_territory로 실패 — 확인 완료) Vercel의
// Node.js 서버리스 함수(AWS Lambda 기반 고정 리전, Edge Functions 아님)로 옮겼다.
// 배포된 factcoding 앱은 진짜 OPENAI_API_KEY를 절대 갖지 않는다 — 이 함수 안에서만
// process.env로 읽는다(Vercel 프로젝트 환경변수, 로컬 저장 없음). 앱은 PROXY_TOKEN이라는
// 별도의 "새도 되는" 값만 갖고 있고, 그 값으로만 이 프록시를 거쳐 OpenAI를 호출한다.

const OPENAI_UPSTREAM_URL = 'https://api.openai.com/v1/chat/completions'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'method not allowed' } })
    return
  }

  const auth = req.headers.authorization as string | undefined
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
  if (!token || token !== process.env.PROXY_TOKEN) {
    res.status(401).json({ error: { message: 'invalid proxy token' } })
    return
  }

  // openai npm SDK가 실제로 쓰는 엔드포인트는 이거 하나뿐이다(스트리밍도 안 씀,
  // OpenAIProvider.generateText 참조) — 요청 바디를 그대로 넘기고 인증 헤더만
  // 진짜 키로 바꿔치기한다.
  const upstream = await fetch(OPENAI_UPSTREAM_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req.body)
  })

  // 성공/실패 상관없이 상태코드+바디를 그대로 되돌린다 — openai SDK는 상태코드만 보고
  // 자기 에러 클래스를 구성하므로 에러 바디 형식을 완벽히 흉내낼 필요가 없다.
  const text = await upstream.text()
  res.status(upstream.status)
  res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
  res.send(text)
}
