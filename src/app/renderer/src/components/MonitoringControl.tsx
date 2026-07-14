import { Activity, CheckCheck, Play } from 'lucide-react'

interface MonitoringControlProps {
  isMonitoring: boolean
  pending: boolean
  disabled?: boolean
  disabledReason?: string
  onStart: () => void
  onComplete: () => void
}

// 여러 AI 에이전트/프로젝트를 오갈 수 있는 사용자를 위해, 앱이 떠 있다고 항상
// 관찰 중인 게 아니라 이 버튼을 눌러야만 관찰이 켜지고 꺼진다. "완료"는 지금 보고
// 있는 세션을 종료 처리해 강의노트 자동 합성을 트리거한다(SPEC 4.3.2).
// disabled는 프로젝트 미선택(project 탭에서 아직 아무것도 안 고름) 또는 다른
// 프로젝트를 이미 관찰 중인 경우 — disabledReason으로 이유를 안내한다.
export function MonitoringControl({
  isMonitoring,
  pending,
  disabled = false,
  disabledReason,
  onStart,
  onComplete
}: MonitoringControlProps) {
  if (isMonitoring) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-2 rounded-lg border border-[#326055] bg-[#11231f] px-3 py-2 font-mono text-[10px] font-medium tracking-[0.1em] text-[#91dfbf] sm:flex">
          <Activity size={13} /> LIVE
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={onComplete}
          className="flex items-center gap-2 rounded-lg bg-[#9fe2c4] px-3.5 py-2 text-[12px] font-semibold text-[#0b2219] transition hover:bg-[#b4edcf] disabled:opacity-50"
        >
          <CheckCheck size={15} />
          {pending ? '완료 처리 중…' : '완료'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2" title={disabled ? disabledReason : undefined}>
      <span className="hidden rounded-lg border border-border bg-[#111b24] px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-[#7d93a0] sm:block">
        OFF
      </span>
      <button
        type="button"
        disabled={pending || disabled}
        onClick={onStart}
        className="flex items-center gap-2 rounded-lg bg-[#9fe2c4] px-3.5 py-2 text-[12px] font-semibold text-[#0b2219] transition hover:bg-[#b4edcf] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Play size={15} />
        {pending ? '시작하는 중…' : '시작하기'}
      </button>
    </div>
  )
}
