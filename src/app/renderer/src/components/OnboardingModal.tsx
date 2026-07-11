import type { SkillLevel } from '@shared/types'

interface OnboardingModalProps {
  onSelect: (level: SkillLevel) => void
}

const OPTIONS: Array<{ level: SkillLevel; title: string; desc: string }> = [
  { level: 'beginner', title: '초급', desc: '코딩을 배운 지 얼마 안 됐어요. 쉬운 비유로 설명해주세요.' },
  { level: 'intermediate', title: '중급', desc: '기본 패턴은 알아요. 간결하게 핵심만 설명해주세요.' },
  { level: 'advanced', title: '고급', desc: '설계 의도와 트레이드오프 위주로 설명해주세요.' }
]

// SPEC 5.1 온보딩: 최초 실행 시 개발 지식 수준을 3지선다로 물어 skill_level
// 기본값을 정한다. 이후에는 헤더의 SkillLevelToggle로 언제든 바꿀 수 있다.
export function OnboardingModal({ onSelect }: OnboardingModalProps) {
  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <h2>개발 지식 수준을 알려주세요</h2>
        <p className="onboarding-modal__desc">
          Factcoding이 에이전트의 작업을 설명하는 톤과 깊이를 맞추는 데 사용해요. 헤더의 토글로 언제든 바꿀 수 있습니다.
        </p>
        <div className="onboarding-modal__options">
          {OPTIONS.map((option) => (
            <button
              key={option.level}
              type="button"
              className="onboarding-modal__option"
              onClick={() => onSelect(option.level)}
            >
              <span className="onboarding-modal__option-title">{option.title}</span>
              <span className="onboarding-modal__option-desc">{option.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
