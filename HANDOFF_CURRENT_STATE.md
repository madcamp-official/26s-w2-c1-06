# Factcoding — 현재 구현 상태 핸드오프 (프로젝트 워크스페이스 + 턴 UI + 실시간 AI 동기화)

이 문서는 `SPEC.md`/`HANDOFF_B_AI_UI.md`(원래 기획 핸드오프)를 대체하지 않는다.
그 문서들은 "무엇을 만들기로 했는지"를 담고, 이 문서는 **"지금 실제로 뭐가 만들어져 있고 뭐가 없는지"**를 담는다.
버그/한계 상세 내역은 `KNOWN_BUGS_HANDOFF.md`에 따로 정리돼 있다.
새 세션을 시작하는 사람은 이 문서 → `KNOWN_BUGS_HANDOFF.md` → 필요하면 `SPEC.md` 순서로 읽을 것.

## 지금 git 상태 (중요 — 다음 세션이 제일 먼저 확인할 것)
- 작업은 `feature/project-workspace-realtime-ai` 브랜치에 올라가 있다(`integrate/merge-person-a-pipeline`은
  안 건드림, `main`과도 별개). HEAD는 `4d43c9e`(핸드오프 문서 갱신 커밋)이고, 그 위에 **아직 커밋 안 된
  워킹트리 변경**이 두 겹 쌓여 있다: ① 턴 해설 "사수 말풍선"/Q&A 히스토리 롤백(위 "되돌린 것" 참조,
  이 문서에 이미 반영돼 있음), ② **UI 전체 라이트 테마 리스타일 + IA 재구성**(바로 아래 새 섹션 참조,
  아직 커밋 안 됨 — `git status`/`git diff --stat`로 범위 확인). 아직 push/PR 안 함.
- 로컬 DB(`db/factcoding.db`, gitignore 대상)는 **한 번 완전히 초기화**됐다(데모 시드 없음) —
  이후 실사용(아래 "지금 로컬 DB에 실제로 들어있는 것" 참조)으로 데이터가 다시 쌓인 상태다.
  새로 리셋하고 싶으면 `rm -f db/factcoding.db* && npm run db:init`만 실행(시드는 선택, 아래 참조).

## 한 줄 요약
Day 1~7 + 파이프라인 런타임 통합 → 프로젝트 워크스페이스/턴 단위 UI 개편(Figma 톤 리스타일 포함)에
이어, 백엔드 버그 다수를 고치고 4가지 기능을 추가함: ① Q&A 대화 히스토리, ② **파이프라인 이벤트 →
IPC push**(폴링 대신 즉시 갱신), ③ **manual-watch가 파일 생성/삭제도 감지**(벌크 작업 안전장치
포함), ④ **세션 재개(resume) 시 세션 PK 분리**(같은 터미널에서 "완료"→"시작하기" 반복해도 안전).
추가로 **Gemini 모델 폴백 체인**을 넣어 무료 티어 일일 쿼터가 모델 하나를 다 써도 자동으로 더
가벼운 모델로 넘어가게 함.
**이후 사용자 요청으로 두 가지를 되돌림**: 턴 해설을 "사수 말풍선"(overview/change/concept 구조화 +
전체 구조도 하이라이트)으로 개편했던 것과 위 ①(Q&A 히스토리)을 다시 원래 형태로 롤백함 — 자세한
내용은 바로 아래 "되돌린 것" 섹션 참조. ②③④와 모델 폴백은 그대로 살아있다.
**그 다음(같은 날 후반) 사용자가 새 Figma Make 프런트엔드 목업(`Factcoding Frontend Demo.zip`)을
주고 "이 톤에 맞춰 UI를 바꿔달라"고 요청** — 다크 민트 테마 + 프로젝트/관제실/구조도/강의노트
4분할 nav였던 렌더러를 라이트 크림 테마 + "프로젝트 사이드바 + 개요/활동/노트 3탭" 구조로 전면
리스타일/재구성했다. 백엔드·훅·IPC·AI 프롬프트는 전혀 안 건드림 — 순수 렌더러 레이어 작업. 자세한
내용은 "UI 리스타일 + IA 재구성" 섹션 참조.

## 되돌린 것 (사용자 요청으로 롤백 — 2026-07-14)
- **턴 해설 "사수 말풍선" → 원래의 flat caption으로 복귀**: `explainTurn(prompt, events,
  skillLevel)`이 다시 `{caption, conceptTags}` 하나만 반환(구조 컨텍스트 조회 없음).
  `TurnDetailPanel`은 "FEATURE SUMMARY" 텍스트 + 턴 스코프 미니 구조도(하이라이트 없음) + 변경사항
  목록으로 복귀. `caption-worker`도 versions/units/edges 컨텍스트 조회를 다시 안 함. 관련 타입
  (`TurnNarrativeBubble`/`TurnNarrative`/`TurnBubbleKind`/`TurnContext`)과 유틸
  (`serializeTurnNarrative`/`parseTurnNarrative`), `StructureOverview`의 `highlightUnitIds` prop
  전부 삭제.
