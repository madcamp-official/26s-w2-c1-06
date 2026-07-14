import type { AssistantNote, CodeUnitVersionWithUnit, SkillLevel, ToolEvent } from '@shared/types'
import type { QuizLesson, QuizQuestion } from '@shared/quiz'
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

// 퀴즈 선택지용 짧은 명사형 라벨 — CHANGE_LABEL은 카드 문장체라 선택지로 쓰기엔 길다.
const QUIZ_CHANGE_OPTIONS = ['생성됨', '수정됨', '삭제됨']
const QUIZ_CHANGE_INDEX: Record<string, number> = { created: 0, modified: 1, deleted: 2 }
const QUIZ_UNIT_TYPE_OPTIONS = ['함수', '컴포넌트', '훅', '클래스']
const QUIZ_UNIT_TYPE_INDEX: Record<string, number> = { function: 0, component: 1, hook: 2, class: 3 }

function truncateTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 16 ? oneLine.slice(0, 16) + '…' : oneLine
}

function firstDiffLines(diff: string | null, max: number): string {
  if (!diff) return '(diff 없음)'
  const lines = diff.split('\n').slice(0, max)
  return lines.join('\n')
}

// 문항 목록 안에서 로테이션해 매번 같은 순서로 정답 위치가 몰리지 않게 한다(index 기반이라
// 결정론적이지만, 실제 네트워크 없이도 "정답이 항상 A"처럼 뻔해지는 건 피한다).
function rotate<T>(items: T[], correctIndex: number, offset: number): { options: T[]; correctIndex: number } {
  const n = items.length
  const shift = offset % n
  const options = items.map((_, i) => items[(i + shift) % n])
  return { options, correctIndex: (correctIndex - shift + n) % n }
}

// 정답 하나 + 다른 코드 유닛들에서 뽑은 오답 후보들을 섞어 4지선다 선택지를 만든다.
// 세션에 유닛이 적어 오답 후보가 모자라면 접미사를 붙여 그럴듯한 가짜 오답으로 채운다.
function buildOptionsFrom(correct: string, distractorPool: string[], offset: number): { options: string[]; correctIndex: number } {
  const uniqueDistractors = [...new Set(distractorPool.filter((v) => v !== correct))]
  // 세션에 유닛이 적어 진짜 오답 후보가 3개가 안 되면, 정답을 살짝 변형한 가짜 오답으로 채운다.
  for (let n = 1; uniqueDistractors.length < 3; n++) uniqueDistractors.push(`${correct} (오답 ${n})`)
  const { options, correctIndex } = rotate([correct, ...uniqueDistractors.slice(0, 3)], 0, offset)
  return { options, correctIndex }
}

