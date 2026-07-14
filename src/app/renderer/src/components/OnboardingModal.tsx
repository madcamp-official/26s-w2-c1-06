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
          ? 'border-[#4b8b75] bg-[#193c35] text-[#c7f5e0]'
          : 'border-border bg-[#121d25] text-[#9db0ba] hover:border-[#326055] hover:text-[#c3d2da]'
      }`}
    >
      {active && <Check size={12} />}
      {children}
    </button>
  )
}

// SPEC 5.1 온보딩: 3단계 위저드로 실력 수준을 추정한다.
// 1단계(수강 과목)는 이론 기반(Bottom-up), 2단계(프로젝트/스택)는 실전 경험(Top-down)
// 신호를 모으고, computeSkillProfile이 둘을 합쳐 "두 학습 방향이 만나는 지점"을
// 5단계 슬라이더 위치로 계산한다. 3단계(교육 스타일)는 그 위치를 성향에 맞게
// 미세 조정한다. 계산된 레벨은 이후 사이드바의 "난이도 조절" 슬라이더로 언제든 바꿀 수 있다.
export function OnboardingModal({ onSelect }: OnboardingModalProps) {
  const [step, setStep] = useState(0)
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set())
  const [customCourses, setCustomCourses] = useState<string[]>([])
  const [courseDraft, setCourseDraft] = useState('')
  const [projectBucket, setProjectBucket] = useState<ProjectCountBucket | null>(null)
  const [selectedStack, setSelectedStack] = useState<Set<string>>(new Set())
  const [customStack, setCustomStack] = useState<string[]>([])
  const [stackDraft, setStackDraft] = useState('')
  const [style, setStyle] = useState<TeachingStyle | null>(null)

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
    onSelect(level, profile)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#05090d]/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[560px] rounded-xl border border-border bg-card shadow-[0_24px_60px_rgba(0,0,0,.45)]">
        <div className="flex items-center gap-3 border-b border-border p-6 pb-5">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#a1e2c5] text-[#092018]">
            <BrainCircuit size={19} strokeWidth={2.3} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">개발 지식 수준을 알려주세요</h2>
            <p className="text-[12px] text-muted-foreground">
              설명의 톤과 깊이를 맞추는 데 사용해요. 사이드바의 난이도 조절로 언제든 바꿀 수 있어요.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-6 pt-5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div
                className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-[10.5px] font-medium ${
                  i < step
                    ? 'bg-[#4b8b75] text-[#092018]'
                    : i === step
                      ? 'bg-[#9fe2c4] text-[#092018]'
                      : 'bg-[#1b2b32] text-[#5f7682]'
                }`}
              >
                {i < step ? <Check size={13} /> : i + 1}
              </div>
              <span
                className={`text-[11.5px] ${i === step ? 'font-medium text-[#dce8ed]' : 'text-[#5f7682]'}`}
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
              <p className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[#9db0ba]">
                <BookOpen size={14} className="text-[#8cc8e6]" />
                들은 적 있는 과목을 모두 골라주세요 (KAIST 전산학부 교육과정 기준)
              </p>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#5f7682]">
                전공필수
              </p>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {KAIST_REQUIRED_COURSES.map((course) => (
                  <Chip key={course} active={selectedCourses.has(course)} onClick={() => toggleCourse(course)}>
                    {course}
                  </Chip>
                ))}
              </div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#5f7682]">
                주요 전공선택
              </p>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {KAIST_HIGHLIGHTED_ELECTIVES.map((course) => (
                  <Chip key={course} active={selectedCourses.has(course)} onClick={() => toggleCourse(course)}>
                    {course}
                  </Chip>
                ))}
              </div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#5f7682]">
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
                  className="min-w-0 flex-1 rounded-lg border border-border bg-input-background px-3 py-1.5 text-[12.5px] text-foreground placeholder:text-[#5f7682] focus:outline-none focus:ring-1 focus:ring-ring/60"
                />
                <button
                  type="button"
                  onClick={addCustomCourse}
                  className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#1e3540] text-[#c7f5e0] transition hover:bg-[#274252]"
                >
                  <Plus size={15} />
                </button>
              </div>
              {customCourses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customCourses.map((course) => (
                    <span
                      key={course}
                      className="flex items-center gap-1 rounded-full border border-[#326055] bg-[#14231f] px-2.5 py-1 text-[11.5px] text-[#c7f5e0]"
                    >
                      {course}
                      <button
                        type="button"
                        onClick={() => setCustomCourses((prev) => prev.filter((c) => c !== course))}
                        className="text-[#7fa593] hover:text-[#f49d91]"
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
              <p className="mb-2.5 flex items-center gap-2 text-[12px] font-medium text-[#9db0ba]">
                <Rocket size={14} className="text-[#e7bd74]" />
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
                        ? 'border-[#4b8b75] bg-[#193c35] font-medium text-[#c7f5e0]'
                        : 'border-border bg-[#121d25] text-[#9db0ba] hover:border-[#326055]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#5f7682]">
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
                  className="min-w-0 flex-1 rounded-lg border border-border bg-input-background px-3 py-1.5 text-[12.5px] text-foreground placeholder:text-[#5f7682] focus:outline-none focus:ring-1 focus:ring-ring/60"
                />
                <button
                  type="button"
                  onClick={addCustomStack}
                  className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#1e3540] text-[#c7f5e0] transition hover:bg-[#274252]"
                >
                  <Plus size={15} />
                </button>
              </div>
              {customStack.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customStack.map((tech) => (
                    <span
                      key={tech}
                      className="flex items-center gap-1 rounded-full border border-[#326055] bg-[#14231f] px-2.5 py-1 text-[11.5px] text-[#c7f5e0]"
                    >
                      {tech}
                      <button
                        type="button"
                        onClick={() => setCustomStack((prev) => prev.filter((t) => t !== tech))}
                        className="text-[#7fa593] hover:text-[#f49d91]"
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
              <p className="mb-3 flex items-center gap-2 text-[12px] font-medium text-[#9db0ba]">
                <Compass size={14} className="text-[#94d6b7]" />
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
                        ? 'border-[#4b8b75] bg-[#193c35]'
                        : 'border-border bg-[#121d25] hover:border-[#326055] hover:bg-[#14231f]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-[#dce8ed]">
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-5 text-[#8297a1]">
                        {option.desc}
                      </span>
                    </span>
                    {style === option.value && <Check size={16} className="shrink-0 text-[#8ed7ba]" />}
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
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-[#9db0ba] transition hover:bg-[#152129] disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronLeft size={15} />
            이전
          </button>
          {step < 2 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canNext}
              className="flex items-center gap-1.5 rounded-lg bg-[#9fe2c4] px-4 py-2 text-[12.5px] font-semibold text-[#0d251b] transition hover:bg-[#b4edcf] disabled:cursor-not-allowed disabled:opacity-40"
            >
              다음
              <ChevronRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={!canFinish}
              className="flex items-center gap-1.5 rounded-lg bg-[#9fe2c4] px-4 py-2 text-[12.5px] font-semibold text-[#0d251b] transition hover:bg-[#b4edcf] disabled:cursor-not-allowed disabled:opacity-40"
            >
              시작하기
              <Check size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