- **Q&A 대화 히스토리 연동 제거**: `answerQuestion`이 다시 `(question, context, skillLevel)`만
  받음. `useQna`는 히스토리를 만들어 넘기지 않음(단, "세션 바뀌면 대화 목록 비우기"는 독립적으로
  좋은 UX라 남겨둠). `QnaHistoryEntry` 타입 삭제.
- **DB 정리**: 롤백 시점에 캐시돼 있던 JSON 포맷(`turn-narrative-v1`) 턴 해설 1건을 삭제해서,
  다음 캡션 생성 시 새 flat caption 포맷으로 다시 채워지도록 함(과거 code_unit_version 캡션은
  애초에 항상 flat 포맷이라 영향 없었음).
- `caption-worker`의 크로스세션 처리(최신 세션 하나로 한정 안 함)와 실패 쿨다운, `StructureOverview`의
  `borderTop/Right/Bottom` 분리(React 스타일 충돌 경고 수정)는 위 롤백과 무관한 별개 개선이라
  그대로 유지됨 — 헷갈리지 말 것.

## UI 리스타일 + IA 재구성 (2026-07-14 후반, 이번 세션 — 아직 커밋 안 됨)
사용자가 던진 프런트엔드 데모 zip은 라이트 크림 톤 Figma Make 목업이었고, 실제 앱은 그 이전
"AI learning prototype" 목업에서 가져온 다크 민트 테마를 쓰고 있었다(둘 다 리포에 압축 풀린 채/zip
그대로 남아있음 — `AI learning prototype/`, `Factcoding Frontend Demo.zip`, 둘 다 git 추적 대상 아님).
백엔드/훅/IPC/AI 프롬프트 템플릿은 하나도 안 바꿨다 — 전부 렌더러(`src/app/renderer/src`) 스타일·
레이아웃 레이어 작업이다.

- **테마 스왑**: `styles.css`의 `:root` 토큰을 라이트 팔레트로(배경 `#fbfaf7`, 카드 `#ffffff`, 주요
  색 `#285c52`, 테두리 `#e6e4dd` 등), 폰트를 IBM Plex Sans KR/JetBrains Mono 중심에서 DM Sans +
  Noto Sans KR로 교체. 각 컴포넌트에 하드코딩돼 있던 다크 hex 클래스(`#121d25` 등)는 전부 대응하는
  라이트 톤으로 일괄 리매핑(파일별 사용 맥락을 확인한 뒤 색상 사전을 만들어 스크립트로 치환).
- **IA 재구성**: 기존 "프로젝트/관제실/구조도/강의노트" 4분할 사이드바 nav를 없애고, 데모처럼
  **사이드바에 프로젝트 목록**(이니셜 아바타는 project id 해시로 고정 팔레트에서 결정) + 선택한
  프로젝트 페이지 안에 **개요/활동/노트 3탭**으로 접었다. `App.tsx`가 `view`(`'projects' | 'project'`)
  + `activeTab`(`'overview' | 'activity' | 'notes'`) 상태로 이 구조를 관리. 기존 기능(전체 구조도,
  유닛 타임라인, 세션별 과거 조회, 난이도 슬라이더, Q&A)은 하나도 안 뺐고 새 IA 안에서 위치만 옮김:
  - **개요**: 프로젝트 구조 미니 그래프 + `RecentTurns`("직전 실행의 과정") + aside(현재 프롬프트
    실행 상태 카드/최근 강의노트/Q&A 트리거 버튼).
  - **활동**: 라이브 히어로 + `SessionContextBar`(이번 프롬프트 계획) + `PromptTimeline`(아래 참조)
    + `TurnDetailPanel` + stat 카드 3종(개념 태그/파일/이벤트) + 전체 구조도 + `UnitTimeline`
    (예전 "구조도" 탭 내용을 여기로 합침).
  - **노트**: `LectureNotesViewer` 그대로.
- **`RecentTurns.tsx`(신규, 개요 탭 "직전 실행의 과정")**: 사용자가 명시적으로 요청한 요구사항 —
  "실행한 프롬프트로 바뀐 코드에서 구현된 기능을 AI가 한 번에 정리". 이미 `caption-worker.ts`→
  `explainTurn()`이 만들어 둔 턴별 캡션(`ai_explanations.content`)을 그대로 재사용 — 새 AI 호출
  없음. **"직전"이라는 이름값대로 완료(캡션 존재)된 프롬프트만 보여주고, 아직 캡션 없는 진행 중인
  마지막 프롬프트는 완료되기 전까지 목록에서 빠진다**(진행 상태는 aside의 "현재 프롬프트" 카드가
  이미 보여주므로 중복 안 함). 항목을 펼치면 `TurnDetailPanel`을 인라인 재사용해서 구조도+diff를
  보여준다(펼침 상태 = `selectedTurnId`, 활동 탭과 공유).