function diffLineBalance(diff: string | null): '추가가 더 많다' | '삭제가 더 많다' | '둘이 같다' {
  if (!diff) return '둘이 같다'
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  if (added === removed) return '둘이 같다'
  return added > removed ? '추가가 더 많다' : '삭제가 더 많다'
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
    // 대표 코드(codeCandidate)는 이제 progress-worker가 이미 뽑아서 주므로, 여기서는
    // (실제 Gemini와 동일하게) 그 코드에 대한 설명 3필드만 규칙 기반으로 채운다.
    return steps.map((step) => {
      const failed = step.events.filter((e) => e.status === 'error').length
      const failNote = failed > 0 ? ` (실패 ${failed}건 재시도)` : ''
      return {
        stepId: step.stepId,
        summary: `${TONE_PREFIX[skillLevel]} ${truncateTitle(step.noteText ?? '') || '작업 진행'}${failNote}`.trim(),
        keyCode: step.codeCandidate
          ? {
              explanation: `${step.codeCandidate.filePath}에서 코드가 변경됐어요.`,
              importance:
                failed > 0
                  ? '이 부분이 방금 실패의 원인이 된 지점이에요.'
                  : '앞으로 이 코드 형태를 다른 곳에서도 다시 쓰게 되니 기억해두세요.',
              application: '비슷한 변경을 할 때 이 코드 형태를 참고해보세요.'
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

  async generateQuiz(versions: CodeUnitVersionWithUnit[], _skillLevel: SkillLevel): Promise<QuizLesson[]> {
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 실제 Gemini 없이도 "세션의 코드 변경 → 학습카드+6문항" 파이프라인을 검증하기 위한
    // 결정론적 mock. 카드 하나(=한 코드 변경)마다 서로 다른 사실을 묻는 6개 템플릿 문항을 만든다.
    const otherFilePaths = versions.map((v) => v.file_path)
    const otherUnitNames = versions.map((v) => v.unit_name)

    return versions.map((version, i): QuizLesson => {
      const code = firstDiffLines(version.diff_text, 6)
      const content = `${version.unit_name}는 ${version.file_path}에 있는 ${version.unit_type} 유닛이에요. 이번 세션에서 버전 v${version.version_no}로 ${CHANGE_LABEL[version.change_type] ?? '변경됐어요'} 아래 diff에서 실제로 바뀐 부분을 확인해보세요.`

      const unitTypeQ = rotate(QUIZ_UNIT_TYPE_OPTIONS, QUIZ_UNIT_TYPE_INDEX[version.unit_type] ?? 0, i)
      const changeQ = rotate(QUIZ_CHANGE_OPTIONS, QUIZ_CHANGE_INDEX[version.change_type] ?? 0, i + 1)
      const fileQ = buildOptionsFrom(version.file_path, otherFilePaths, i + 2)
      const nameQ = buildOptionsFrom(version.unit_name, otherUnitNames, i + 3)
      const versionNos = [version.version_no, version.version_no + 1, Math.max(1, version.version_no - 1), version.version_no + 2]
      const versionQ = rotate(versionNos.map(String), 0, i + 4)
      const balance = diffLineBalance(version.diff_text)
      const balanceOptions = ['추가가 더 많다', '삭제가 더 많다', '둘이 같다']
      const balanceQ = rotate(balanceOptions, balanceOptions.indexOf(balance), i + 5)

      const questions: QuizQuestion[] = [
        {
          prompt: `${version.unit_name}는 어떤 종류의 코드 유닛인가요?`,
          options: unitTypeQ.options,
          correctIndex: unitTypeQ.correctIndex,
          note: `${version.file_path}에 있는 ${version.unit_type} 유닛이에요.`
        },
        {
          prompt: `${version.unit_name}는 이번 세션에서 어떻게 바뀌었나요?`,
          options: changeQ.options,
          correctIndex: changeQ.correctIndex,
          note: `v${version.version_no}에서 ${CHANGE_LABEL[version.change_type] ?? '변경됐어요'}.`
        },
        {
          prompt: `${version.unit_name}는 어느 파일에 있나요?`,
          options: fileQ.options,
          correctIndex: fileQ.correctIndex,
          note: `${version.unit_name}는 ${version.file_path}에 있어요.`
        },
        {
          prompt: '방금 학습 카드에서 다룬 유닛의 이름은 무엇인가요?',
          options: nameQ.options,
          correctIndex: nameQ.correctIndex,
          note: `이번 카드는 ${version.unit_name}에 대한 내용이었어요.`
        },
        {
          prompt: '지금 다루는 코드는 몇 번째 버전(v)인가요?',
          options: versionQ.options,
          correctIndex: versionQ.correctIndex,
          note: `이 변경은 v${version.version_no}예요.`
        },
        {
          prompt: '이 diff는 추가된 줄과 삭제된 줄 중 어느 쪽이 더 많나요?',
          options: balanceQ.options,
          correctIndex: balanceQ.correctIndex,
          note: `이 diff는 ${balance} — 위 코드에서 +/− 줄 수를 세어보면 확인할 수 있어요.`
        }
      ]

      return {
        id: version.id,
        unitName: version.unit_name,
        unitType: version.unit_type,
        filePath: version.file_path,
        content,
        code,
        questions
      }
    })
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
