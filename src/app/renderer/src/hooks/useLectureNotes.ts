import { useCallback, useEffect, useState } from 'react'
import type { LectureNote, SkillLevel } from '@shared/types'
import { useDataChanged } from './useDataChanged'

// push('data-changed')가 기본 갱신 경로라 폴링은 안전망으로만 남기고 주기를 늘렸다.
const POLL_INTERVAL_MS = 10000

interface UseLectureNotesResult {
  notes: LectureNote[]
  regenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
}

// SPEC 4.3.2/4.5: 세션 종료 후 자동 합성되는 강의노트 목록 + "다른 난이도로
// 다시 보기" 온디맨드 재생성(뷰어에서 요청). 노트 패널은 특정 프로젝트로 스코프하지
// 않고 모든 프로젝트의 강의노트를 하나의 누적 목록으로 보여준다(project_id 인자 없음).
export function useLectureNotes(): UseLectureNotesResult {
  const [notes, setNotes] = useState<LectureNote[]>([])

  const fetchNotes = useCallback(async (): Promise<void> => {
    const rows = await window.factcoding.getLectureNotes()
    setNotes(rows)
  }, [])

  useEffect(() => {
    fetchNotes()
    const timer = setInterval(fetchNotes, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [fetchNotes])

  // 강의노트가 자동 합성되면(세션 종료 후 워커가 처리) 즉시 반영.
  useDataChanged(['lecture-note'], fetchNotes)

  const regenerate = async (sessionId: string, skillLevel: SkillLevel): Promise<void> => {
    await window.factcoding.regenerateLectureNote(sessionId, skillLevel)
    await fetchNotes() // 폴링을 기다리지 않고 즉시 반영
  }

  return { notes, regenerate }
}