- **`TurnDetailPanel.tsx` 단순화**: "FEATURE SUMMARY" 캡션 박스를 없앴다(이미 `RecentTurns`/
  `PromptTimeline` 쪽에서 캡션이 보이므로 중복) — `explanation` prop 자체를 삭제하고, 남은
  "이 턴에서 바뀐 구조"(미니 구조도)와 "변경사항"(diff 목록) 두 섹션을 헤더 하나(`N UNITS · N
  CHANGES`) 아래 한 카드로 합쳤다. 구조·변경 둘 다 없는 경우 빈 메시지도 하나로 통일(예전엔 구조
  없음/변경 없음 메시지가 각자 따로 중복 출력됐음).
- **`TurnList.tsx` → 데이터 유틸만 남기고 컴포넌트 삭제**: 세로 "턴 목록" 패널이 사이드바의 "지난
  프롬프트"(세션 목록)와 겹쳐 보인다는 사용자 피드백으로 컴포넌트(JSX) 자체를 지웠다.
  `buildTurnList`/`ORPHAN_TURN_ID`/`TurnListItem`은 그대로 남아 `RecentTurns`/`App.tsx`/
  `PromptTimeline`이 계속 씀 — 파일명은 안 바꿈.
- **`PromptTimeline.tsx`(신규, 활동 탭)**: 삭제된 `TurnList` 패널을 대체하는, "타임라인 한 줄 위
  노드" 형태의 프롬프트 선택기. 프롬프트마다 작은 원형 노드(완료=체크, 진행중=스피너, 수동수정=
  폴더 아이콘)를 과거→최신 순으로 늘어놓고 클릭하면 `selectedTurnId`가 바뀌어 아래 `TurnDetailPanel`이
  갱신된다. 노드가 `MAX_VISIBLE`(10)개보다 많아지면 오래된 것들을 대시 테두리 "…" 노드 하나로 접고,
  그 "…"를 클릭하면 같은 줄 위에서 전부 펼쳐진다(별도 팝업/드롭다운 아님, "하나의 타임라인 선" 유지).
  **빈 세션(진행 중 세션에 완료된 프롬프트가 아직 없는 경우)에도 "PROMPT TIMELINE" 헤더 + 점선
  플레이스홀더 노드 + 선을 그대로 보여준다** — 처음엔 그냥 텍스트만 있는 빈 박스였는데, 아래
  `TurnDetailPanel`의 빈 메시지 박스와 똑같이 생겨서 "타임라인이 아예 안 뜨는 것 같다"는 사용자
  피드백을 받고 고침(실제로는 렌더링 자체는 항상 잘 되고 있었고, 빈 상태 디자인만 문제였음).
- **사이드바 세션 목록 → "지난 프롬프트"로 개명 + 내용 변경**: 라벨을 "세션"→"지난 프롬프트"로
  바꾸고, 각 행의 제목을 세션 id 앞 8자리(커밋 해시처럼 보임) 대신 **그 세션의 첫 프롬프트 텍스트**로
  바꿨다. `Session` 타입은 스키마 1:1 유지, 대신 `SessionWithPreview extends Session { first_prompt_text
  }`를 새로 만들어 `db:getSessions` 핸들러(`src/app/main/index.ts`)의 SQL을 상관 서브쿼리로 확장
  (`SELECT p.user_text FROM prompts p WHERE p.session_id = s.id ORDER BY p.turn_index ASC LIMIT 1`).
  `useSessions`/`SessionList.tsx`/preload 타입 전부 `SessionWithPreview`로 갱신.
- **`StructureOverview.tsx` 레이아웃 축 스왑**: 기존엔 BFS 레이어를 x축(가로)로, 같은 레이어 내
  형제 노드를 y축(세로, `ROW_HEIGHT`)으로 쌓았는데 — 실데이터 대부분이 엣지 매칭이 안 돼(또는
  없어서) 노드 대부분이 레이어 0에 몰리다 보니 결과적으로 "세로로 긴 한 줄" 그래프가 나왔다. 축을
  바꿔 **레이어=y(위→아래), 같은 레이어의 형제=x(옆으로 나란히, `COLUMN_WIDTH`)**로 만들었다 —
  형제가 많은(=대부분 레이어 0인) 실데이터에서 오히려 가로로 넓게 펼쳐져 "한눈에" 보기 편해짐.
  `colorMode`도 `"system"`→`"light"`로 고정(OS가 다크모드면 react-flow가 자체적으로 어두워지는
  것 방지).
