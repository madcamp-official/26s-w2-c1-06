# Factcoding — Handoff: AI 가공 + UI 담당 (Person B)

이 문서는 이 파트를 맡은 사람의 Claude Code 세션에 컨텍스트로 제공하기 위한 것입니다. 전체 설계는 [SPEC.md](./SPEC.md)를 참고하되, 이 문서는 "당신이 정확히 무엇을 만들고 무엇을 만들지 않는지"만 다룹니다.

## 프로젝트 한 줄 요약
Vibecoding(AI 코딩 에이전트 사용 개발) 중 에이전트의 작업을 실시간 관찰·해설하고, 세션 종료 후 복습 가능한 문서로 남기는 학습용 데스크톱 앱. 1주 개발캠프, 2인 팀.

## 팀 구조
- **당신 (Person B)**: AI 가공(Gemini) + Electron/React UI 전체. 이 문서의 범위.
- **팀원 (Person A)**: 데이터 파이프라인(관찰 + AST diff). 별도 handoff(`HANDOFF_A_PIPELINE.md`) 보유.
- 둘 다 Claude Code로 개발하며, 경계는 **SQLite 스키마**(`db/schema.sql`)입니다. 팀원이 대부분의 원본 데이터 테이블을 채우고(write), 당신은 이를 읽어서(read) AI로 가공하고 화면을 보여주는(write) 쪽입니다.

## 당신의 담당 범위 (SPEC.md 4.3, 4.5, 5장)

1. **AI 처리 레이어**: `GeminiKeyPool` (Key A/B 라운드로빈 + 429 폴백), 3~5초 배칭, 3단계 난이도(초급/중급/고급)별 프롬프트 템플릿, rate limit 방어(백오프+분산+캐시).
   - 실시간 해설 캡션, 세션 종료 강의노트 합성, Q&A 챗 응답 — 세 가지 용도 모두 이 레이어를 통함.
   - 해설 요약과 개념 태그(`ai_explanations.concept_tags`, JSON 배열)는 **같은 호출에서 한 번에 생성** (별도 호출 금지 → RPM 절약).
   - 강의노트 합성 트리거: `sessions.ended_at`이 NULL→NOT NULL로 바뀌는 것을 감지 (Person A의 파이프라인이 Stop 훅으로 기록해줌, SPEC 4.3.2).
2. **Electron/React UI 전체**: 실시간 트레이스 패널, 코드 유닛 타임라인, 구조도 오버뷰(React Flow), 강의노트 뷰어, Q&A 챗 버튼, 난이도 토글(헤더) + 항목별 난이도 오버라이드 버튼.
3. **UI 정보 계층 설계 반영**: Level 0(세션/계획, 상단 고정) → Level 1(구조적 위치) → Level 2(실시간 액션) → Level 3(코드 유닛 요약+개념 태그) → Level 4(raw diff, 기본 접힘)의 progressive disclosure 구조를 그대로 화면에 구현.
4. **electron-builder 패키징** (Win/Mac).

## 당신이 쓰는(write) 테이블
`ai_explanations`, `lecture_notes`, `user_settings`

## 당신이 읽는(read) 테이블 (Person A가 채움)
`sessions`, `prompts`, `tool_events`, `code_units`, `code_unit_versions`, `code_unit_edges`

## 당신이 건드리지 않는 것 (Person A 담당)
- JSONL tail, Claude Code 훅 자동 설치 로직
- tree-sitter AST 파싱/diff/매칭 로직

**협업 전략**: Person A의 파이프라인이 완성되길 기다리지 마세요. `db/schema.sql`대로 SQLite를 초기화하고, 앞 "읽는 테이블"의 목업 데이터를 직접 INSERT하는 시드 스크립트를 만들어 UI/AI 로직을 먼저 작성하세요. 나중에 실제 파이프라인 데이터로 갈아끼우면 됩니다.

**통합 방식 (Day 5~, SPEC 4.6)**: Person A의 파이프라인을 Electron main 프로세스에 모듈로 임포트해 단일 프로세스로 실행합니다 (SQLite 동시 쓰기 문제 방지). UI 갱신은 파이프라인 → IPC push 기본 + 1초 폴링 폴백. SQLite 초기화 시 `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON` 적용.

