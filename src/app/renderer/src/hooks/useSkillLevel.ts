import { useEffect, useState } from 'react'
import type { SkillLevel } from '@shared/types'

interface UseSkillLevelResult {
  skillLevel: SkillLevel
  setSkillLevel: (level: SkillLevel) => void
}

// SPEC 5.1: 헤더 고정 난이도 토글. user_settings.skill_level 전역 기본값을 읽고/쓴다.
export function useSkillLevel(): UseSkillLevelResult {
  const [skillLevel, setSkillLevelState] = useState<SkillLevel>('intermediate')

  useEffect(() => {
    let cancelled = false
    window.factcoding.getSkillLevel().then((level) => {
      if (!cancelled) setSkillLevelState(level)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setSkillLevel = (level: SkillLevel): void => {
    setSkillLevelState(level)
    window.factcoding.setSkillLevel(level)
  }

  return { skillLevel, setSkillLevel }
}
