# Factcoding — Handoff: 데이터 파이프라인 담당 (Person A)

이 문서는 이 파트를 맡은 사람의 Claude Code 세션에 컨텍스트로 제공하기 위한 것입니다. 전체 설계는 [SPEC.md](./SPEC.md)를 참고하되, 이 문서는 "당신이 정확히 무엇을 만들고 무엇을 만들지 않는지"만 다룹니다.

## 프로젝트 한 줄 요약
Vibecoding(AI 코딩 에이전트 사용 개발) 중 에이전트의 작업을 실시간 관찰·해설하고 세션 종료 후 복습 가능한 문서로 남기는 학습용 데스크톱 앱. 1주 개발캠프, 2인 팀.

## 팀 구조
- **당신 (Person A)**: 데이터 파이프라인 — 관찰 + AST diff. 이 문서의 범위.
- **팀원 (Person B)**: AI 가공(Gemini) + Electron/React UI. 별도 handoff(`HANDOFF_B_AI_UI.md`) 보유.
- 둘 다 Claude Code로 개발하며, 경계는 **SQLite 스키마**(`db/schema.sql`)입니다. 당신은 이 스키마의 대부분을 채우는(write) 쪽이고, 팀원은 이를 읽어서(read) 화면에 보여주고 AI 해설을 채우는(write) 쪽입니다.

## 당신의 담당 범위 (SPEC.md 4.1, 4.2)

1. **관찰 레이어**: `~/.claude/projects/<hash>/*.jsonl`을 tail하여 Claude Code 세션 트랜스크립트를 실시간 파싱. `user`/`assistant`/`tool_use`/`tool_result` 이벤트를 구분해 처리 (tool_result는 매칭된 tool_events 행의 `status`/`duration_ms` 갱신). 에이전트의 TodoWrite tool_use에서 턴 계획을 추출해 `prompts.plan_text`로 저장 (없으면 턴 첫 assistant 텍스트로 대체) — 훅으로 계획을 받는 게 아님에 유의 (SPEC 4.1).
2. **온보딩 자동화**: 대상 프로젝트의 `.claude/settings.json`에 `SessionStart`/`Stop` 훅을 자동 등록해 `.factcoding/session-events.jsonl`에 세션 시작/종료 마커를 기록하게 하고, 이를 tail해 `sessions.started_at`/`ended_at`을 채움. **`ended_at`은 Person B의 강의노트 합성 트리거 신호이므로 정확해야 함.**
3. **파일 스냅샷 캐시**: 경로별 전체 파일 내용을 인메모리로 유지. 세션 시작/파일 최초 언급 시 디스크에서 시딩, Edit은 캐시된 before에 `old_string→new_string`을 메모리에서 직접 치환(디스크 재읽기 금지 — 레이스 컨디션 방지), Write는 tool_use 페이로드의 전체 내용을 그대로 캐시. manual fallback도 반드시 이 캐시를 갱신.
4. **AST Diff Engine**: 캐시에서 얻은 before/after 전체 내용을 tree-sitter로 파싱해 함수/컴포넌트 단위(`code_units`) 추출, 버전 체인(`code_unit_versions`) 생성, import/call/render 관계(`code_unit_edges`) 추출.
5. **manual fallback**: 에이전트가 아닌 수동 파일 수정은 chokidar로 감지해 `tool_events.source = 'manual'`로 기록 + 스냅샷 캐시 동기화.

## 당신이 쓰는(write) 테이블
`sessions`, `prompts`, `tool_events`, `code_units`, `code_unit_versions`, `code_unit_edges`

## 당신이 건드리지 않는 것 (Person B 담당)
- Gemini API 호출, 프롬프트 템플릿, 난이도(skill_level) 처리 — `ai_explanations`, `lecture_notes` 테이블
- Electron/React UI 전체
- `user_settings` (난이도 토글 등 UI 설정값)

