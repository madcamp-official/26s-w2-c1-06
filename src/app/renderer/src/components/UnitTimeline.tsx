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

const CHANGE_BADGE: Record<string, string> = {
  created: 'bg-[#e4f0eb] text-[#245248]',
  modified: 'bg-[#fdf3e3] text-[#9a805b]',
  deleted: 'bg-[#fbe9e7] text-[#c65c52]'
}

// SPEC 5.1 항목별 오버라이드: "쉽게 설명해줘"/"더 자세히" 두 방향만 제공
// (헤더 토글의 3단계 전체를 다시 노출하면 카드마다 정보 밀도가 너무 높아짐).
// 같은 버튼을 다시 누르면 오버라이드를 해제하고 전역 난이도로 돌아간다.
const OVERRIDE_BUTTONS: Array<{ level: SkillLevel; label: string }> = [
  { level: 'beginner', label: '쉽게 설명해줘' },
  { level: 'advanced', label: '더 자세히' }
]

// SPEC 4.5 코드 유닛 타임라인 + SPEC 5장 Level 3(요약/태그)·Level 4(raw diff).
// 유닛 선택 자체는 StructureOverview(구조도)가 담당 — 이 컴포넌트는 선택된
// 유닛의 버전 체인만 그린다. diff는 <details>로 기본 접힘 (Level 4 progressive disclosure).
export function UnitTimeline({ versions, explanations }: UnitTimelineProps) {
  const [overrideLevel, setOverrideLevel] = useState<Record<string, SkillLevel>>({})
  const [overrideExplanation, setOverrideExplanation] = useState<Record<string, AiExplanation>>({})
  const [overridePending, setOverridePending] = useState<Record<string, boolean>>({})

  if (versions.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-muted-foreground">
        구조도에서 유닛을 선택하세요.
      </p>
    )
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
    <ol className="relative space-y-3 border-l border-[#e6e4dd] pl-4">
      {versions.map((version) => {
        const activeOverride = overrideLevel[version.id]
        const explanation = activeOverride
          ? overrideExplanation[version.id]
          : explanations.get(version.id)
        const pending = activeOverride && overridePending[version.id]

        return (
          <li
            key={version.id}
            className="relative rounded-xl border border-border bg-[#f6f5f1] p-4"
          >
            <span className="absolute -left-[21.5px] top-5 size-2 rounded-full border border-[#4f9c84] bg-[#e4f0eb]" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-[#245248]">
                v{version.version_no}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-medium ${
                  CHANGE_BADGE[version.change_type] ?? 'bg-[#f1f0eb] text-[#6d7069]'
                }`}
              >
                {CHANGE_LABEL[version.change_type] ?? version.change_type}
              </span>
              <span className="ml-auto font-mono text-[10px] text-[#9a9a92]">
                {formatTime(version.created_at)}
              </span>
            </div>

            <div className="mt-2 text-[12.5px] leading-relaxed text-[#3f514c]">
              {pending || !explanation ? (
                <span className="font-mono text-[11px] text-[#3c7566]">요약 생성 중…</span>
              ) : (
                <>
                  <span>{explanation.content}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {parseConceptTags(explanation.concept_tags).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-[#cfe3d8] bg-[#eef6f1] px-2 py-0.5 font-mono text-[10px] text-[#3c7566]"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>

            <div className="mt-3 flex gap-1.5">
              {OVERRIDE_BUTTONS.map((button) => (
                <button
                  key={button.level}
                  type="button"
                  onClick={() => toggleOverride(version.id, button.level)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition ${
                    activeOverride === button.level
                      ? 'border-[#b8d9ce] bg-[#eaf4ef] text-[#245248]'
                      : 'border-border bg-transparent text-[#6d7069] hover:bg-[#f1f0eb] hover:text-[#373832]'
                  }`}
                >
                  {button.label}
                </button>
              ))}
            </div>

            {version.diff_text && (
              <details className="group mt-3">
                <summary className="cursor-pointer list-none font-mono text-[10px] tracking-[0.08em] text-[#6d7069] transition hover:text-[#285c52] [&::-webkit-details-marker]:hidden">
                  ▸ DIFF 보기
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-[#e6e4dd] bg-[#f6f5f1] p-3 font-mono text-[10.5px] leading-5 text-[#3f514c]">
                  {version.diff_text}
                </pre>
              </details>
            )}
          </li>
        )
      })}
    </ol>
  )
}