- **용어 통일 "턴" → "프롬프트"**: 사용자 요청으로 화면에 보이는 모든 "턴" 텍스트를 "프롬프트"로
  바꿨다(사이드바 라벨, `TURN n/m`→`PROMPT n/m` 배지, stat 카드, `SessionContextBar`의 "이번 턴의
  계획"→"이번 프롬프트의 계획" 등). 내부 타입/변수명(`TurnListItem`, `turnId`, `buildTurnList`,
  `useTurnDetail` 등)은 안 바꿈 — 영어 코드 식별자는 그대로, 한국어 UI 문구만 교체.
- **검증 방법**: 매 변경마다 `src/app/main/index.ts`의 `createWindow()`에 `FACTCODING_SCREENSHOT`
  env var로 게이팅되는 임시 블록(`capturePage()` + `executeJavaScript()`로 클릭 시뮬레이션)을
  넣었다 빼는 식으로 실제 Electron 창을 스크린샷해 확인했다(`.claude/skills/verify/SKILL.md`의
  "스크린샷 방법" 참고) — 매번 작업 끝나면 그 블록은 지우고 `npm run typecheck`로 마무리.

## 돌아가는 것 (실제로 실행해서 확인함)

### 프로젝트 워크스페이스
- 앱을 켜면 **항상 "프로젝트" 화면이 먼저 뜬다** — 프로젝트를 고르거나 새로 등록해야 그 프로젝트의
  개요/활동/노트 탭(전부 `project_id`로 스코프됨, 아래 "UI 리스타일 + IA 재구성" 참조)을 볼 수 있다.
  예전엔 이게 사이드바의 독립된 nav 항목(프로젝트/관제실/구조도/강의노트 4분할)이었는데, 이번
  리스타일로 "사이드바 프로젝트 목록 + 선택한 프로젝트의 3탭" 구조로 바뀌었다.
- 새 프로젝트 등록: 이름 입력 + `dialog.showOpenDialog`로 코드 워크스페이스 폴더 선택 →
  `projects` 테이블에 저장(get-or-create, workspace_path UNIQUE).
- `code_units.id` 해시(`computeUnitId`)에 `project_id`를 포함시켜, 서로 다른 프로젝트가 같은
  상대경로+유닛명을 가져도 id가 충돌해 구조도/버전이 섞이지 않는다.
- **주의**: 프로젝트 등록 시 워크스페이스 경로는 **Claude Code를 실제로 실행하는 디렉토리와 정확히
  일치**해야 한다. 한 칸 위(부모) 폴더를 등록하면 `~/.claude/projects/<hash>` 해시가 달라져서
  실제 세션(JSONL)과 연결이 안 되고, `manual-watch` 폴백(파일 변경 감시)만 동작한다 — 즉 "턴"
  단위 추적 없이 낱개 파일 수정만 "수동 수정"으로 잡힌다. 실사용 중 실제로 한 번 이 실수가
  났었다(부모 경로로 등록된 "팩트코딩" 프로젝트가 로컬 DB에 남아있음).

### 온보딩 + 난이도
- 3단계 위저드: **①수강 과목**(KAIST 전산학부 체크리스트 + 직접 추가) → **②프로젝트 경험**(개수 +
  기술 스택) → **③교육 스타일**(원리부터/일단 만들어보고/비유로/균형). `computeSkillProfile()`
  (`src/shared/skillProfile.ts`)이 이걸 5단계 `SkillLevel`(`novice~expert`)로 매핑.
- 헤더 아래 "난이도 조절" 슬라이더(`DifficultySlider.tsx`, 5칸)로 언제든 재조정 가능.

### 관제실 (프롬프트 단위 + 실시간 push) — 지금은 "개요"/"활동" 탭으로 나뉨
- **AI 호출**: `caption-worker.ts`가 "완료된 턴"(다음 턴이 이미 시작됐거나 세션이 끝남)당 **한 번만**
  호출해 그 턴의 모든 액션을 feature 단위로 요약한다(`AIProvider.explainTurn(prompt, events,
  skillLevel)` → `{caption, conceptTags}`). 대상은 **최신 세션 하나로 한정하지 않고** 완료된
  턴이면 어느 세션이든 처리(최신 세션 우선 정렬) — 과거 세션을 세션 목록에서 고정해 보거나
  난이도를 바꿔도 그 세션 턴 해설이 채워진다.
