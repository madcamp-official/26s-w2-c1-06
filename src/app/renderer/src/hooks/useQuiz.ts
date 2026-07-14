import { useState } from 'react'
import type { SkillLevel } from '@shared/types'
import type { QuizLesson } from '@shared/quiz'

interface UseQuizResult {
  open: boolean
  toggle: () => void
  loading: boolean
  lessons: QuizLesson[]
  regenerate: () => void
}

// useQna와 같은 이유로 결과를 캐시하지 않는다 — 열 때마다 새로 생성해야 "같은 문제
// 반복"이 안 돼서 다시 풀 맛이 있다(SPEC 패치 v3). 앱을 새로고침하면 기록은 사라짐.
export function useQuiz(sessionId: string | null, skillLevel: SkillLevel): UseQuizResult {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lessons, setLessons] = useState<QuizLesson[]>([])

  const generate = async (): Promise<void> => {
    if (!sessionId) return
    setLoading(true)
    try {
      const result = await window.factcoding.generateQuiz(sessionId, skillLevel)
      setLessons(result)
    } finally {
      setLoading(false)
    }
  }

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next) generate()
  }

  return { open, toggle, loading, lessons, regenerate: generate }
}