당신의 파이프라인은 **UI나 AI 호출 없이 완전히 독립적으로 동작·검증 가능**해야 합니다. Node.js CLI 스크립트로 실제 Claude Code 세션을 관찰시켜보고, SQLite에 정확한 데이터가 쌓이는지 `sqlite3` CLI나 간단한 쿼리 스크립트로 확인하는 것이 완료 기준입니다.

## 데이터 계약
`db/schema.sql`이 유일한 스키마 소스입니다. 스키마를 변경해야 하면 그 파일과 `SPEC.md` 4.4를 함께 수정하고 팀원에게 알리세요.

## 디렉토리
```
/src/pipeline   ← 당신의 코드 (observation/, ast-diff/, db/)
/src/shared     ← 공용 TS 타입 (ToolEvent, CodeUnit, CodeUnitVersion 등) — 팀원과 함께 정의
/db/schema.sql  ← 공유 스키마
```

## 완료 기준 (Definition of Done)
- [ ] JSONL tail이 프롬프트/tool_use/tool_result를 빠짐없이 파싱해 각 테이블에 저장
- [ ] 파일 스냅샷 캐시가 세션 시작/파일 최초 언급 시 정확히 시딩되고, Edit은 디스크 재읽기 없이 메모리 치환으로, manual 수정은 chokidar 트리거로 동기화됨
- [ ] Edit/Write 발생 시 AST diff가 실행되어 `code_units`/`code_unit_versions`가 정확히 생성 (created/modified/deleted 판별 포함)
- [ ] `code_unit_edges`에 imports/calls/renders가 최소 JS/TS/JSX 기준으로 채워짐 (파일 재파싱 시 from 기준 삭제 후 재삽입)
- [ ] TodoWrite 기반 계획 추출이 `prompts.plan_text`로 연결됨
- [ ] SessionStart/Stop 훅이 자동 설치되고 `sessions.started_at`/`ended_at`이 정확히 기록됨
- [ ] 위 전체가 Electron 없이 Node 스크립트만으로 재현·검증 가능하되, **Electron main에서 모듈로 임포트 가능한 라이브러리 형태로 export** (Day 5 통합 방식, SPEC 4.6)

## 1주 일정 중 당신의 몫 (SPEC.md 6장)
- Day 1: JSONL tail 프로토타입, raw 이벤트 파싱 (콘솔 출력 수준)
- Day 2: tree-sitter AST diff engine, `code_units`/`versions`/`edges` SQLite 저장까지
- Day 3~4: 엣지 케이스 보강 (여러 파일 동시 수정, 빠른 연속 Edit 배칭 등), 팀원과 스키마 최종 고정
- Day 5~7: Person B와 통합, 실제 세션으로 end-to-end 테스트

---

## Claude Code 시작 프롬프트

```
Factcoding이라는 프로젝트의 "데이터 파이프라인" 파트를 맡았습니다.
이 프로젝트는 Vibecoding(AI 코딩 에이전트 사용 개발) 중 에이전트의 작업을
실시간 관찰하고 해설하는 학습용 데스크톱 앱입니다.

먼저 factcoding/SPEC.md 전체와 factcoding/HANDOFF_A_PIPELINE.md를 읽고
제 담당 범위를 파악해주세요.

오늘(Day 1) 목표:
1. src/pipeline 아래 TypeScript + Node.js 프로젝트 초기 세팅 (Electron/React 없음)
2. db/schema.sql을 better-sqlite3로 로드하는 초기화 스크립트 작성
3. ~/.claude/projects/ 안에서 현재 프로젝트에 해당하는 JSONL 세션 파일을
   찾아 tail하는 watcher 프로토타입 작성 — 새로 append되는 라인을 파싱해서
   user/assistant/tool_use/tool_result 타입별로 콘솔에 출력만 하는 수준으로 시작

Electron, React, Gemini API 관련 코드는 작성하지 마세요 — 그건 팀원(Person B)
담당이고 저는 SQLite 스키마를 통해서만 연결됩니다. 궁금한 설계 결정이 있으면
SPEC.md 4.1/4.2를 먼저 확인하고, 거기 없는 내용이면 저에게 물어봐주세요.
```