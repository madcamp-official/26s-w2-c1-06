import type { LiveStatus } from '@shared/progress'

interface LiveStatusLineProps {
  status: LiveStatus
}

// 완료된 스텝만 카드로 보이던 기존 진행상황 패널에는 "지금 뭘 하는 중인지"가
// 어디에도 없었다(SPEC 패치 v2 #1) — Gemini 요약을 기다리지 않는 로컬 규칙 텍스트를
// 거북이 바로 위에 한 줄로 붙여 라이브 상태를 보여준다.
export function LiveStatusLine({ status }: LiveStatusLineProps) {
  return (
    <p className={`live-status ${status.idle ? 'live-status--idle' : ''}`}>
      <span className="live-status__dot" />
      {status.idle ? '대기 중…' : `지금 하는 중: ${status.text}`}
    </p>
  )
}