- **레이아웃(이번 세션에 재구성됨 — 위 "UI 리스타일 + IA 재구성" 참조)**: 예전엔 왼쪽 `TurnList`
  (컴팩트 턴 선택자) + 오른쪽 `TurnDetailPanel`("FEATURE SUMMARY" 캡션 + 미니 구조도 + 변경사항)이
  나란히 있었는데, 지금은: 개요 탭에 `RecentTurns`("직전 실행의 과정", 완료된 프롬프트만 캡션과
  함께 나열) + 활동 탭에 `PromptTimeline`(타임라인 노드로 프롬프트 선택) + `TurnDetailPanel`
  (캡션 박스 없이 구조도+변경사항만, 세로로 쌓임)로 나뉜다. 말풍선/구조도 하이라이트 같은 부가
  연출은 넣었다가 사용자 요청으로 뺐다("되돌린 것" 참조) — 다시 만들 거라면 그 커밋을 참고할 것.
- **실시간 갱신**: 폴링만이 아니라 파이프라인/워커가 DB를 갱신할 때마다 main이 `data-changed`
  IPC를 push한다(kind: `trace`/`code-units`/`explanation`/`lecture-note`/`session`, 같은 kind는
  150ms 디바운스). 렌더러의 6개 훅(`useSessionTrace`/`useTurnDetail`/`useUnitTimeline`/
  `useSessions`/`useLectureNotes`/`useMonitoring`)이 새 `useDataChanged` 훅으로 즉시 재조회하고,
  기존 폴링은 놓친 경우의 안전망으로 주기만 늘려(1~3초 → 8~10초) 남아있다.
- 프롬프트에 연결되지 않은 이벤트(수동 수정)는 `RecentTurns`/`PromptTimeline`에 "수동 수정" 항목으로
  묶여 나온다.

### 파이프라인 안정성/기능 (백엔드)
- **manual-watch**가 이제 `add`/`unlink`(생성/삭제)도 감지한다(예전엔 `change`만). 1초 안에 6개
  초과 파일이 바뀌면 "벌크 작업"(git checkout 등)으로 판단해 캐시만 동기화하고 tool_event/AST diff
  기록은 생략 — 브랜치 전환이 트레이스를 오염시키지 않는다.
- **세션 재개(resume)**: 같은 JSONL을 "완료" 후 "시작하기"로 재개하면 `resolveLogicalSessionId`가
  새 논리 세션 id(`rawId#uuid`)를 발급해 새 `sessions` 행을 만든다 — 예전엔 이미 종료 처리된
  session row를 재사용해서 재개 후 내용이 강의노트 재생성 트리거를 못 받았음. `PipelineHandle`의
  새 `session-resolved` 이벤트로 Electron main이 현재 논리 id를 추적(예전엔 JSONL 파일명 basename을
  그대로 썼는데 재개 시 실제 쓰기 대상과 달라짐).
- `stop()`이 `async`로 바뀌어 진행 중인 AST diff가 전부 DB에 기록된 뒤에 커넥션을 닫는다(예전엔
  종료 직전 편집이 유실될 수 있었음). `deleteEdgesFromFile`이 project_id로 스코프돼 다른 프로젝트의
  엣지를 잘못 지우지 않는다. jsonl-tail이 바이트 버퍼로 디코딩해 한글 등 멀티바이트 문자가 폴링
  경계에서 깨지지 않는다. `diff_text`가 URL 인코딩 patch 포맷 대신 사람이 읽는 +/- 라인 diff로 저장됨.
  (전체 목록은 `KNOWN_BUGS_HANDOFF.md` 참조.)

### AI 프로바이더
- **모델 폴백 체인**(`GeminiProvider.ts`): `gemini-flash-latest → gemini-flash-lite-latest →
  gemini-2.0-flash`. Gemini 무료 티어 쿼터는 모델별로 별도 집계되므로, 기본 모델의 하루 쿼터를
  다 써도(20회/일 정도로 매우 낮음) 자동으로 다음 모델로 넘어간다. 앞쪽 두 개는 alias(구글이 계속
  최신 모델을 가리키도록 유지)라 `gemini-2.5-flash`가 신규 키에 404 났던 문제 재발 위험이 낮고,
  마지막 한 단계만 안전망으로 구버전을 고정. 한 번 소진 확인된 모델은 5분간 건너뛴다(안 그러면
  매 호출마다 이미 죽은 모델을 처음부터 재확인하느라 키 2개 × 쿨다운 대기로 수십 초씩 낭비됨).
  4개 provider 메서드가 공통 `generateText` 헬퍼를 씀.
- `GEMINI_KEY_A`/`GEMINI_KEY_B`가 `.env`에 없으면 `MockAIProvider`로 자동 폴백. 워커(`caption-worker`/
  `lecture-note-worker`)는 같은 대상이 계속 실패하면(429/프롬프트 초과 등) 60초 쿨다운을 걸어
  무한 재시도로 API를 계속 두드리지 않는다.

### 기존 그대로 유지되는 것
- SQLite 스키마 초기화(`db/init.ts`) + 목업 시드(`db/seed.ts`, 데모 프로젝트 "campus-market (demo)"
  생성 — **단, 지금 로컬 DB는 시드를 안 돌린 빈 상태에서 실사용으로 채워진 상태**, 아래 참조).
