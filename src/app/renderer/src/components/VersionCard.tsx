import { useState } from 'react'
import type { AiExplanation, CodeUnitVersionWithUnit, SkillLevel } from '@shared/types'
import { formatTime, parseConceptTags } from '@shared/format'

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

// SPEC 5.1 항목별 오버라이드: "쉽게 설명해줘"/"더 자세히" 두 방향만 제공.
// 같은 버튼을 다시 누르면 오버라이드를 해제하고 전역 난이도로 돌아간다.
const OVERRIDE_BUTTONS: Array<{ level: SkillLevel; label: string }> = [
  { level: 'beginner', label: '쉽게 설명해줘' },
  { level: 'advanced', label: '더 자세히' }
]

const CODE_LABEL: Record<string, string> = {
  created: '생성된 코드',
  modified: '바뀐 코드',
  deleted: '삭제된 코드'
}

// diff_text는 makeDiffText(파이프라인)가 만드는 "+ /- /  " 접두사 라인 diff다 —
// 여기서 AI가 코드를 다시 만들어내는 게 아니라(이 앱의 원칙), 이미 있는 그 텍스트를
// 줄 단위로 색만 입혀서 보여준다. 기본은 접어두고(카드가 코드로 도배되지 않게),
// 클릭하면 펼쳐서 색이 입혀진 전체 diff를 본다.
function DiffLines({ text }: { text: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#e6e4dd] bg-[#f6f5f1] py-2 font-mono text-[10.5px] leading-5">
      {text.split('\n').map((line, i) => {
        const marker = line.charAt(0)
        const rowClass =
          marker === '+'
            ? 'bg-[#e6f4ea] text-[#1a7a4c]'
            : marker === '-'
              ? 'bg-[#fbeceb] text-[#a3403a]'
              : 'text-[#3f514c]'
        return (
          <div key={i} className={`whitespace-pre px-3 ${rowClass}`}>
            {line.length > 0 ? line : ' '}
          </div>
        )
      })}
    </div>
  )
}

// TurnDetailPanel의 통합 타임라인에서 쓰는 카드 하나 — 바뀐 코드 유닛(함수/컴포넌트/
// 클래스) 하나에 대한 캡션 + 핵심 코드. 예전엔 이 상태(오버라이드/코드 펼침)를
// TurnChanges가 versionId로 키를 삼은 Record로 관리했는데, 이제 이 컴포넌트가 카드
// 하나만 책임지므로 그냥 지역 상태로 단순화했다.
export function VersionCard({
  version,
  explanation
}: {
  version: CodeUnitVersionWithUnit
  explanation: AiExplanation | undefined
}) {
  const [overrideLevel, setOverrideLevel] = useState<SkillLevel | null>(null)
  const [overrideExplanation, setOverrideExplanation] = useState<AiExplanation | null>(null)
  const [overridePending, setOverridePending] = useState(false)
  // 네이티브 <details open>을 React state로 직접 제어하면(onToggle에서 e.currentTarget을
  // 읽는 방식) 프로그래매틱하게 open을 바꿀 때 currentTarget이 null인 채로 'toggle'
  // 이벤트가 들어오는 경우가 있어 크래시가 났다(실제로 재현됨) — 그래서 <details>를
  // 아예 안 쓰고 평범한 버튼 + 조건부 렌더로 대체한다.
  const [codeOpen, setCodeOpen] = useState(false)

  const toggleOverride = async (level: SkillLevel): Promise<void> => {
    if (overrideLevel === level) {
      setOverrideLevel(null)
      return
    }
    setOverrideLevel(level)
    setOverridePending(true)
    try {
      const result = await window.factcoding.explainVersionOverride(version.id, level)
      if (result) setOverrideExplanation(result)
    } finally {
      setOverridePending(false)
    }
  }

  const effectiveExplanation = overrideLevel ? (overrideExplanation ?? undefined) : explanation
  const pending = overrideLevel !== null && overridePending

  return (
    <div className="rounded-xl border border-border bg-[#f6f5f1] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-[#21221f]">{version.unit_name}</span>
        <span className="font-mono text-[10px] text-[#6d7069]">{version.unit_type}</span>
        <span className="font-mono text-[10px] font-semibold text-[#245248]">v{version.version_no}</span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-medium ${
            CHANGE_BADGE[version.change_type] ?? 'bg-[#f1f0eb] text-[#6d7069]'
          }`}
        >
          {CHANGE_LABEL[version.change_type] ?? version.change_type}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[#9a9a92]">{formatTime(version.created_at)}</span>
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-[#6d7069]">{version.file_path}</p>

      <div className="mt-2 text-[12px] leading-relaxed text-[#3f514c]">
        {pending || !effectiveExplanation ? (
          <span className="font-mono text-[11px] text-[#3c7566]">요약 생성 중…</span>
        ) : (
          <>
            <span>{effectiveExplanation.content}</span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              {parseConceptTags(effectiveExplanation.concept_tags).map((tag) => (
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

      <div className="mt-2.5 flex gap-1.5">
        {OVERRIDE_BUTTONS.map((button) => (
          <button
            key={button.level}
            type="button"
            onClick={() => toggleOverride(button.level)}
            className={`rounded-md border px-2 py-1 text-[11px] transition ${
              overrideLevel === button.level
                ? 'border-[#b8d9ce] bg-[#eaf4ef] text-[#245248]'
                : 'border-border bg-transparent text-[#6d7069] hover:bg-[#f1f0eb] hover:text-[#373832]'
            }`}
          >
            {button.label}
          </button>
        ))}
      </div>

      {(() => {
        // explanation.key_code_snippet은 AI가 diff에서 고른 줄 범위를 우리가 직접
        // 잘라낸 "핵심 코드"(explainVersionsPrompt.ts의 sliceKeySnippet) — 항상
        // 우선 보여준다. 아직 그 값이 없는 캡션(기능 추가 이전에 생성된 캐시 등)은
        // 전체 diff_text로 폴백해서 최소한 코드 자체는 계속 볼 수 있게 한다.
        const codeText = effectiveExplanation?.key_code_snippet ?? version.diff_text
        if (!codeText) return null
        const isKeySnippet = Boolean(effectiveExplanation?.key_code_snippet)
        const lineCount = codeText.split('\n').length
        const label = isKeySnippet
          ? `핵심 코드 (${lineCount}줄)`
          : `${CODE_LABEL[version.change_type] ?? '코드'} (${lineCount}줄)`

        return (
          <div className="mt-2.5">
            <button
              type="button"
              onClick={() => setCodeOpen((prev) => !prev)}
              className="font-mono text-[10px] tracking-[0.08em] text-[#6d7069] transition hover:text-[#285c52]"
            >
              {codeOpen ? '▴ 코드 접기' : `▾ ${label} 보기`}
            </button>
            {codeOpen && (
              <div className="mt-1.5">
                <DiffLines text={codeText} />
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
