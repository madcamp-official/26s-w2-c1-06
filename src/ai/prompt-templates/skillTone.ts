import type { SkillLevel } from '@shared/types'

// SPEC 5.1: 원본 데이터는 동일하고, 이 톤 지시문만 skillLevel에 따라 교체한다.
export const SKILL_TONE_INSTRUCTIONS: Record<SkillLevel, string> = {
  beginner:
    '전문 용어를 최소화하고 일상적인 비유를 사용해서, "왜 이 작업을 했는지"부터 단계적으로 설명해줘. 예: 데이터베이스→창고, API→배달원. 프로그래밍을 처음 배우는 사람도 이해할 수 있어야 해.',
  intermediate:
    '일반적인 개발 패턴과 라이브러리 기능은 이름으로 언급하되, 핵심만 민첩하게 중계해줘. 군더더기 기초 설명은 생략해.',
  advanced:
    '아키텍처 구조, 성능 트레이드오프, 설계 의도 중심으로 압축적이고 날카롭게 분석해줘. 이미 알고 있을 기초 개념 설명은 생략해.'
}
