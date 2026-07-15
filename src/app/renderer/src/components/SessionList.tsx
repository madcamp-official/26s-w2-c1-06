import { Radio } from 'lucide-react'
import type { SessionWithPreview } from '@shared/types'
import { formatTime } from '@shared/format'

interface SessionListProps {
  sessions: SessionWithPreview[]
  selectedSessionId: string | null
  onSelect: (sessionId: string | null) => void
}

// 세션 목록(사이드바): sessions 테이블을 최신순으로 나열. selectedSessionId가 null이면
// "실시간(가장 최근 세션 자동 추적)" 모드 — 과거 세션을 클릭하면 그 세션에 고정되고,
// 맨 위의 "실시간으로" 버튼으로 다시 라이브 추적으로 돌아갈 수 있다.
export function SessionList({ sessions, selectedSessionId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return <p className="px-3 text-[12px] text-[#6d7069]">아직 관찰된 세션이 없습니다.</p>
  }

  return (
    <div className="space-y-1">
      {selectedSessionId !== null && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[#3c7566] hover:bg-[#f1f0eb]"
        >
          <Radio size={13} /> 실시간으로 돌아가기
        </button>
      )}
      {sessions.map((session, index) => {
        const isLive = selectedSessionId === null && index === 0
        const isSelected = selectedSessionId === session.id || isLive
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition ${
              isSelected ? 'bg-[#eaf4ef]' : 'hover:bg-[#f6f5f1]'
            }`}
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                session.ended_at ? 'bg-[#a9aaa4]' : 'bg-[#4f9c84] shadow-[0_0_8px_rgba(121,216,180,.6)]'
              }`}
            />
            <span className="min-w-0 flex-1">
              <span
                title={session.first_prompt_text ?? undefined}
                className={`block truncate text-[12px] ${
                  isSelected ? 'font-medium text-[#373832]' : 'text-[#6d7069]'
                }`}
              >
                {session.first_prompt_text ?? '아직 요청이 없어요'}
              </span>
              <span className="block font-mono text-[10px] text-[#9a9a92]">
                {formatTime(session.started_at)}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${
                session.ended_at
                  ? 'bg-[#f1f0eb] text-[#6d7069]'
                  : 'bg-[#e4f0eb] text-[#245248]'
              }`}
            >
              {session.ended_at ? '완료' : '진행 중'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
