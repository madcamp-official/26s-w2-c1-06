import type { SkillLevel } from '@shared/types'
import { SKILL_LEVEL_LABEL, SKILL_LEVEL_ORDER } from '@shared/skillProfile'

interface DifficultySliderProps {
  value: SkillLevel
  onChange: (level: SkillLevel) => void
}

// 온보딩 3단계(수강 과목/프로젝트 경험/교육 스타일)를 합쳐 계산한 초기 위치를
// 5칸 슬라이더로 보여준다. 예전엔 초급/중급/고급 3버튼 토글이었는데, 계산된
// 위치에서 "지금보다 쉽게/어렵게"로 더 세밀하게 조정할 수 있도록 슬라이더로 바꿨다.
export function DifficultySlider({ value, onChange }: DifficultySliderProps) {
  const index = Math.max(0, SKILL_LEVEL_ORDER.indexOf(value))

  return (
    <div>
      <input
        type="range"
        min={0}
        max={SKILL_LEVEL_ORDER.length - 1}
        step={1}
        value={index}
        onChange={(event) => onChange(SKILL_LEVEL_ORDER[Number(event.target.value)])}
        className="difficulty-slider w-full"
        aria-label="설명 난이도 조절"
      />
      <div className="mt-1.5 flex justify-between">
        {SKILL_LEVEL_ORDER.map((level, i) => (
          <span
            key={level}
            className={`font-mono text-[9.5px] ${
              i === index ? 'font-semibold text-[#3c7566]' : 'text-[#6d7069]'
            }`}
          >
            {SKILL_LEVEL_LABEL[level]}
          </span>
        ))}
      </div>
    </div>
  )
}
