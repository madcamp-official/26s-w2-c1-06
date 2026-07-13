import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import type {
  AIProvider,
  BatchCaption,
  ContextBundle,
  SessionTrace,
  StepCaption,
  StepInput,
  VersionCaption
} from '../types'

const TONE_PREFIX: Record<SkillLevel, string> = {
  beginner: '(쉽게 설명하면)',
  intermediate: '',
  advanced: '(설계 관점)'
}

const CHANGE_LABEL: Record<string, string> = {
  created: '새로 만들어졌어요',
  modified: '수정됐어요',
  deleted: '삭제됐어요'
}

function truncateTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 16 ? oneLine.slice(0, 16) + '…' : oneLine
}

function conceptTagsFromEvents(events: ToolEvent[]): string[] {
  const tags = new Set<string>()
  for (const event of events) {
    if (event.tool_name === 'Bash') tags.add('셸 명령')
    else if (event.tool_name === 'Read') tags.add('코드 읽기')
    else if (event.tool_name === 'Edit' || event.tool_name === 'Write') tags.add('코드 수정')
    else tags.add(event.tool_name)
    if (tags.size >= 3) break
  }
  return [...tags]
}

// GEMINI_KEY_A/B가 없을 때 배칭 → 캐시 → UI 파이프라인을 네트워크 호출 없이
// 검증하기 위한 결정론적 mock. 실제 키가 생기면 createAIProvider가 자동으로
// GeminiProvider로 교체하므로 이 파일은 그대로 둬도 된다.
export class MockAIProvider implements AIProvider {
  async explainBatch(events: ToolEvent[], _notes: AssistantNote[], skillLevel: SkillLevel): Promise<BatchCaption[]> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 실제 Gemini 없이도 1~3단계 데이터(특히 실패 근거)가 화면까지 이어지는지 확인할 수
    // 있도록, 결정론적이지만 error 상태는 result_content를 반영해 구분되게 만든다.
    return events.map((event) => {
      if (event.status === 'error' && event.result_content) {
        return {
          toolEventId: event.id,
          caption: `${TONE_PREFIX[skillLevel]} ${event.tool_name} 실행이 실패했어요: ${event.result_content.slice(0, 80)}`.trim(),
          conceptTags: [event.tool_name, '에러 처리']
        }
      }
      return {
        toolEventId: event.id,
        caption: `${TONE_PREFIX[skillLevel]} ${event.tool_name}(으)로 ${event.file_path ?? '작업'}을(를) 처리했어요.`.trim(),
        conceptTags: [event.tool_name]
      }
    })
  }

  async explainSteps(steps: StepInput[], skillLevel: SkillLevel): Promise<StepCaption[]> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 실제 Gemini 없이도 스텝 그룹핑 → 요약 → 캐시 → UI 경로를 검증하기 위한 결정론적 mock.
    return steps.map((step) => {
      const failed = step.events.filter((e) => e.status === 'error').length
      const failNote = failed > 0 ? ` 실패 ${failed}건을 확인하고 다시 시도했어요.` : ''
      const firstFile = step.events.find((e) => e.file_path)?.file_path
      return {
        stepId: step.stepId,
        title: truncateTitle(step.noteText) || '작업 진행',
        caption:
          `${TONE_PREFIX[skillLevel]} "${step.noteText.slice(0, 40)}" 목표로 ${step.events.length}개 행동을 묶어 진행했어요.${failNote}`.trim(),
        why: firstFile
          ? `${firstFile}을(를) 보면 이 목표가 코드에 어떻게 반영되는지 확인할 수 있어요.`
          : '이 행동들이 목표를 달성하는 데 필요한 증거예요.',
        ttsScript:
          `${TONE_PREFIX[skillLevel]} 지금 에이전트가 ${step.events.length}개 행동을 묶어 목표를 밀어붙이고 있습니다${failNote} 흐름을 잘 지켜보세요`.trim(),
        conceptTags: conceptTagsFromEvents(step.events)
      }
    })
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

    const stepList = trace.steps
      .map((s) => `- **${s.title}**: ${s.body}${s.why ? ` (${s.why})` : ''}`)
      .join('\n')

    return [
      `# 세션 강의노트 ${TONE_PREFIX[skillLevel]}`.trim(),
      '## 이번 세션에서 배운 것',
      turnList || '(기록된 턴 없음)',
      stepList ? `\n학습 스텝:\n${stepList}` : '',
      '## 핵심 개념',
      trace.steps.flatMap((s) => s.conceptTags).slice(0, 5).map((t) => `- ${t}`).join('\n') ||
        '- (태그 없음)',
      '## 코드에서 일어난 일',
      versionList || '(변경된 유닛 없음)',
      '## 다시 보면 좋은 포인트',
      `- 이번 세션에서 다룬 ${trace.versions.length}개 코드 유닛 변경을 복습해보세요.`
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  async answerQuestion(
    question: string,
    context: ContextBundle,
    skillLevel: SkillLevel
  ): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    return `${TONE_PREFIX[skillLevel]} "${question}"에 대한 답변: 현재 세션은 ${context.units.length}개 코드 유닛과 ${context.edges.length}개 관계, ${context.prompts.length}개 요청 턴으로 구성되어 있어요. (mock 응답 — 실제 키 연결 시 Gemini가 답변합니다)`.trim()
  }
}