- 구조도(전체 프로젝트, React Flow) + 코드 유닛 타임라인(`UnitTimeline.tsx`).
- 강의노트 뷰어, 모니터링 시작/완료 버튼 + 세션 목록, 파이프라인 런타임 통합(SPEC 4.6).

## 지금 로컬 DB에 실제로 들어있는 것 (스냅샷 — 계속 바뀜)
데모 시드 없이 완전히 빈 상태로 리셋한 뒤, 실사용으로 다시 채워진 상태다:
- `projects` 2개: `팩트코딩`(workspace_path가 **부모 폴더** `/Users/young/Madcamp/factcoding` —
  위 "주의" 참조, JSONL 연결 안 됨) / `factcoding-real`(workspace_path가 실제 리포 루트, 정상 연결).
- `sessions` 7개, `ai_explanations` 36개 이상(계속 증가 중, 전부 실제 Gemini 응답 — 정확한 개수는
  `SELECT COUNT(*) FROM ai_explanations`로 직접 확인). 롤백 시점에 옛 말풍선 JSON 포맷이던
  턴 해설 1건은 지워서 다시 채워지게 해뒀다.
- 앱이 `env -u ELECTRON_RUN_AS_NODE npm run dev`로 백그라운드에 떠 있을 수 있다 — 새로 켜기 전에
  `ps aux | grep electron-vite`로 기존 인스턴스가 남아있는지 먼저 확인할 것(중복 실행 시 두 프로세스가
  같은 DB에 동시에 쓰기 시도).

## 아키텍처 핵심 결정
- **AIProvider 인터페이스**(`src/ai/types.ts`): `explainTurn(prompt, events, skillLevel)` ·
  `explainUnitVersions` · `synthesizeLectureNote` · `answerQuestion(question, context, skillLevel)`.
  `createAIProvider()`가 키 존재 여부로 Gemini/Mock 자동 선택.
- **GeminiKeyPool은 라운드로빈** + 429 시 해당 키 60초 쿨다운(모델 레벨 폴백과는 별개 차원 —
  키 폴백이 먼저 소진되면 그 모델 전체를 포기하고 다음 모델로 넘어감). 무료 티어 일일 쿼터(모델당
  20회 수준) 소진은 이제 모델 폴백 체인으로 대부분 자동 해소된다.
- **caption-worker**(`src/app/main/caption-worker.ts`): 5초 틱, 틱당 provider 호출 1회 제한.
  1순위 = "완료된 턴" 중 아직 요약 없는 것(세션 무관, 최신 세션 우선), 2순위 = 남는 틱에
  code_unit_version 요약. 실패한 턴/버전은 60초 쿨다운.
- **lecture-note-worker**: 세션 종료 감지 → 세션 전체 강의노트 합성. 실패 시 60초 쿨다운.
- **프로젝트 스코프**: `PipelineConfig.projectId` → `Repo`의 세션/유닛/엣지 메서드 전부 projectId
  스코프. `computeUnitId(projectId, filePath, unitName)`.
- **세션 id는 더 이상 JSONL 파일명과 항상 1:1이 아니다**: 재개 감지 시 `rawId#uuid` 형태의 새 논리
  id가 생긴다 — "session id == JSONL 파일 basename"을 가정하는 새 코드를 짜지 말 것.
- **IPC push**: `PipelineHandle`에 `code-units-changed`/`session-updated`/`session-resolved` 이벤트가
  추가됨. Electron main이 이걸(과 기존 `transcript-event`, 워커의 저장 콜백을) 모아
  `DataChangeKind` 기반으로 디바운스 후 `mainWindow.webContents.send('data-changed', kind)` push.
- **DB 경로/정적 자산 계산 규칙**은 이전과 동일(`__dirname`/`import.meta.url` 금지, 호출부가 명시적으로
  계산해 주입).
- **`db:getSessions`가 `SessionWithPreview[]`를 반환**(`src/shared/types.ts`): `Session`은 스키마
  1:1 유지 원칙 그대로 두고, `SessionWithPreview extends Session { first_prompt_text }`를 조인
  결과 전용 타입으로 새로 만들었다(`CodeUnitVersionWithUnit`과 같은 패턴). SQL은 스키마 변경 없이
  상관 서브쿼리로 세션당 첫 프롬프트 텍스트 하나만 더 붙인 것 — IPC 함수 시그니처(인자)는 그대로,
  반환 타입 모양만 확장됨.

