import type { CodeUnitVersionWithUnit, Prompt, SkillLevel, ToolEvent } from '@shared/types'
import type {
  AIProvider,
  ContextBundle,
  QnaHistoryEntry,
  SessionTrace,
  TurnCaption,
  TurnContext,
  VersionCaption
} from '../types'

const TONE_PREFIX: Record<SkillLevel, string> = {
  novice: '(아주 쉽게 설명하면)',
  beginner: '(쉽게 설명하면)',
  intermediate: '',
  advanced: '(설계 관점)',
  expert: '(트레이드오프 관점)'
}

const CHANGE_LABEL: Record<string, string> = {
  created: '새로 만들어졌어요',
  modified: '수정됐어요',
  deleted: '삭제됐어요'
}

// GEMINI_KEY_A/B가 없을 때 배칭 → 캐시 → UI 파이프라인을 네트워크 호출 없이
// 검증하기 위한 결정론적 mock. 실제 키가 생기면 createAIProvider가 자동으로
// GeminiProvider로 교체하므로 이 파일은 그대로 둬도 된다.
export class MockAIProvider implements AIProvider {
  async explainTurn(
    prompt: Prompt,
    events: ToolEvent[],
    context: TurnContext,
    skillLevel: SkillLevel
  ): Promise<TurnCaption> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    const files = [...new Set(events.map((e) => e.file_path).filter((f): f is string => Boolean(f)))]
    const tools = [...new Set(events.map((e) => e.tool_name))]
    const changedNames = [...new Set(context.versions.map((v) => v.unit_name))]
    const tone = TONE_PREFIX[skillLevel]

    return {
      promptId: prompt.id,
      summary: `${files.length}개 파일 · ${events.length}개 작업으로 기능 완성`,
      bubbles: [
        {
          kind: 'overview',
          title: '전체 그림부터 보자',
          text: `${tone} 지금 프로젝트에는 유닛이 ${context.units.length}개 있는데, 이번 턴에서는 그중 ${
            changedNames.length > 0 ? changedNames.join(', ') + ' 쪽을' : '코드 유닛 없이 파일들만'
          } 만졌어. 구조도에서 하이라이트된 노드가 그 부분이야.`.trim()
        },
        {
          kind: 'change',
          title: '이번에 바뀐 것',
          text: `"${prompt.user_text ?? '요청'}" 요청을 처리하려고 ${files.length}개 파일에 걸쳐 ${events.length}개 작업(${tools.join('/')})을 진행했어. (mock 해설 — 실제 키 연결 시 Gemini가 서술식으로 풀어줘)`
        },
        {
          kind: 'concept',
          title: '알아두면 좋은 개념',
          text: `이번 변경을 이해하려면 ${tools.slice(0, 2).join('과 ')} 같은 도구가 각각 뭘 하는지 알아두면 좋아. (mock 해설)`
        }
      ],
      conceptTags: tools.slice(0, 3)
    }
  }

  async explainUnitVersions(
    versions: CodeUnitVersionWithUnit[],
    skillLevel: SkillLevel
  ): Promise<VersionCaption[]> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    return versions.map((version) => ({
      versionId: version.id,
      caption:
        `${TONE_PREFIX[skillLevel]} ${version.unit_name} ${version.unit_type}이(가) v${version.version_no}에서 ${CHANGE_LABEL[version.change_type] ?? '변경됐어요'}.`.trim(),
      conceptTags: [version.unit_type, version.change_type]
    }))
  }

  async synthesizeLectureNote(trace: SessionTrace, skillLevel: SkillLevel): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    const turnList = trace.prompts.map((p) => `- turn ${p.turn_index + 1}: ${p.user_text}`).join('\n')
    const versionList = trace.versions
      .map((v) => `- **${v.unit_name}** (${v.unit_type}) — ${v.change_type} (v${v.version_no})`)
      .join('\n')

    return [
      `# 세션 강의노트 ${TONE_PREFIX[skillLevel]}`.trim(),
      '## 다룬 개념',
      turnList || '(기록된 턴 없음)',
      '## 변경된 코드 유닛별 요약',
      versionList || '(변경된 유닛 없음)',
      '## 다음 학습 추천',
      `- 이번 세션에서 다룬 ${trace.versions.length}개 코드 유닛 변경을 복습해보세요.`
    ].join('\n\n')
  }

  async answerQuestion(
    question: string,
    context: ContextBundle,
    history: QnaHistoryEntry[],
    skillLevel: SkillLevel
  ): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    const historyNote = history.length > 0 ? ` (이전 대화 ${history.length}개 참고함)` : ''
    return `${TONE_PREFIX[skillLevel]} "${question}"에 대한 답변${historyNote}: 현재 세션은 ${context.units.length}개 코드 유닛과 ${context.edges.length}개 관계, ${context.prompts.length}개 요청 턴으로 구성되어 있어요. (mock 응답 — 실제 키 연결 시 Gemini가 답변합니다)`.trim()
  }
}
