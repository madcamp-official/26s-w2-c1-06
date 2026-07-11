import { useCallback, useEffect, useState } from 'react'
import type { LectureNote, SkillLevel } from '@shared/types'

const POLL_INTERVAL_MS = 3000

interface UseLectureNotesResult {
  notes: LectureNote[]
  regenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
}

// SPEC 4.3.2/4.5: 세션 종료 후 자동 합성되는 강의노트 목록 + "다른 난이도로
// 다시 보기" 온디맨드 재생성(뷰어에서 요청). 세션이 안 끝났으면 계속 빈
// 배열 — Stop 훅 감지 전까지는 정상 상태.
export function useLectureNotes(): UseLectureNotesResult {
  const [notes, setNotes] = useState<LectureNote[]>([])

  const fetchNotes = useCallback(async (): Promise<void> => {
    const rows = await window.factcoding.getLectureNotes()
    setNotes(rows)
  }, [])

  useEffect(() => {
    let cancelled = false

    const poll = async (): Promise<void> => {
      const rows = await window.factcoding.getLectureNotes()
      if (!cancelled) setNotes(rows)
    }

    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const regenerate = async (sessionId: string, skillLevel: SkillLevel): Promise<void> => {
    await window.factcoding.regenerateLectureNote(sessionId, skillLevel)
    await fetchNotes() // 3초 폴링을 기다리지 않고 즉시 반영
  }

  return { notes, regenerate }
}
