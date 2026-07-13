import { useState } from 'react'
import type { AiExplanation, CodeUnitVersionWithUnit, SkillLevel } from '@shared/types'
import { formatTime, parseConceptTags } from '@shared/format'

interface UnitTimelineProps {
  versions: CodeUnitVersionWithUnit[]
  explanations: Map<string, AiExplanation>
}

const CHANGE_LABEL: Record<string, string> = {
  created: '생성',
  modified: '수정',
  deleted: '삭제'
}

// SPEC 5.1 항목별 오버라이드: "쉽게 설명해줘"/"더 자세히" 두 방향만 제공
// (헤더 토글의 3단계 전체를 다시 노출하면 카드마다 정보 밀도가 너무 높아짐).
// 같은 버튼을 다시 누르면 오버라이드를 해제하고 전역 난이도로 돌아간다.
const OVERRIDE_BUTTONS: Array<{ level: SkillLevel; label: string; title: string }> = [
  { level: 'beginner', label: '쉽게 설명해줘', title: '수비적 지시 — 이 선수만 쉽게 해설' },
  { level: 'advanced', label: '더 자세히', title: '공격적 지시 — 이 선수만 깊게 분석' }
]

// SPEC 4.5 코드 유닛 타임라인 + SPEC 5장 Level 3(요약/태그)·Level 4(raw diff).
// 유닛 선택 자체는 StructureOverview(구조도)가 담당 — 이 컴포넌트는 선택된
// 유닛의 버전 체인만 그린다. diff는 <details>로 기본 접힘 (Level 4 progressive disclosure).
export function UnitTimeline({ versions, explanations }: UnitTimelineProps) {
  const [overrideLevel, setOverrideLevel] = useState<Record<string, SkillLevel>>({})
  const [overrideExplanation, setOverrideExplanation] = useState<Record<string, AiExplanation>>({})
  const [overridePending, setOverridePending] = useState<Record<string, boolean>>({})

  if (versions.length === 0) {
    return <div className="unit-timeline unit-timeline--empty">전술판에서 선수를 선택하세요.</div>
  }

  const toggleOverride = async (versionId: string, level: SkillLevel): Promise<void> => {
    if (overrideLevel[versionId] === level) {
      // 같은 버튼 재클릭 → 오버라이드 해제, 전역 난이도로 복귀
      setOverrideLevel((prev) => {
        const next = { ...prev }
        delete next[versionId]
        return next
      })
      return
    }

    setOverrideLevel((prev) => ({ ...prev, [versionId]: level }))
    setOverridePending((prev) => ({ ...prev, [versionId]: true }))
    try {
      const result = await window.factcoding.explainVersionOverride(versionId, level)
      if (result) {
        setOverrideExplanation((prev) => ({ ...prev, [versionId]: result }))
      }
    } finally {
      setOverridePending((prev) => ({ ...prev, [versionId]: false }))
    }
  }

  return (
    <ol className="version-chain">
      {versions.map((version) => {
        const activeOverride = overrideLevel[version.id]
        const explanation = activeOverride
          ? overrideExplanation[version.id]
          : explanations.get(version.id)
        const pending = activeOverride && overridePending[version.id]

        return (
          <li key={version.id} className={`version-card version-card--${version.change_type}`}>
            <div className="version-card__header">
              <span className="version-card__no">v{version.version_no}</span>
              <span className={`version-card__change version-card__change--${version.change_type}`}>
                {CHANGE_LABEL[version.change_type] ?? version.change_type}
              </span>
              <span className="version-card__time">{formatTime(version.created_at)}</span>
            </div>
            <div className="version-card__caption">
              {pending ? (
                <span className="version-card__caption--pending">요약 생성 중…</span>
              ) : explanation ? (
                <>
                  <span>{explanation.summary}</span>
                  {parseConceptTags(explanation.concept_tags).map((tag) => (
                    <span key={tag} className="trace-item__tag">
                      {tag}
                    </span>
                  ))}
                </>
              ) : (
                <span className="version-card__caption--pending">요약 생성 중…</span>
              )}
            </div>
            <div className="version-card__overrides">
              {OVERRIDE_BUTTONS.map((button) => (
                <button
                  key={button.level}
                  type="button"
                  className={`version-card__override-btn ${
                    activeOverride === button.level ? 'version-card__override-btn--active' : ''
                  }`}
                  title={button.title}
                  onClick={() => toggleOverride(version.id, button.level)}
                >
                  {button.label}
                </button>
              ))}
            </div>
            {version.diff_text && (
              <details className="version-card__details">
                <summary>diff 보기</summary>
                <pre className="version-card__diff">{version.diff_text}</pre>
              </details>
            )}
          </li>
        )
      })}
    </ol>
  )
}
