import { CheckCheck, Play, Trash2 } from 'lucide-react'

interface MonitoringControlProps {
  isMonitoring: boolean
  pending: boolean
  disabled?: boolean
  disabledReason?: string
  onStart: () => void
  onComplete: () => void
  onDelete: () => void
  deleting: boolean
  deleteDisabled?: boolean
  deleteDisabledReason?: string
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
  onComplete,
  onDelete,
  deleting,
  deleteDisabled = false,
  deleteDisabledReason
}: MonitoringControlProps) {
  // 예전엔 여기 OFF/LIVE 상태 배지가 있었는데, 프로젝트 헤더의 점(●) +
  // "관찰 중"/"관찰 꺼짐" 텍스트와 내용이 겹쳐서 프로젝트 삭제 버튼으로 대체했다.
  // 지금 관찰 중인 프로젝트는 지울 수 없다(deleteDisabled, 이유는 title로 안내).
  const deleteButton = (
    <button
      type="button"
      disabled={deleting || deleteDisabled}
      onClick={onDelete}
      title={deleteDisabled ? deleteDisabledReason : '프로젝트 삭제'}
      className="hidden items-center gap-2 rounded-lg border border-[#e7c3bd] bg-[#fcf1ef] px-3 py-2 font-mono text-[10px] font-medium tracking-[0.1em] text-[#a9463a] transition hover:bg-[#f8ded8] disabled:cursor-not-allowed disabled:opacity-50 sm:flex"
    >
      <Trash2 size={13} />
      {deleting ? '삭제 중…' : '삭제'}
    </button>
  )

  if (isMonitoring) {
    return (
      <div className="flex items-center gap-2">
        {deleteButton}
        <button
          type="button"
          disabled={pending}
          onClick={onComplete}
          className="flex items-center gap-2 rounded-lg bg-[#285c52] px-3.5 py-2 text-[12px] font-semibold text-[#ffffff] transition hover:bg-[#1f4a41] disabled:opacity-50"
        >
          <CheckCheck size={15} />
          {pending ? '완료 처리 중…' : '완료'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {deleteButton}
      <div title={disabled ? disabledReason : undefined}>
        <button
          type="button"
          disabled={pending || disabled}
          onClick={onStart}
          className="flex items-center gap-2 rounded-lg bg-[#285c52] px-3.5 py-2 text-[12px] font-semibold text-[#ffffff] transition hover:bg-[#1f4a41] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={15} />
          {pending ? '시작하는 중…' : '시작하기'}
        </button>
      </div>
    </div>
  )
}
