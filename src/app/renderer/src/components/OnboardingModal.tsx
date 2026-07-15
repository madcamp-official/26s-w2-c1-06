import { useState, type ReactNode } from 'react'
import {
  BookOpen,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Plus,
  Rocket,
  X
} from 'lucide-react'
import type { OnboardingProfile, ProjectCountBucket, SkillLevel, TeachingStyle } from '@shared/types'
import {
  computeSkillProfile,
  KAIST_HIGHLIGHTED_ELECTIVES,
  KAIST_REQUIRED_COURSES,
  PROJECT_COUNT_OPTIONS,
  STACK_PRESETS,
  TEACHING_STYLE_OPTIONS
} from '@shared/skillProfile'

interface OnboardingModalProps {
  onSelect: (level: SkillLevel, profile: OnboardingProfile) => void
}

const STEPS = ['수강 과목', '프로젝트 경험', '교육 스타일'] as const

const KNOWN_COURSES = new Set<string>([...KAIST_REQUIRED_COURSES, ...KAIST_HIGHLIGHTED_ELECTIVES])
const KNOWN_STACK = new Set<string>(STACK_PRESETS)

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition ${
        active
          ? 'border-[#4f9c84] bg-[#e4f0eb] text-[#245248]'
          : 'border-border bg-[#f6f5f1] text-[#6d7069] hover:border-[#b8d9ce] hover:text-[#373832]'
      }`}
    >
      {active && <Check size={12} />}
      {children}
    </button>
  )
}

export interface SkillProfileWizardProps {
  // 이미 답한 적 있는 프로필(설정에서 다시 열 때) — 있으면 각 단계 선택 상태를 그대로 채워서 시작한다.
  initialProfile?: OnboardingProfile | null
  onFinish: (level: SkillLevel, profile: OnboardingProfile) => void
  // 있으면 헤더에 닫기(X) 버튼과 배경 클릭 닫기를 켠다 — 최초 온보딩은 건너뛸 수 없어야
  // 하므로 이 prop을 안 넘긴다(OnboardingModal 참조).
  onClose?: () => void
  headerTitle?: string
  headerDescription?: string
}

// SPEC 5.1 온보딩 위저드: 3단계로 실력 수준을 추정한다.
// 1단계(수강 과목)는 이론 기반(Bottom-up), 2단계(프로젝트/스택)는 실전 경험(Top-down)
// 신호를 모으고, computeSkillProfile이 둘을 합쳐 "두 학습 방향이 만나는 지점"을
// 5단계 위치로 계산한다. 3단계(교육 스타일)는 그 위치를 성향에 맞게 미세 조정한다.
// 최초 온보딩(OnboardingModal)과 사이드바 "설정"(SkillSettingsModal) 둘 다 이 위저드를
// 그대로 재사용한다 — 답변 구조와 계산 로직이 완전히 같아, 두 화면을 따로 유지할 이유가 없다.
export function SkillProfileWizard({
  initialProfile,
  onFinish,
  onClose,
  headerTitle = '개발 지식 수준을 알려주세요',
  headerDescription = '설명의 톤과 깊이를 맞추는 데 사용해요. 사이드바의 설정에서 언제든 다시 바꿀 수 있어요.'
}: SkillProfileWizardProps) {
  const [step, setStep] = useState(0)
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(
    () => new Set((initialProfile?.courses ?? []).filter((c) => KNOWN_COURSES.has(c)))
  )
  const [customCourses, setCustomCourses] = useState<string[]>(
    () => (initialProfile?.courses ?? []).filter((c) => !KNOWN_COURSES.has(c))
  )
  const [courseDraft, setCourseDraft] = useState('')
  const [projectBucket, setProjectBucket] = useState<ProjectCountBucket | null>(
    initialProfile?.projectBucket ?? null
  )
  const [selectedStack, setSelectedStack] = useState<Set<string>>(
    () => new Set((initialProfile?.stack ?? []).filter((s) => KNOWN_STACK.has(s)))
  )
  const [customStack, setCustomStack] = useState<string[]>(
    () => (initialProfile?.stack ?? []).filter((s) => !KNOWN_STACK.has(s))
  )
  const [stackDraft, setStackDraft] = useState('')
  const [style, setStyle] = useState<TeachingStyle | null>(initialProfile?.style ?? null)

  const toggleCourse = (course: string): void => {
    setSelectedCourses((prev) => {
      const next = new Set(prev)
      if (next.has(course)) next.delete(course)
      else next.add(course)
      return next
    })
  }

  const addCustomCourse = (): void => {
    const value = courseDraft.trim()
    if (!value || customCourses.includes(value)) return
    setCustomCourses((prev) => [...prev, value])
    setCourseDraft('')
  }

  const toggleStack = (tech: string): void => {
    setSelectedStack((prev) => {
      const next = new Set(prev)
      if (next.has(tech)) next.delete(tech)
      else next.add(tech)
      return next
    })
  }

  const addCustomStack = (): void => {
    const value = stackDraft.trim()
    if (!value || customStack.includes(value)) return
    setCustomStack((prev) => [...prev, value])
    setStackDraft('')
  }

  const canNext = step === 1 ? projectBucket !== null : true
  const canFinish = style !== null

  const goNext = (): void => setStep((s) => Math.min(2, s + 1))
  const goBack = (): void => setStep((s) => Math.max(0, s - 1))

  const finish = (): void => {
    if (!style) return
    const profile: OnboardingProfile = {
      courses: [...selectedCourses, ...customCourses],
      projectBucket: projectBucket ?? '0',
      stack: [...selectedStack, ...customStack],
      style
    }
    const { level } = computeSkillProfile(profile)
    onFinish(level, profile)
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#21221f]/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-xl border border-border bg-card shadow-[0_24px_60px_rgba(33,34,31,.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border p-6 pb-5">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#285c52] text-[#ffffff]">
            <BrainCircuit size={19} strokeWidth={2.3} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{headerTitle}</h2>
            <p className="text-[12px] text-muted-foreground">{headerDescription}</p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-[#6d7069] transition hover:bg-[#f1f0eb] hover:text-[#373832]"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 px-6 pt-5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-[10.5px] font-medium ${
                  i < step
                    ? 'bg-[#4f9c84] text-[#ffffff]'
                    : i === step
                      ? 'bg-[#285c52] text-[#ffffff]'
                      : 'bg-[#f1f0eb] text-[#6d7069]'
                }`}
              >
                {i < step ? <Check size={13} /> : i + 1}
              </div>
              <span
                className={`text-[11.5px] ${i === step ? 'font-medium text-[#21221f]' : 'text-[#6d7069]'}`}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="mx-1 h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        <div className="min-h-[280px] px-6 py-5">
          {step === 0 && (
            <div>
              <p className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[#6d7069]">
                <BookOpen size={14} className="text-[#5b8fae]" />
                들은 적 있는 과목을 모두 골라주세요 (KAIST 전산학부 교육과정 기준)
              </p>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#6d7069]">
                전공필수
              </p>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {KAIST_REQUIRED_COURSES.map((course) => (
                  <Chip key={course} active={selectedCourses.has(course)} onClick={() => toggleCourse(course)}>
                    {course}
                  </Chip>
                ))}
              </div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#6d7069]">
                주요 전공선택
              </p>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {KAIST_HIGHLIGHTED_ELECTIVES.map((course) => (
                  <Chip key={course} active={selectedCourses.has(course)} onClick={() => toggleCourse(course)}>
                    {course}
                  </Chip>
                ))}
              </div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#6d7069]">
                그 외 들은 과목 직접 추가
              </p>
              <div className="mb-2 flex gap-2">
                <input
                  value={courseDraft}
                  onChange={(e) => setCourseDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCustomCourse()
                    }
                  }}
                  placeholder="예: 컴파일러, 딥러닝개론"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-input-background px-3 py-1.5 text-[12.5px] text-foreground placeholder:text-[#6d7069] focus:outline-none focus:ring-1 focus:ring-ring/60"
                />
                <button
                  type="button"
                  onClick={addCustomCourse}
                  className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#eaf4ef] text-[#245248] transition hover:bg-[#e4f0eb]"
                >
                  <Plus size={15} />
                </button>
              </div>
              {customCourses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customCourses.map((course) => (
                    <span
                      key={course}
                      className="flex items-center gap-1 rounded-full border border-[#b8d9ce] bg-[#eaf4ef] px-2.5 py-1 text-[11.5px] text-[#245248]"
                    >
                      {course}
                      <button
                        type="button"
                        onClick={() => setCustomCourses((prev) => prev.filter((c) => c !== course))}
                        className="text-[#5c7a6d] hover:text-[#c65c52]"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="mb-2.5 flex items-center gap-2 text-[12px] font-medium text-[#6d7069]">
                <Rocket size={14} className="text-[#9a805b]" />
                직접 진행한 프로젝트는 몇 개인가요?
              </p>
              <div className="mb-5 grid grid-cols-4 gap-2">
                {PROJECT_COUNT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setProjectBucket(option.value)}
                    className={`rounded-lg border px-2 py-2.5 text-center text-[12.5px] transition ${
                      projectBucket === option.value
                        ? 'border-[#4f9c84] bg-[#e4f0eb] font-medium text-[#245248]'
                        : 'border-border bg-[#f6f5f1] text-[#6d7069] hover:border-[#b8d9ce]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#6d7069]">
                사용해본 기술 스택
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {STACK_PRESETS.map((tech) => (
                  <Chip key={tech} active={selectedStack.has(tech)} onClick={() => toggleStack(tech)}>
                    {tech}
                  </Chip>
                ))}
              </div>
              <div className="mb-2 flex gap-2">
                <input
                  value={stackDraft}
                  onChange={(e) => setStackDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCustomStack()
                    }
                  }}
                  placeholder="예: Rust, GraphQL"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-input-background px-3 py-1.5 text-[12.5px] text-foreground placeholder:text-[#6d7069] focus:outline-none focus:ring-1 focus:ring-ring/60"
                />
                <button
                  type="button"
                  onClick={addCustomStack}
                  className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#eaf4ef] text-[#245248] transition hover:bg-[#e4f0eb]"
                >
                  <Plus size={15} />
                </button>
              </div>
              {customStack.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customStack.map((tech) => (
                    <span
                      key={tech}
                      className="flex items-center gap-1 rounded-full border border-[#b8d9ce] bg-[#eaf4ef] px-2.5 py-1 text-[11.5px] text-[#245248]"
                    >
                      {tech}
                      <button
                        type="button"
                        onClick={() => setCustomStack((prev) => prev.filter((t) => t !== tech))}
                        className="text-[#5c7a6d] hover:text-[#c65c52]"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[#6d7069]">
                <Compass size={14} className="text-[#3c7566]" />
                전반적으로 어떤 방식의 설명이 좋으세요?
              </p>
              <div className="space-y-2">
                {TEACHING_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStyle(option.value)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition ${
                      style === option.value
                        ? 'border-[#4f9c84] bg-[#e4f0eb]'
                        : 'border-border bg-[#f6f5f1] hover:border-[#b8d9ce] hover:bg-[#eaf4ef]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-[#21221f]">
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-5 text-[#6d7069]">
                        {option.desc}
                      </span>
                    </span>
                    {style === option.value && <Check size={16} className="shrink-0 text-[#285c52]" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border p-4">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-[#6d7069] transition hover:bg-[#f1f0eb] disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronLeft size={15} />
            이전
          </button>
          {step < 2 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canNext}
              className="flex items-center gap-1.5 rounded-lg bg-[#285c52] px-4 py-2 text-[12.5px] font-semibold text-[#ffffff] transition hover:bg-[#1f4a41] disabled:cursor-not-allowed disabled:opacity-40"
            >
              다음
              <ChevronRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={!canFinish}
              className="flex items-center gap-1.5 rounded-lg bg-[#285c52] px-4 py-2 text-[12.5px] font-semibold text-[#ffffff] transition hover:bg-[#1f4a41] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {onClose ? '저장하기' : '시작하기'}
              <Check size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// 최초 실행 시 뜨는 필수 온보딩 — 건너뛸 수 없으므로 onClose를 넘기지 않는다.
export function OnboardingModal({ onSelect }: OnboardingModalProps) {
  return <SkillProfileWizard onFinish={onSelect} />
}