## 스키마 (db/schema.sql)
이번 라운드에서 스키마 변경은 없음(세션 재개는 기존 `sessions.id TEXT PRIMARY KEY`에 다른 형식의
문자열을 넣는 것으로 해결 — 컬럼 추가 불필요). 이전 라운드에서 추가된 `projects` 테이블,
`sessions.project_id`/`code_units.project_id` 컬럼은 그대로.
로컬 dev DB는 `db/*.db*`가 gitignore 대상이라, 리셋하고 싶으면
`rm -f db/factcoding.db* && npm run db:init`(+ 데모 데이터가 필요하면 `npm run db:seed`도).

## IPC 표면 (전체 목록 — preload가 `window.factcoding`으로 노출)
```
project:list, project:create, project:selectFolder,
db:getLatestSessionId, db:getToolEvents, db:getPrompts,
db:getSkillLevel, db:setSkillLevel, db:getExplanations,
db:getCodeUnits, db:getUnitVersions, db:getUnitVersionExplanations,
db:getUnitVersionsByPrompt, db:getUnitVersionExplanationsByPrompt,
db:getCodeUnitEdges, db:getLectureNotes,
db:isOnboardingComplete, db:completeOnboarding,
db:getOnboardingProfile, db:saveOnboardingProfile,
db:explainVersionOverride, db:regenerateLectureNote,
db:answerQuestion(sessionId, question, skillLevel),
db:getSessions, pipeline:startMonitoring, pipeline:completeMonitoring,
pipeline:getMonitoringStatus
```
+ **push 채널**(invoke가 아니라 `ipcRenderer.on`) `data-changed`: main이 DB 갱신 시점마다
`kind: DataChangeKind`(`trace`|`code-units`|`explanation`|`lecture-note`|`session`)를 보낸다.
렌더러는 `window.factcoding.onDataChanged(callback)`으로 구독(반환값 호출로 구독 해제).

새 IPC 추가할 땐 `src/app/main/index.ts`(핸들러) + `src/app/preload/index.ts`(브릿지) 둘 다 고칠 것.
대부분의 `db:*` 조회는 `projectId`(또는 project로 스코프된 sessionId)를 인자로 받는다 — 새 쿼리
추가 시 프로젝트 스코프를 빠뜨리지 않도록 주의. DB를 갱신하는 새 경로를 추가할 땐 관련
`broadcastDataChanged(kind)` 호출도 함께 넣을 것(안 넣어도 폴링 안전망 때문에 기능은 동작하지만,
push의 장점[즉시 반영]을 못 받는다).

## 렌더러 구조 (컴포넌트/훅 현재 목록)
- **컴포넌트**: `ProjectsView`, `SessionList`(사이드바 "지난 프롬프트"), `SessionContextBar`,
  `RecentTurns`(신규 — 개요 탭 "직전 실행의 과정"), `PromptTimeline`(신규 — 활동 탭 프롬프트
  타임라인 선택기) + `TurnDetailPanel`(캡션 박스 없이 구조도+변경사항만) + `TurnChanges`,
  `StructureOverview`(레이어=y/형제=x로 축 스왑) + `UnitTimeline`(활동 탭에 통합됨), `LectureNotesViewer`,
  `QnaChat`, `MonitoringControl`, `OnboardingModal`(3단계 위저드), `DifficultySlider`.
  `TurnList.tsx`는 더 이상 컴포넌트를 export하지 않음 — `buildTurnList`/`ORPHAN_TURN_ID`/
  `TurnListItem` 데이터 유틸만 남음(파일명은 그대로).
- **훅**: `useProjects`, `useSessions`(반환 타입이 `SessionWithPreview[]`로 바뀜 — `first_prompt_text`
  포함), `useSessionTrace`, `useUnitTimeline`, `useTurnDetail`, `useLectureNotes`, `useQna`,
  `useMonitoring`, `useOnboarding`, `useSkillLevel`, `useDataChanged`(`data-changed` push 구독 +
  지정된 kind만 필터링).
- **공유 로직**: `src/shared/skillProfile.ts`(KAIST 교과과정 데이터 + `computeSkillProfile`),
  `src/shared/format.ts`(`formatDuration`/`formatTime`/`parseConceptTags`/`formatRelativeTime`
  [신규 — "n분 전" 등 상대 시각, `RecentTurns`/`PromptTimeline`/사이드바 노트 목록에서 사용]).

## 알려진 이슈 / 최근 고친 버그
자세한 버그별 설명·재현 조건·수정 내역은 `KNOWN_BUGS_HANDOFF.md`에 있다(2026-07-13에 발견·수정한
10건 + 2026-07-14에 구현한 "다음 작업 후보" 4건 전부 기록됨). 요약:
- **알아둘 것, 안 고침**: `better-sqlite3` Node/Electron ABI 문제(아래 "다음 세션이 할 일" 참조).
  Gemini 무료 티어는 여전히 하루 총량이 유한하다 — 모델 폴백으로 완화됐을 뿐 무한하진 않음.
