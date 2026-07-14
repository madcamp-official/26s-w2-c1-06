import { useState } from 'react'
import type { AiExplanation, CodeUnitVersionWithUnit, SkillLevel } from '@shared/types'
import { formatTime, parseConceptTags } from '@shared/format'

interface TurnChangesProps {
  versions: CodeUnitVersionWithUnit[]
  explanations: Map<string, AiExplanation>
}

const CHANGE_LABEL: Record<string, string> = {
  created: '생성',
  modified: '수정',
  deleted: '삭제'
}

const CHANGE_BADGE: Record<string, string> = {
  created: 'bg-[#193c35] text-[#91dfbf]',
  modified: 'bg-[#382d1e] text-[#e7bd74]',
  deleted: 'bg-[#3a2525] text-[#f49d91]'
}

// SPEC 5.1 항목별 오버라이드: "쉽게 설명해줘"/"더 자세히" 두 방향만 제공.
// 같은 버튼을 다시 누르면 오버라이드를 해제하고 전역 난이도로 돌아간다.
const OVERRIDE_BUTTONS: Array<{ level: SkillLevel; label: string }> = [
  { level: 'beginner', label: '쉽게 설명해줘' },
  { level: 'advanced', label: '더 자세히' }
]

// TurnDetailPanel의 "변경사항" 섹션: 선택된 턴에서 바뀐 코드 유닛 버전(diff)들을
// 보여준다. UnitTimeline(구조도 탭, 유닛 하나의 버전 체인)과 달리 한 턴 안에 여러
// 유닛이 섞일 수 있어 카드마다 유닛 이름을 함께 표시한다.
export function TurnChanges({ versions, explanations }: TurnChangesProps) {
  const [overrideLevel, setOverrideLevel] = useState<Record<string, SkillLevel>>({})
  const [overrideExplanation, setOverrideExplanation] = useState<Record<string, AiExplanation>>({})
  const [overridePending, setOverridePending] = useState<Record<string, boolean>>({})

  if (versions.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">
        이 턴에서 바뀐 코드 유닛이 없어요.
      </p>
    )
  }

  const toggleOverride = async (versionId: string, level: SkillLevel): Promise<void> => {
    if (overrideLevel[versionId] === level) {
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
    <ol className="space-y-2.5">
      {versions.map((version) => {
        const activeOverride = overrideLevel[version.id]
        const explanation = activeOverride ? overrideExplanation[version.id] : explanations.get(version.id)
        const pending = activeOverride && overridePending[version.id]

        return (
          <li key={version.id} className="rounded-xl border border-border bg-[#121d25] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-[#dce8ed]">{version.unit_name}</span>
              <span className="font-mono text-[10px] text-[#7d99a5]">{version.unit_type}</span>
              <span className="font-mono text-[10px] font-semibold text-[#c8f1dc]">
                v{version.version_no}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-medium ${
                  CHANGE_BADGE[version.change_type] ?? 'bg-[#1b2831] text-[#7d93a0]'
                }`}
              >
                {CHANGE_LABEL[version.change_type] ?? version.change_type}
              </span>
              <span className="ml-auto font-mono text-[10px] text-[#536b76]">
                {formatTime(version.created_at)}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-[#5f7682]">{version.file_path}</p>

            <div className="mt-2 text-[12px] leading-relaxed text-[#b9cad3]">
              {pending || !explanation ? (
                <span className="font-mono text-[11px] text-[#8fc9ae]">요약 생성 중…</span>
              ) : (
                <>
                  <span>{explanation.content}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {parseConceptTags(explanation.concept_tags).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-[#2c4a41] bg-[#14251f] px-2 py-0.5 font-mono text-[10px] text-[#a9d3bd]"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>

            <div className="mt-2.5 flex gap-1.5">
              {OVERRIDE_BUTTONS.map((button) => (
                <button
                  key={button.level}
                  type="button"
                  onClick={() => toggleOverride(version.id, button.level)}
                  className={`rounded-md border px-2 py-1 text-[11px] transition ${
                    activeOverride === button.level
                      ? 'border-[#326055] bg-[#1e3540] text-[#c7f5e0]'
                      : 'border-border bg-transparent text-[#8299a4] hover:bg-[#15212a] hover:text-[#c3d2da]'
                  }`}
                >
                  {button.label}
                </button>
              ))}
            </div>

            {version.diff_text && (
              <details className="group mt-2.5">
                <summary className="cursor-pointer list-none font-mono text-[10px] tracking-[0.08em] text-[#6e8490] transition hover:text-[#8ed7ba] [&::-webkit-details-marker]:hidden">
                  ▸ DIFF 보기
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-[#22363f] bg-[#0d151c] p-3 font-mono text-[10.5px] leading-5 text-[#a9bdc7]">
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
