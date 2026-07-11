import type { SkillLevel } from '@shared/types'

const LABELS: Record<SkillLevel, string> = {
  beginner: '초급',
  intermediate: '중급',
  advanced: '고급'
}

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced']

interface SkillLevelToggleProps {
  value: SkillLevel
  onChange: (level: SkillLevel) => void
}

export function SkillLevelToggle({ value, onChange }: SkillLevelToggleProps) {
  return (
    <div className="skill-toggle" role="group" aria-label="난이도 선택">
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          className={`skill-toggle__btn ${
            level === value ? 'skill-toggle__btn--active' : ''
          }`}
          onClick={() => onChange(level)}
        >
          {LABELS[level]}
        </button>
      ))}
    </div>
  )
}
