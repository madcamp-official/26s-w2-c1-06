interface ProgressTurtleBarProps {
  percent: number
  justCompleted: boolean
  cycleNumber: number | null
  stepsInCycle: number
  cycleSize: number
  // 이번 사이클에서 실패로 판정된 스텝이 완료됐던 percent 위치들 — 트랙 위에
  // 빨간 눈금으로 찍어 "이 구간에서 한 번 삐끗했다"를 로딩바 자체에서 보여준다
  // (SPEC 패치 v2 #5). 퍼센트는 계속 증가시키되(막힘 없는 진행감 유지), 실패 지점만
  // 시각적으로 구분한다.
  failMarks: number[]
}

// 거북이가 기어가는 진행바 — 캐스터/TTS 없이 "지금 스텝이 몇 % 진행됐는지"를
// 눈으로 보여주는 대체 표현. 사이클(고정 스텝 수) 기준이라 100%는 "완료"가
// 아니라 "한 바퀴 다 돌았다"는 뜻 — 결승선 통과 모션 후 다음 바퀴로 리셋된다.
export function ProgressTurtleBar({
  percent,
  justCompleted,
  cycleNumber,
  stepsInCycle,
  cycleSize,
  failMarks
}: ProgressTurtleBarProps) {
  const clamped = Math.max(0, Math.min(100, percent))

  return (
    <div className="turtle-bar">
      <div className="turtle-bar__track">
        <div className="turtle-bar__fill" style={{ width: `${clamped}%` }} />
        {failMarks.map((markPercent, i) => (
          <div
            key={`${markPercent}-${i}`}
            className="turtle-bar__fail-mark"
            style={{ left: `${Math.max(0, Math.min(100, markPercent))}%` }}
          />
        ))}
        <div
          className={`turtle-bar__turtle ${justCompleted ? 'turtle-bar__turtle--finish' : ''}`}
          style={{ left: `${clamped}%` }}
        >
          🐢
        </div>
      </div>
      <span className="turtle-bar__meta">
        {cycleNumber !== null && (
          <span className="turtle-bar__cycle">
            {stepsInCycle}/{cycleSize}단계 · 사이클 {cycleNumber}
          </span>
        )}
        <span className="turtle-bar__percent">{clamped}%</span>
      </span>
    </div>
  )
}
