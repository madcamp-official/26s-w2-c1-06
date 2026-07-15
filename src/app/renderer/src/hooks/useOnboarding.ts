import { useEffect, useState } from 'react'
import type { OnboardingProfile, SkillLevel } from '@shared/types'

interface UseOnboardingResult {
  needsOnboarding: boolean
  complete: (level: SkillLevel, profile: OnboardingProfile) => void
}

// 최초 실행 시 3단계 위저드(수강 과목/프로젝트 경험/교육 스타일)로 skill_level
// 기본값을 계산해 저장한다. onboarding_completed 플래그로 "이미 물어봤는지"를
// 구분한다(skill_level 자체는 항상 기본값 'intermediate'를 갖고 있어 그것만으로는
// 최초 실행 여부를 알 수 없음). 원본 프로필(onboarding_profile)도 함께 저장해
// 나중에 재계산·표시에 쓸 수 있게 한다.
export function useOnboarding(onComplete: (level: SkillLevel) => void): UseOnboardingResult {
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.factcoding.isOnboardingComplete().then((completed) => {
      if (!cancelled && !completed) setNeedsOnboarding(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const complete = (level: SkillLevel, profile: OnboardingProfile): void => {
    onComplete(level)
    window.factcoding.saveOnboardingProfile(profile)
    window.factcoding.completeOnboarding()
    setNeedsOnboarding(false)
  }

  return { needsOnboarding, complete }
}
