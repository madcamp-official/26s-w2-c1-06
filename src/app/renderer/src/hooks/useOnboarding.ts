import { useEffect, useState } from 'react'
import type { SkillLevel } from '@shared/types'

interface UseOnboardingResult {
  needsOnboarding: boolean
  complete: (level: SkillLevel) => void
}

// SPEC 5.1: 최초 실행 시 "개발 지식 수준" 3지선다 → user_settings.skill_level
// 기본값 저장. onboarding_completed 플래그로 "이미 물어봤는지"를 구분한다
// (skill_level 자체는 항상 기본값 'intermediate'를 갖고 있어 그것만으로는
// 최초 실행 여부를 알 수 없음).
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

  const complete = (level: SkillLevel): void => {
    onComplete(level)
    window.factcoding.completeOnboarding()
    setNeedsOnboarding(false)
  }

  return { needsOnboarding, complete }
}
