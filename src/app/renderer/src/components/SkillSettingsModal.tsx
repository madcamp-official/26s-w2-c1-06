import { useEffect, useState } from 'react'
import type { OnboardingProfile, SkillLevel } from '@shared/types'
import { SkillProfileWizard } from './OnboardingModal'

interface SkillSettingsModalProps {
  open: boolean
  onClose: () => void
  onSelect: (level: SkillLevel, profile: OnboardingProfile) => void
}

// 사이드바 "설정": 최초 온보딩과 똑같은 3단계 위저드를 다시 띄워서 난이도를 조정한다
// (예전엔 5칸 슬라이더로 즉석에서 옮겼는데, 그러면 "왜 이 위치인지"에 대한 근거
// 과목/프로젝트 데이터가 안 남아 재계산이 안 됐다). 열릴 때마다 저장된 프로필을
// 새로 불러와 각 단계에 미리 채워 넣는다 — 답을 처음부터 다시 고를 필요 없이
// 바뀐 부분만 고치고 다시 저장할 수 있게.
export function SkillSettingsModal({ open, onClose, onSelect }: SkillSettingsModalProps) {
  const [profile, setProfile] = useState<OnboardingProfile | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) {
      setLoaded(false)
      return
    }
    let cancelled = false
    window.factcoding.getOnboardingProfile().then((saved) => {
      if (cancelled) return
      setProfile(saved)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open || !loaded) return null

  return (
    <SkillProfileWizard
      initialProfile={profile}
      onFinish={(level, nextProfile) => {
        onSelect(level, nextProfile)
        onClose()
      }}
      onClose={onClose}
      headerTitle="난이도 설정"
      headerDescription="수강 과목·프로젝트 경험을 다시 답하면 설명 난이도가 새로 계산돼요."
    />
  )
}
