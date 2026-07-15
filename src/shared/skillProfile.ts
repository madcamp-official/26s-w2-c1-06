import type { OnboardingProfile, ProjectCountBucket, SkillLevel, TeachingStyle } from './types'

// 5단계 순서 — 슬라이더 인덱스(0~4) ↔ SkillLevel 매핑에 그대로 쓰인다.
export const SKILL_LEVEL_ORDER: SkillLevel[] = [
  'novice',
  'beginner',
  'intermediate',
  'advanced',
  'expert'
]

export const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = {
  novice: '입문',
  beginner: '초급',
  intermediate: '중급',
  advanced: '고급',
  expert: '전문가'
}

// KAIST 전산학부 교육과정 기준 전공필수 목록 (온보딩 1단계 체크리스트).
// 정확한 필수/선택 구분은 개정 연도마다 조금씩 달라질 수 있어, 여기 없는 과목은
// "직접 추가"로 보충하는 걸 전제로 한다 — 공식 수강 감사가 아니라 난이도 추정용 자기 신고.
export const KAIST_REQUIRED_COURSES = [
  '이산구조',
  '프로그래밍언어',
  '데이터구조',
  '알고리즘개론',
  '운영체제',
  '전산기조직'
] as const

// 사용자가 명시적으로 지정한 "메인 선택 가능 옵션" — 시스템 이해도를 크게 끌어올리는
// 과목이라 전공필수보다 가중치를 높게 준다 (computeSkillProfile 참조).
export const KAIST_HIGHLIGHTED_ELECTIVES = ['전산망개론', '시스템 프로그래밍'] as const

export const PROJECT_COUNT_OPTIONS: Array<{ value: ProjectCountBucket; label: string }> = [
  { value: '0', label: '아직 없어요' },
  { value: '1-2', label: '1~2개' },
  { value: '3-5', label: '3~5개' },
  { value: '6+', label: '6개 이상' }
]

export const STACK_PRESETS = [
  'React',
  'Node.js',
  'Python',
  'Java',
  'C/C++',
  'Spring',
  'Database/SQL',
  'Docker/Cloud',
  'ML/AI'
]

export const TEACHING_STYLE_OPTIONS: Array<{ value: TeachingStyle; title: string; desc: string }> = [
  {
    value: 'theory-first',
    title: '원리부터 차근차근',
    desc: '개념과 이유를 먼저 이해하고 나서 코드를 보고 싶어요 (Bottom-up).'
  },
  {
    value: 'practice-first',
    title: '일단 만들어보고, 필요할 때 설명',
    desc: '동작하는 코드를 먼저 보고, 필요한 개념만 그때그때 설명해주세요 (Top-down).'
  },
  {
    value: 'analogy',
    title: '비유와 직관으로',
    desc: '일상적인 비유를 들어 감을 잡을 수 있게 설명해주세요.'
  },
  {
    value: 'balanced',
    title: '균형 있게',
    desc: '위 세 가지를 상황에 맞게 섞어서 설명해주세요.'
  }
]

function projectBucketScore(bucket: ProjectCountBucket): number {
  return { '0': 0, '1-2': 1, '3-5': 2, '6+': 3 }[bucket]
}

// 교육 스타일은 점수에 넣지 않고 마지막에 ±1칸만 미세 조정한다 — 이론/실전 선호가
// 실력 자체를 바꾸진 않지만, 슬라이더의 시작 위치를 그 성향 쪽으로 살짝 당겨준다.
function styleNudge(style: TeachingStyle): number {
  if (style === 'theory-first' || style === 'analogy') return -1
  if (style === 'practice-first') return 1
  return 0
}

// 온보딩 1단계(수강 과목, Bottom-up 신호)와 2단계(프로젝트/스택, Top-down 신호)를
// 합쳐 0~1 정규화 점수를 내고, 5단계 슬라이더 인덱스로 변환한다 — "Bottom-up과
// Top-down이 만나는 지점"을 슬라이더의 초기 위치로 삼는다는 게 이 함수의 역할.
export function computeSkillProfile(profile: OnboardingProfile): { level: SkillLevel; score: number } {
  const requiredCount = profile.courses.filter((c) =>
    (KAIST_REQUIRED_COURSES as readonly string[]).includes(c)
  ).length
  const highlightedCount = profile.courses.filter((c) =>
    (KAIST_HIGHLIGHTED_ELECTIVES as readonly string[]).includes(c)
  ).length
  const customCount = profile.courses.length - requiredCount - highlightedCount

  // 전공필수 1점, 전산망개론/시스템프로그래밍 1.5점(시스템 이해도 가중), 직접 추가한
  // 과목은 난이도를 모르니 0.5점만 — 상한은 "전부 들었을 때" 대략 도달하는 값.
  const courseRaw =
    requiredCount * 1 + highlightedCount * 1.5 + Math.min(customCount, 3) * 0.5
  const courseMax = KAIST_REQUIRED_COURSES.length * 1 + KAIST_HIGHLIGHTED_ELECTIVES.length * 1.5
  const courseNorm = Math.min(1, courseRaw / courseMax)

  const projectRaw = projectBucketScore(profile.projectBucket) + Math.min(profile.stack.length, 6) * 0.3
  const projectMax = 3 + 6 * 0.3
  const projectNorm = Math.min(1, projectRaw / projectMax)

  const combined = courseNorm * 0.5 + projectNorm * 0.5 // 0..1, bottom-up/top-down 절반씩
  const baseIndex = Math.round(combined * (SKILL_LEVEL_ORDER.length - 1))
  const nudgedIndex = Math.min(
    SKILL_LEVEL_ORDER.length - 1,
    Math.max(0, baseIndex + styleNudge(profile.style))
  )

  return { level: SKILL_LEVEL_ORDER[nudgedIndex], score: combined }
}
