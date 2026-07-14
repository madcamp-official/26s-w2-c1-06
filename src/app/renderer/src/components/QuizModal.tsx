import { useEffect, useRef, useState } from 'react'
import type { QuizLesson, QuizQuestion } from '@shared/quiz'

interface QuizModalProps {
  loading: boolean
  lessons: QuizLesson[]
  onClose: () => void
  onRetry: () => void
}

const STUDY_MS = 60_000
const QUESTION_MS = 10_000
const TICK_MS = 100
const LETTERS = ['A', 'B', 'C', 'D']

type Phase = 'study' | 'quiz' | 'results'
interface Outcome {
  lesson: QuizLesson
  question: QuizQuestion
  correct: boolean
}

// 듀오링고 스타일 타이머 드릴 — 학습 카드 하나(=코드 변경 하나)를 1분간 크게 보여준 뒤,
// 그 내용만 다루는 문항을 10초씩 자동으로 넘기며 푼다(1분 + 6*10초 ≈ 2분/카드). 다음
// 카드로 넘어가면 같은 사이클이 반복된다. 시간 안에 답하든 못 하든 문항당 시간은 항상
// 10초로 고정 — 빨리 답해도 남은 시간엔 "AI가 다음 문제 준비 중" 상태로 대기한다.
export function QuizModal({ loading, lessons, onClose, onRetry }: QuizModalProps) {
  const [phase, setPhase] = useState<Phase>('study')
  const [lessonIdx, setLessonIdx] = useState(0)
  const [qIdx, setQIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [msLeft, setMsLeft] = useState(STUDY_MS)
  const [results, setResults] = useState<Outcome[]>([])

  // 카운트다운 인터벌이 "지금 답이 선택됐는지"를 최신값으로 읽어야 하는데, 이펙트는
  // phase/lessonIdx/qIdx가 바뀔 때만 재실행되므로 selected state를 직접 참조하면 클로저가
  // 고정된다(stale closure) — ref로 최신값을 따로 들고 다닌다.
  const selectedRef = useRef<number | null>(null)

  useEffect(() => {
    setPhase('study')
    setLessonIdx(0)
    setQIdx(0)
    setSelected(null)
    setResults([])
  }, [lessons])

  const lesson = lessons[lessonIdx]
  const question = lesson?.questions[qIdx]

  const goToNextQuestion = (): void => {
    if (!lesson) return
    if (qIdx + 1 < lesson.questions.length) {
      setQIdx((i) => i + 1)
    } else if (lessonIdx + 1 < lessons.length) {
      setLessonIdx((i) => i + 1)
      setQIdx(0)
      setPhase('study')
    } else {
      setPhase('results')
    }
  }

  useEffect(() => {
    if (phase === 'results' || !lesson) return

    selectedRef.current = null
    setSelected(null)
    const durationMs = phase === 'study' ? STUDY_MS : QUESTION_MS
    const deadline = Date.now() + durationMs
    setMsLeft(durationMs)

    const timer = setInterval(() => {
      const left = deadline - Date.now()
      setMsLeft(Math.max(0, left))
      if (left > 0) return

      clearInterval(timer)
      if (phase === 'study') {
        setPhase('quiz')
        return
      }
      // 문제 시간 종료 — 아직 답을 안 골랐으면 시간 초과로 오답 처리.
      if (selectedRef.current === null && question) {
        setResults((prev) => [...prev, { lesson, question, correct: false }])
      }
      goToNextQuestion()
    }, TICK_MS)

    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, lessonIdx, qIdx, lessons])

  const handleSelect = (choice: number): void => {
    if (selectedRef.current !== null || phase !== 'quiz' || !question) return
    selectedRef.current = choice
    setSelected(choice)
    setResults((prev) => [...prev, { lesson, question, correct: choice === question.correctIndex }])
  }

  const correctCount = results.filter((r) => r.correct).length
  const missed = results.filter((r) => !r.correct)

  return (
    <div className="quiz-overlay" role="dialog" aria-modal="true" aria-label="복습 퀴즈">
      <div className="quiz-modal">
        <div className="quiz-modal__top">
          <button type="button" className="quiz-modal__close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
          <div className="quiz-modal__rail">
            {lessons.map((_, i) => (
              <div key={i} className="quiz-rail-seg">
                <div
                  className="quiz-rail-seg__fill"
                  style={{ width: `${lessonFillPercent(i, lessonIdx, phase, qIdx, lesson?.questions.length ?? 1, msLeft)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="quiz-streak">
            <span>⚡</span>
            {correctCount}
          </div>
        </div>

        {loading && <div className="quiz-modal__empty">이번 세션에서 바뀐 코드로 학습 카드를 만드는 중…</div>}

        {!loading && lessons.length === 0 && (
          <div className="quiz-modal__empty">
            아직 채점할 만한 코드 변경이 없어요. 에이전트가 코드를 좀 더 바꾸면 다시 시도해보세요.
          </div>
        )}

        {!loading && phase === 'study' && lesson && (
          <div className="quiz-study">
            <p className="quiz-body__kicker">
              카드 {lessonIdx + 1} / {lessons.length} · {lesson.unitName} · 곧 문제가 시작돼요
            </p>
            <p className="quiz-study__content">{lesson.content}</p>
            {lesson.code && <pre className="quiz-code">{lesson.code}</pre>}
            <div className="quiz-timer">
              <div className="quiz-timer__bar">
                <div className="quiz-timer__bar-fill" style={{ width: `${(msLeft / STUDY_MS) * 100}%` }} />
              </div>
              <span className="quiz-timer__num">{Math.ceil(msLeft / 1000)}초</span>
            </div>
            <button type="button" className="quiz-study__skip" onClick={() => setPhase('quiz')}>
              지금 문제 풀기 →
            </button>
          </div>
        )}

        {!loading && phase === 'quiz' && lesson && question && (
          <div className="quiz-body">
            <p className="quiz-body__kicker">
              카드 {lessonIdx + 1} / {lessons.length} · 문제 {qIdx + 1} / {lesson.questions.length}
            </p>
            <div className="quiz-timer quiz-timer--question">
              <div className="quiz-timer__bar">
                <div
                  className={`quiz-timer__bar-fill ${msLeft < 3000 ? 'quiz-timer__bar-fill--urgent' : ''}`}
                  style={{ width: `${(msLeft / QUESTION_MS) * 100}%` }}
                />
              </div>
              <span className={`quiz-timer__num ${msLeft < 3000 ? 'quiz-timer__num--urgent' : ''}`}>
                {Math.ceil(msLeft / 1000)}초
              </span>
            </div>
            <h2 className="quiz-body__prompt">{question.prompt}</h2>
            <div className="quiz-options">
              {question.options.map((opt, i) => {
                const isRight = selected !== null && i === question.correctIndex
                const isWrongChoice = selected !== null && selected === i && i !== question.correctIndex
                const cls = [
                  'quiz-option',
                  isRight ? 'quiz-option--correct' : '',
                  isWrongChoice ? 'quiz-option--wrong' : '',
                  selected !== null && !isRight && !isWrongChoice ? 'quiz-option--muted' : ''
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <button
                    key={i}
                    type="button"
                    className={cls}
                    disabled={selected !== null}
                    onClick={() => handleSelect(i)}
                  >
                    <span className="quiz-option__letter">{LETTERS[i]}</span>
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>

            {selected !== null && (
              <div className={`quiz-feedback quiz-feedback--${selected === question.correctIndex ? 'correct' : 'wrong'}`}>
                <div className="quiz-feedback__text">{selected === question.correctIndex ? '정답이에요!' : '아깝네요'}</div>
                <p className="quiz-feedback__note">{question.note}</p>
                <p className="quiz-feedback__prep">AI가 다음 문제를 준비하고 있어요…</p>
              </div>
            )}
          </div>
        )}

        {!loading && phase === 'results' && (
          <div className="quiz-results">
            <div className="quiz-results__badge">{correctCount === results.length ? '🐢' : '🔧'}</div>
            <h2 className="quiz-results__title">{correctCount === results.length ? '완벽해요!' : '계속 복습하세요'}</h2>
            <p className="quiz-results__sub">
              {results.length}문제 중 {correctCount}개 맞혔어요. 이번 세션에서 실제로 바뀐 코드 기준이에요.
            </p>
            {missed.length > 0 && (
              <div className="quiz-results__missed">
                <p className="quiz-results__missed-title">다시 보면 좋은 것</p>
                {missed.map((r, i) => (
                  <div key={i} className="quiz-results__missed-item">
                    <strong>{r.lesson.unitName}</strong>
                    <br />
                    {r.question.note}
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="quiz-results__retry" onClick={onRetry}>
              새 문제로 다시 풀기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// 상단 레일의 카드별 채움 비율 — 지나간 카드는 100%, 지금 카드는 공부(앞 절반)+문제
// 진행(뒷 절반)을 합쳐 부드럽게 채워지게, 앞으로 올 카드는 0%.
function lessonFillPercent(
  segmentIdx: number,
  currentLessonIdx: number,
  phase: Phase,
  qIdx: number,
  questionCount: number,
  msLeft: number
): number {
  if (segmentIdx < currentLessonIdx) return 100
  if (segmentIdx > currentLessonIdx) return 0

  if (phase === 'results') return 100
  if (phase === 'study') {
    const studyProgress = 1 - msLeft / STUDY_MS
    return studyProgress * 50
  }
  const questionProgress = (qIdx + (1 - msLeft / QUESTION_MS)) / Math.max(1, questionCount)
  return 50 + questionProgress * 50
}
