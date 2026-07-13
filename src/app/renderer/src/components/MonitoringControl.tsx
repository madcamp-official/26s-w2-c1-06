interface MonitoringControlProps {
  isMonitoring: boolean
  pending: boolean
  onStart: () => void
  onComplete: () => void
}

// 여러 AI 에이전트/프로젝트를 오갈 수 있는 사용자를 위해, 앱이 떠 있다고 항상
// 관찰 중인 게 아니라 이 버튼을 눌러야만 관찰이 켜지고 꺼진다. "완료"는 지금 보고
// 있는 세션을 종료 처리해 강의노트 자동 합성을 트리거한다(SPEC 4.3.2).
export function MonitoringControl({ isMonitoring, pending, onStart, onComplete }: MonitoringControlProps) {
  if (isMonitoring) {
    return (
      <div className="monitoring-control">
        <span className="monitoring-control__status monitoring-control__status--active">● 모니터링 중</span>
        <button type="button" className="monitoring-control__btn" disabled={pending} onClick={onComplete}>
          {pending ? '완료 처리 중…' : '완료'}
        </button>
      </div>
    )
  }

  return (
    <div className="monitoring-control">
      <span className="monitoring-control__status">모니터링 꺼짐</span>
      <button
        type="button"
        className="monitoring-control__btn monitoring-control__btn--primary"
        disabled={pending}
        onClick={onStart}
      >
        {pending ? '시작하는 중…' : '시작하기'}
      </button>
    </div>
  )
}
