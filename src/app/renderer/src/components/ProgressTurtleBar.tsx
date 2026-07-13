interface ProgressTurtleBarProps {
  percent: number
  justCompleted: boolean
}

// 거북이가 기어가는 진행바 — 캐스터/TTS 없이 "지금 스텝이 몇 % 진행됐는지"를
// 눈으로 보여주는 대체 표현. 사이클(고정 스텝 수) 기준이라 100%는 "완료"가
// 아니라 "한 바퀴 다 돌았다"는 뜻 — 결승선 통과 모션 후 다음 바퀴로 리셋된다.
export function ProgressTurtleBar({ percent, justCompleted }: ProgressTurtleBarProps) {
  const clamped = Math.max(0, Math.min(100, percent))

  return (
    <div className="turtle-bar">
      <div className="turtle-bar__track">
        <div className="turtle-bar__fill" style={{ width: `${clamped}%` }} />
        <div
          className={`turtle-bar__turtle ${justCompleted ? 'turtle-bar__turtle--finish' : ''}`}
          style={{ left: `${clamped}%` }}
        >
          🐢
        </div>
      </div>
      <span className="turtle-bar__percent">{clamped}%</span>
    </div>
  )
}