- **더 이상 문제 아님**: 세션 재개 시 세션 PK 재사용, 파이프라인 이벤트 미배선(폴링만 의존),
  manual-watch가 파일 생성/삭제 미감지 — 전부 해소.
- **의도적으로 다시 없앤 것**: 턴 해설 말풍선 개편, Q&A 대화 히스토리 — 버그가 아니라 사용자 요청으로
  롤백한 것("되돌린 것" 섹션 참조). "Q&A 대화 히스토리 미포함"은 다시 알려진 한계로 취급할 것.

## 아직 안 만든 것 / 남은 리스크
- **리포 루트에 목업 두 벌이 그대로 남아있음**: `AI learning prototype/`(예전 다크 테마의 출처,
  압축 풀린 폴더)와 `Factcoding Frontend Demo.zip`(이번 라이트 테마 리스타일의 출처) 둘 다 git
  추적 대상 아님(`.gitignore` 확인 안 했으면 실수로 커밋되지 않게 주의) — 참고용으로 남겨둔 것,
  삭제해도 앱 동작엔 지장 없음.
- **Q&A 대화 히스토리 미포함**(다시 원위치): `answerQuestion`은 이전 문답을 프롬프트에 넣지 않아
  후속 질문("그럼 그건 왜?")의 맥락이 끊긴다 — 한 번 구현했다가 사용자 요청으로 되돌린 것이라,
  다시 필요하면 롤백 커밋 이전 코드를 참고해 재구현 가능.
- 턴 해설은 flat caption 하나뿐 — 구조도와 연결된 서술식 설명(말풍선 개편)도 한 번 만들었다가
  되돌렸다. 재구현 시 `explainTurnPrompt.ts`/`TurnDetailPanel.tsx`/`caption-worker.ts`를 참고.
- 온보딩 원본 프로필(`onboarding_profile`)을 다시 보여주거나 재계산하는 UI 없음 — 저장만 해두고 있음.
- 같은 프로세스에 파이프라인 인스턴스가 하나뿐이라, 동시에 여러 프로젝트를 동시 관찰하는 건 안 됨.
- `data-changed` push는 kind만 구분하고 세션/프로젝트 스코프까지는 구분하지 않는다(멀티윈도우
  시나리오라면 관련 없는 창도 재조회 한 번 더 하지만, 지금은 창이 하나뿐이라 실질적 영향 없음).
- manual-watch는 여전히 `change`/`add`/`unlink`만 본다 — 파일 rename은 chokidar 레벨에서
  unlink+add 두 이벤트로 관측됨(별도 rename 처리 없음, 대체로 문제없이 동작하지만 원자적 "이름
  변경"으로서의 맥락은 트레이스에 안 남음).
- packaged 빌드(extraResources, Windows nsis) 실검증 안 됨 — dev 모드만 E2E 확인함.
- 실제 라이브 Claude Code 세션(수십 MB JSONL) 관찰 시 초기 리플레이 부하/캡션 백로그 미측정.

## 다음 세션이 제일 먼저 할 일
1. `git status`/`git branch`/`git log`로 지금 `feature/project-workspace-realtime-ai`에 있는지, 말풍선/
   Q&A 히스토리 롤백**과 이번 UI 리스타일(위 "UI 리스타일 + IA 재구성" 섹션)**이 커밋됐는지 확인
   (`git diff --stat`로 범위가 렌더러 쪽에 한정돼 있는지 — 백엔드/AI 프롬프트 파일이 섞여 있으면
   안 됨). 이 브랜치는 아직 `integrate/merge-person-a-pipeline`/`main`에 머지도 push도 안 됐다 —
   필요하면 먼저 처리.
2. `ps aux | grep electron-vite`로 이미 떠 있는 dev 인스턴스가 있는지 확인(중복 실행 방지). 있으면
   그대로 쓰거나, 새로 띄우려면 먼저 죽일 것.
3. `.claude/skills/verify/SKILL.md` 읽기 (ABI 리빌드, `ELECTRON_RUN_AS_NODE`, 스크린샷 방법).
   `node_modules/better-sqlite3`가 지금 Node용인지 Electron용인지 확인 후 필요하면 리빌드.
4. `env -u ELECTRON_RUN_AS_NODE npm run dev`로 기동 → **프로젝트 탭**에서 프로젝트 선택.
   `factcoding-real`(workspace_path가 실제 리포 루트)을 쓸 것 — `팩트코딩`(부모 경로)은 JSONL과
   연결 안 되니 정리하거나 무시.
5. 실제 Gemini 캡션이 계속 "생성 중…"이면 모델 폴백 체인이 전부 소진됐을 수 있다(드묾, 로그에서
   "다음 모델로 폴백" 메시지와 최종 실패 여부 확인) — `.env` 유무로 Mock/실제 provider 전환해
   원인 구분할 것.
6. 위 "아직 안 만든 것"에서 다음 작업 선택.