## 데이터 계약
`db/schema.sql`이 유일한 스키마 소스입니다. 스키마를 변경해야 하면 그 파일과 `SPEC.md` 4.4를 함께 수정하고 팀원에게 알리세요.

## Gemini API 키
Key A/B(서로 다른 Google 계정 발급) 2개가 필요합니다. `.env`에 `GEMINI_KEY_A`, `GEMINI_KEY_B`로 보관하고 커밋하지 마세요.

## 디렉토리
```
/src/ai         — 당신의 코드 (gemini-provider/, prompt-templates/, key-pool/)
/src/app        — 당신의 코드 (electron main + react renderer)
/src/shared     — 공용 TS 타입 (ToolEvent, CodeUnit, CodeUnitVersion 등) — 팀원과 함께 정의
/db/schema.sql  — 공유 스키마
```

## 완료 기준 (Definition of Done)
- [ ] Electron 앱이 뜨고 실시간 트레이스 패널이 `tool_events`를 시각화 (목업 데이터 기준으로 우선 확인)
- [ ] `GeminiKeyPool`이 Key A/B 라운드로빈 + 429 폴백으로 동작, 배칭된 해설 요청이 캡션으로 스트리밍
- [ ] 난이도 토글 선택 시 `ai_explanations` 캐시 hit/miss가 올바르게 동작 (같은 항목 재조회 시 API 재호출 안 함)
- [ ] 코드 유닛 타임라인, 구조도 오버뷰, 강의노트 뷰어, Q&A 챗이 모두 가상의 데이터 소스와 연결됨
- [ ] Person A의 실제 파이프라인 데이터로 교체해도 깨지지 않음 (스키마 계약 준수 확인)

## 1주 일정 중 당신의 몫 (SPEC.md 6장)
- Day 1: Electron+React 셸 세팅, 목업 데이터 시드 스크립트
- Day 2: 트레이스 패널 UI (목업 데이터 기준)
- Day 3: Gemini provider 연동 + 배칭, 실시간 해설 캡션 UI, `skillLevel` 배관 + 프롬프트 템플릿 3종
- Day 4: Key B 폴백/쿨다운, 코드 유닛 타임라인 UI, `ai_explanations` 캐시 연결
- Day 5: 구조도 오버뷰(React Flow), Stop 훅 감지 + 강의노트 합성
- Day 6: Q&A 챗 버튼, 온보딩 난이도 질문 + 헤더 토글 + 항목별 오버라이드 버튼
- Day 7: Person A와 통합, electron-builder 패키징, 데모 리허설

---

## Claude Code 시작 프롬프트

```
Factcoding이라는 프로젝트의 "AI 가공 + UI" 파트를 맡았습니다.
이 프로젝트는 Vibecoding(AI 코딩 에이전트 사용 개발) 중 에이전트의 작업을
실시간 관찰·해설하고, 난이도(초급/중급/고급)에 맞춰 설명해주는 학습용
데스크톱 앱입니다.

먼저 factcoding/SPEC.md 전체와 factcoding/HANDOFF_B_AI_UI.md를 읽고
제 담당 범위를 파악해주세요.

오늘(Day 1) 목표:
1. Electron + Vite + React + TypeScript 프로젝트 셋업 (electron-builder까지
   고려한 구조로)
2. db/schema.sql을 better-sqlite3로 로드하는 초기화 스크립트 작성
   (팀원과 공유하는 스키마이니 그대로 사용)
3. tool_events/code_units/code_unit_versions 테이블에 목업 데이터를
   INSERT하는 시드 스크립트 작성 — 팀원(Person A)의 실제 파이프라인이
   완성되기 전까지 이걸로 UI를 개발
4. 시드 데이터를 시간순으로 읽어와 보여주는 기본 트레이스 패널 컴포넌트

JSONL 파싱이나 tree-sitter AST 관련 코드는 작성하지 마세요 — 그건
팀원(Person A) 담당이고 저는 SQLite 스키마를 통해서만 연결됩니다.
Gemini API 연동은 Day 3부터 시작할 예정이니 오늘은 손대지 않아도 됩니다.
궁금한 설계 결정이 있으면 SPEC.md 4.3/4.5/5장을 먼저 확인하고, 거기
없는 내용이면 저에게 물어봐주세요.
```
