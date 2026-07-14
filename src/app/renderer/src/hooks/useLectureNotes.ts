import { useCallback, useEffect, useRef, useState } from 'react'
import type { LectureNote, SkillLevel } from '@shared/types'
import { useDataChanged } from './useDataChanged'

// push('data-changed')가 기본 갱신 경로라 폴링은 안전망으로만 남기고 주기를 늘렸다.
const POLL_INTERVAL_MS = 10000

interface UseLectureNotesResult {
  notes: LectureNote[]
  regenerate: (sessionId: string, skillLevel: SkillLevel) => Promise<void>
}

// SPEC 4.3.2/4.5: 세션 종료 후 자동 합성되는 강의노트 목록 + "다른 난이도로
// 다시 보기" 온디맨드 재생성(뷰어에서 요청). 세션이 안 끝났으면 계속 빈
// 배열 — Stop 훅 감지 전까지는 정상 상태. projectId가 없으면 조회하지 않는다.
export function useLectureNotes(projectId: string | null): UseLectureNotesResult {
  const [notes, setNotes] = useState<LectureNote[]>([])
  const latestProjectRef = useRef<string | null>(null)

  const fetchNotes = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setNotes([])
      return
    }
    latestProjectRef.current = projectId
    const rows = await window.factcoding.getLectureNotes(projectId)
    if (latestProjectRef.current !== projectId) return // 그 사이 다른 프로젝트로 전환됨 — 버림
    setNotes(rows)
  }, [projectId])

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
