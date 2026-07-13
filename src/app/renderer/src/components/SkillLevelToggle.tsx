import type { SkillLevel } from '@shared/types'

const LABELS: Record<SkillLevel, string> = {
  beginner: '초급',
  intermediate: '중급',
  advanced: '고급'
}

const TITLES: Record<SkillLevel, string> = {
  beginner: '수비적 해설 — 쉽게 풀어 중계',
  intermediate: '표준 전술 — 핵심만 민첩하게',
  advanced: '공격적 분석 — 설계·트레이드오프 중심'
}

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced']

interface SkillLevelToggleProps {
  value: SkillLevel
  onChange: (level: SkillLevel) => void
}

export function SkillLevelToggle({ value, onChange }: SkillLevelToggleProps) {
  return (
    <div className="skill-toggle" role="group" aria-label="해설 전술 선택">
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          className={`skill-toggle__btn ${
            level === value ? 'skill-toggle__btn--active' : ''
          }`}
          title={TITLES[level]}
          onClick={() => onChange(level)}
        >
          {LABELS[level]}
        </button>
      ))}
    </div>
  )
}
