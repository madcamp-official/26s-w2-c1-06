import type { SkillLevel } from '@shared/types'

// SPEC 5.1: 원본 데이터는 동일하고, 이 톤 지시문만 skillLevel에 따라 교체한다.
export const SKILL_TONE_INSTRUCTIONS: Record<SkillLevel, string> = {
  beginner:
    '전문 용어를 최소화하고 일상적인 비유를 사용해서, "왜 이 작업을 했는지"부터 단계적으로 설명해줘. 프로그래밍을 처음 배우는 사람도 이해할 수 있어야 해.',
  intermediate:
    '함수/패턴 이름은 그대로 사용하되 간결하게 설명해줘. 흔히 쓰이는 패턴이라는 맥락 정도만 짧게 덧붙여줘.',
  advanced:
    '트레이드오프와 설계 의도 위주로, 압축된 문장으로 설명해줘. 이미 알고 있을 기초 개념 설명은 생략해.'
}
