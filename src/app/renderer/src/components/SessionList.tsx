import { Radio } from 'lucide-react'
import type { Session } from '@shared/types'
import { formatTime } from '@shared/format'

interface SessionListProps {
  sessions: Session[]
  selectedSessionId: string | null
  onSelect: (sessionId: string | null) => void
}

// 세션 목록(사이드바): sessions 테이블을 최신순으로 나열. selectedSessionId가 null이면
// "실시간(가장 최근 세션 자동 추적)" 모드 — 과거 세션을 클릭하면 그 세션에 고정되고,
// 맨 위의 "실시간으로" 버튼으로 다시 라이브 추적으로 돌아갈 수 있다.
export function SessionList({ sessions, selectedSessionId, onSelect }: SessionListProps) {
  if (sessions.length === 0) {
    return <p className="px-3 text-[12px] text-[#5f7682]">아직 관찰된 세션이 없습니다.</p>
  }

  return (
    <div className="space-y-1">
      {selectedSessionId !== null && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-[#8fc9ae] hover:bg-[#152129]"
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
              isSelected ? 'bg-[#14212a]' : 'hover:bg-[#121d25]'
            }`}
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                session.ended_at ? 'bg-[#3d5560]' : 'bg-[#79d8b4] shadow-[0_0_8px_rgba(121,216,180,.6)]'
              }`}
            />
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate font-mono text-[11px] ${
                  isSelected ? 'text-[#d7e3e9]' : 'text-[#8fa3ad]'
                }`}
              >
                {session.id.slice(0, 8)}
              </span>
              <span className="block font-mono text-[10px] text-[#5f7682]">
                {formatTime(session.started_at)}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${
                session.ended_at
                  ? 'bg-[#1b2831] text-[#7d93a0]'
                  : 'bg-[#193c35] text-[#91dfbf]'
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
