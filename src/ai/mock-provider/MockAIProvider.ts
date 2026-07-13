import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import type {
  AIProvider,
  BatchCaption,
  ContextBundle,
  ProgressSummary,
  SessionTrace,
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

  async summarizeProgress(steps: StepInput[], skillLevel: SkillLevel): Promise<ProgressSummary[]> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 실제 Gemini 없이도 스텝 그룹핑 → 요약 → 캐시 → 진행상황 패널 경로를 검증하기 위한 결정론적 mock.
    return steps.map((step) => {
      const failed = step.events.filter((e) => e.status === 'error').length
      const failNote = failed > 0 ? ` (실패 ${failed}건 재시도)` : ''
      const editEvent = step.events.find(
        (e) => (e.tool_name === 'Edit' || e.tool_name === 'Write') && e.file_path
      )
      return {
        stepId: step.stepId,
        summary: `${TONE_PREFIX[skillLevel]} ${truncateTitle(step.noteText) || '작업 진행'}${failNote}`.trim(),
        keyCode: editEvent
          ? {
              filePath: editEvent.file_path!,
              lang: editEvent.file_path!.endsWith('.tsx') || editEvent.file_path!.endsWith('.ts')
                ? 'ts'
                : 'text',
              snippet: `// ${editEvent.tool_name} on ${editEvent.file_path}`,
              reason: '이번 스텝에서 가장 핵심적으로 바뀐 코드예요.'
            }
          : null
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

    const stepList = trace.steps.map((s) => `- ${s.summary}`).join('\n')
    const unitTypes = [...new Set(trace.versions.map((v) => v.unit_type))]

    return [
      `# 세션 강의노트 ${TONE_PREFIX[skillLevel]}`.trim(),
      '## 이번 세션에서 배운 것',
      turnList || '(기록된 턴 없음)',
      stepList ? `\n학습 스텝:\n${stepList}` : '',
      '## 핵심 개념',
      unitTypes.length > 0 ? unitTypes.map((t) => `- ${t}`).join('\n') : '- (다룬 유닛 없음)',
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
