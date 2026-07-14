// 복습 퀴즈 — 세션에서 실제로 바뀐 코드 유닛마다 "학습 카드"를 만든다. 카드 하나 =
// 1분간 크게 보여주는 학습 내용 + 그 내용만 다루는 6문항(문항당 10초 자동 진행)으로
// 묶어 한 사이클을 약 2분으로 맞춘다(1분 학습 + 6*10초 = 2분). 여러 카드를 이어서
// 풀면 다음 카드의 학습 화면이 바로 이어진다. DB에 캐시하지 않는다: useQna와 같은
// 이유로(매번 새로 풀 맛이 있어야 함) 캐시 이점이 없다.
export interface QuizQuestion {
  prompt: string
  options: string[]
  correctIndex: number
  note: string
}

export interface QuizLesson {
  id: string
  unitName: string
  unitType: string
  filePath: string
  /** 1분간 크게 보여줄 학습 카드 본문 */
  content: string
  /** 학습 카드에 함께 보여줄 짧은 코드 발췌 (없으면 빈 문자열) */
  code: string
  /** 이 학습 카드만 다루는 문항 약 6개 */
  questions: QuizQuestion[]
}
