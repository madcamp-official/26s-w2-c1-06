import { useState } from 'react'
import type { SkillLevel } from '@shared/types'

export interface QnaExchange {
  id: string
  question: string
  answer: string
}

interface UseQnaResult {
  exchanges: QnaExchange[]
  pending: boolean
  ask: (question: string) => Promise<void>
}

// SPEC 4.3.3 Q&A 챗: 세션당 호출이 드물어 무료 티어 압박이 거의 없다고 명시돼
// 있어(4.3.3), 응답을 ai_explanations에 캐시하지 않고 화면 상태로만 들고 있는다
// (재조회 캐시가 의미 있으려면 질문 텍스트가 안정적인 키여야 하는데 자유 텍스트라
// 사실상 항상 miss라 캐싱 이점이 없음). 앱을 새로고침하면 기록은 사라진다.
export function useQna(sessionId: string | null, skillLevel: SkillLevel): UseQnaResult {
  const [exchanges, setExchanges] = useState<QnaExchange[]>([])
  const [pending, setPending] = useState(false)

  const ask = async (question: string): Promise<void> => {
    if (!sessionId || !question.trim()) return
    setPending(true)
    try {
      const answer = await window.factcoding.answerQuestion(sessionId, question, skillLevel)
      setExchanges((prev) => [...prev, { id: crypto.randomUUID(), question, answer }])
    } finally {
      setPending(false)
    }
  }

  return { exchanges, pending, ask }
}
