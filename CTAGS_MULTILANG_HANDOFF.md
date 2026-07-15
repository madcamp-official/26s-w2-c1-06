# Factcoding — ctags 기반 다국어 구조도 핸드오프 (미완료 항목 정리)

이 문서는 `HANDOFF_CURRENT_STATE.md`를 대체하지 않는다. 거기 담긴 "지금 전체 앱이 뭘
지원하는지"는 그대로고, 이 문서는 "JS/TS/TSX 외 언어 구조도 지원" 기능 하나만 좁게 다룬다 —
뭘 만들었고, 뭘 검증했고, **뭐가 아직 안 됐는지**. 새 세션에서 이 기능을 이어받는다면 이
문서 → 아래 "다음에 할 일" 순서로 보면 된다.

**⚠️ 이 문서 제목은 "ctags 기반"이지만 더 이상 정확하지 않다.** 원래는 JS/TS/TSX만
tree-sitter, 그 외 전 언어(Python/Go/Java 포함)는 ctags로 처리했었다. 이후 세션에서
**Python → Go → Java 순으로 차례로 tree-sitter 경로로 옮겼다** — ctags는 정의 태깅만
하고 참조/호출 해석을 안 해서 갭이 너무 컸기 때문(아래 "Python/Go/Java는 왜 tree-sitter로
옮겼나" 참조). **지금 ctags 경로가 담당하는 건 Python/Go/Java를 제외한 나머지 언어
(Rust/C/C++/Ruby/PHP/... ~97개)뿐이고, 이 언어들은 여전히 최초 설계 그대로 "함수/클래스
노드만, 엣지 없음" 상태다.**

## 한 줄 요약
JS/TS/TSX/**Python**/**Go**/**Java**는 tree-sitter로 실제 AST를 파싱해 함수/클래스 노드 +
import/calls 엣지까지 뽑는다. 그 외 언어(Rust/C/C++/... Universal Ctags가 인식하는 범위)는
ctags를 실행해 함수/클래스 노드만 뽑는 대체 경로를 쓴다 — **이 경로는 노드만 나오고
엣지(관계선)는 전혀 안 나온다** (ctags는 정의 태깅 전용 도구라 참조/호출 해석 자체가
불가능, 알려진 구조적 한계). 배포용 빌드는 ctags 바이너리 패키징이 아직 안 됨(아래
"1. 패키징" 참조) — **단, Python/Go/Java는 tree-sitter wasm 방식이라 이 패키징 문제
자체가 없다.**

## 왜 이 방식인가 (선택 배경)
- tree-sitter로 언어를 하나씩 추가하려면 언어마다 grammar 확보 + 쿼리 작성 + edge 해석
  로직을 새로 짜야 해서 언어당 비용이 안 줄어든다 — 단, **grammar 확보 자체는 사실상
  공짜라는 게 이번에 밝혀졌다**(`tree-sitter-wasms` npm 패키지가 Go/Java/Rust/C/C++/
  Ruby/PHP/Kotlin/Swift 등 대부분의 주류 언어 `.wasm`을 이미 사전 컴파일해서 제공 —
  실제 확인함). 남은 진짜 비용은 언어마다 다른 **쿼리 작성 + import/calls 해석 로직**뿐.
- LSP(`callHierarchy`)는 진짜 해석된 호출관계를 주지만 언어 서버 프로세스 관리 등
  서브시스템을 새로 만들어야 해서 초기 투자가 크다 — 여전히 배제.
- **Universal Ctags는 이미 ~100개 언어의 정의(함수/클래스) 파서가 내장**돼 있어서, 한 번
  연동하면 언어별 추가 구현 없이 폭넓게 커버된다 — 대신 ctags는 원래 "정의 위치 태깅"
  도구라 호출관계 해석 기능이 없다는 게 알려진 트레이드오프였다.
- **Python/Go/Java는 예외로 tree-sitter로 옮겼다** — 이유는 아래 별도 섹션 참조. grammar
  확보 비용이 공짜가 된 지금, "언어당 비용이 크다"는 판단은 **쿼리/엣지 로직 작성
  비용에 한해서만** 유효하다 — 사용 빈도가 높은 언어부터 순차적으로 이 비용을 지불할
  가치가 있다고 보고 있다(다음 후보는 Rust/C++ 등 — 아래 "다음에 할 일" 참조).

## Python/Go/Java는 왜 tree-sitter로 옮겼나
ctags 경로로 Python의 import 해석을 점진적으로 넓혀가다가(상대 임포트 → 점 없는 절대
임포트) 한계에 부딪혔다: **ctags는 정의만 태깅하고 호출/참조를 해석하지 않으므로, 같은
파일 안에서 함수가 함수를 부르는 것조차(`calls` 엣지) 원천적으로 못 뽑는다.** 별칭
임포트(`import x as y`)도 ctags가 `roles: "indirectlyImported"`라는 별도 role로 태깅해서
기존 필터(`roles === 'imported'`)에 조용히 걸러졌었다. 이런 갭을 하나씩 땜질하는 대신,
**Python 하나만 JS/TS와 같은 tree-sitter 경로로 승격**시켜 한 번에 해결했다:
- `tree-sitter-wasms`(npm) 패키지가 Python용 사전 컴파일 `.wasm`을 제공 — ctags 바이너리와
  달리 **정적/동적 링크 이슈 자체가 없어 패키징 갭(아래 "1")도 Python은 자동으로 해결됨**.
- 진짜 AST가 있으므로 import(상대/절대/별칭 전부) + calls(같은 파일 호출, `self.method()`
  같은 클래스 메서드 호출, `import x as y; y.func()` 같은 모듈 속성 호출까지) 전부 해석
  가능해졌다.

Go도 같은 이유로 승격했다 — ctags 경로에선 Go도 노드만 나오고 엣지가 전혀 없었다. 다만
Go는 **문법 구조상 애초에 Python보다 쉬웠다**:
- 함수/메서드가 함수 안에 중첩되는 문법 자체가 없다(중첩된 건 `func_literal`이라는 별개
  노드 타입) — Python의 "부모를 걸어 올라가며 중첩 여부 판별" 로직이 아예 필요 없었다.
- 메서드는 `method_declaration`의 `receiver` 필드에 소속 타입이 **명시적으로** 붙어
  있다 — Python처럼 부모를 걸어 올라가 소속 클래스를 찾을 필요가 없다.
- 대신 **Go 패키지는 파일이 아니라 디렉토리 단위**라는 새로운 문제가 있었다 — import
  경로 하나가 그 디렉토리 안 여러 `.go` 파일 중 정확히 어느 파일로 떨어지는지는 AST만
  봐선 알 수 없다. tree-sitter로 후보 파일을 전부 재파싱하는 대신 가벼운 텍스트 스캔
  (최상위 `func Name(` 존재 여부)으로 근사했다 — ctags 수준 근사치지만 훨씬 싸다.

Java도 같은 이유로 승격했다. Java는 Go의 go.mod 같은 "임포트 경로 → 실제 디렉토리"의
결정론적 단서가 없다(소스 루트가 `src/main/java/`인 게 관례지만 강제되지 않음)는 게
사전에 예상한 관건이었는데, 실제로는 **다른 결정론적 단서를 찾아서 풀었다** — 이 파일
자신의 `package` 선언. `package com.example;`가 있는 파일은 컴파일이 되려면 반드시
`.../com/example/`로 끝나는 디렉토리에 있어야 하므로, 그 파일의 실제 디렉토리에서
패키지 경로만큼만 거슬러 올라가면 **그 파일에 한해서는** 소스 루트가 추측이 아니라
확정된다(워크스페이스 전체에 대한 휴리스틱이 필요 없음). 그 외 두 가지 이유로 오히려
Python/Go보다 수월했다:
- Java는 모든 메서드가 항상 클래스 안에 있어야 하는 문법이라, 한정자 없는 호출
  (`method_invocation`에 `object` 필드가 없음)은 **AST 구조 자체가 이미** "같은 클래스
  자신의 메서드"라고 알려준다 — Python의 `self`/Go의 리시버 변수 이름 확인 같은 추가
  판별이 필요 없다.
  아이러니: **정의(Java, public 클래스 이름 = 파일명 관례)를 감안하면** import한
  클래스의 셀렉터 호출(`ClassName.method()`)을 풀 때도 Go처럼 파일 내용을 스캔할
  필요 없이 `${ClassName}.${method}`를 바로 구성하면 된다 — Go보다 한 단계 더 간단.
- 같은 패키지(같은 디렉토리)의 다른 클래스는 import 없이도 바로 쓸 수 있는 Java 특유의
  규칙도, 같은 파일명 관례 덕에 파일 존재 여부만 확인하면 돼서 Go의 텍스트 스캔보다
  간단했다.

## 구현된 것
| 파일 | 내용 |
|---|---|
| `src/pipeline/ast-diff/parser.ts` | `SupportedLang`에 `'python'`/`'go'`/`'java'` 추가, `.py`/`.go`/`.java` 확장자 라우팅, 각 `grammars/tree-sitter-*.wasm` 로드 |
| `src/pipeline/ast-diff/grammars/tree-sitter-python.wasm`, `tree-sitter-go.wasm`, `tree-sitter-java.wasm`(신규) | `tree-sitter-wasms@0.1.13`에서 추출한 사전 컴파일 바이너리. 크로스 컴파일 불필요 |
| `src/pipeline/ast-diff/unit-extractor.ts` | JS 계열 로직은 `extractJsFamilyUnits`로 이름만 바꾸고 그대로 유지. Python/Go/Java 전용 `extractPythonUnits`/`extractGoUnits`/`extractJavaUnits` 신규 — 판별 로직은 언어마다 상당히 다름(아래 "핵심 동작 원리" 참조) |
| `src/pipeline/ast-diff/edge-extractor.ts` | JS 계열은 `extractJsFamilyEdges`로 이름만 바꿈. Python/Go/Java 전용 `extractPythonEdges`/`extractGoEdges`/`extractJavaEdges` 신규. `extractEdges`가 `parsed.lang`으로 4방향 분기 |
| `src/pipeline/ast-diff/ctags-extractor.ts` | Python 전용이었던 `resolveModulePath`/`findModuleFile`/`buildImportEdges` 전부 제거(Python이 이 경로를 안 타게 되며 죽은 코드가 됨) — 이제 `extractWithCtags`는 항상 `edges: []`만 반환, 노드만 뽑는 최초 설계로 단순화 |
| `src/pipeline/index.ts` | `runAstDiff`가 `langForFilePath(filePath)`로 tree-sitter/ctags 분기하는 구조는 그대로. `.py`/`.go`/`.java`가 이제 tree-sitter 분기로 감(이전엔 ctags 분기였음) |
| `src/app/main/index.ts`, `src/pipeline/config.ts`, `src/shared/types.ts` | `ctagsBinaryPath` 배선(Rust 등 나머지 언어용) — 이전 세션에서 완료, 변경 없음 |
| `electron-builder.yml` | ctags 패키징 갭은 여전히 TODO 주석만 있음(Python/Go/Java는 이제 이 문제 자체가 없음) |

### 핵심 동작 원리 — ctags 경로 (`ctags-extractor.ts`, Rust/C/C++/... 대상)
- **유닛 범위 계산**: ctags는 시작 줄 번호만 주고 끝 줄은 안 주므로, "다음 정의가 나오는
  줄 직전까지"를 그 유닛의 텍스트로 근사한다. 컨테이너(class/struct 등)는 자기 자신을
  scope로 갖는 다음 정의(=자기 멤버)를 건너뛰고 그다음 진짜 형제 정의까지로 계산한다
  (`buildUnits` 함수).
- **메서드 이름 합성**: `scope`/`scopeKind`가 class-like 컨테이너일 때만 `Class.method`
  형태로 합성한다.
- **엣지는 없다.** `extractWithCtags`는 항상 `edges: []`를 반환한다 — ctags가 참조/호출을
  해석하지 않기 때문에 구조적으로 못 만든다(예전엔 Python만 예외적으로 import 엣지를
  근사 처리했지만, Python이 tree-sitter로 옮겨가며 그 로직은 삭제했다).

### 핵심 동작 원리 — Python tree-sitter 경로 (`unit-extractor.ts`/`edge-extractor.ts`)
- **중첩/메서드 판별**: Python은 함수·메서드·클로저가 전부 `function_definition`
  노드 하나뿐이라 JS처럼 선언 종류별로 쿼리를 나눌 수 없다. 일단 전부 캡처한 뒤
  부모를 `module`(파일 최상위)까지 걸어 올라가며: 중간에 다른 `function_definition`을
  만나면 중첩 클로저로 제외, `class_definition`을 만나면 그 클래스의 메서드로
  `Class.method` 이름을 합성한다.
- **import 해석**: `import x`/`import x as y`(모듈 전체) vs `from x import y`/`from x
  import y as z`(심볼)를 구분해서 각각 다른 맵(`modules`/`symbols`)에 담는다. 상대
  임포트(`from .x import y`, `from . import y`)와 점 없는 절대 임포트(`from x import y`)
  둘 다 같은 디렉토리 → 워크스페이스 루트 순으로 파일 존재를 확인해 해석한다.
  `from . import y`처럼 "from" 뒤에 남는 게 없으면 `y` 자체가 서브모듈(파일)이라는
  뜻이므로 심볼이 아니라 모듈로 취급한다.
- **calls 해석**: 직접 호출(`foo()`)은 같은 파일 유닛 이름 또는 임포트한 심볼 이름과
  매칭. `obj.attr()` 형태의 속성 호출은 두 가지만 특별 취급한다 — ① `self`/`cls`인 경우
  같은 클래스의 다른 메서드(`Class.attr`)로, ② `obj`가 임포트한 모듈의 로컬 이름인 경우
  그 모듈 파일의 `attr` 유닛으로. 그 외의 임의 객체(`some_instance.method()`)는 JS
  경로와 동일하게 특정 불가로 스킵한다(알려진 한계, MVP).
- **와일드카드 임포트**(`from x import *`)는 어떤 심볼이 있는지 알 수 없어 여전히
  미해석 — 스킵.

### 핵심 동작 원리 — Go tree-sitter 경로 (`unit-extractor.ts`/`edge-extractor.ts`)
- **중첩/메서드 판별 불필요**: Go는 named 함수/메서드를 함수 안에 중첩시키는 문법이
  아예 없다(중첩된 건 `func_literal`이라는 별개 노드 타입) — 그래서 Python의
  `findPythonEnclosingFunctionOrClass` 같은 부모 탐색이 필요 없다. 메서드는
  `method_declaration`의 `receiver` 필드에 소속 타입이 명시적으로 붙어 있어 그대로
  `Type.Method` 이름을 합성한다.
- **쿼리 필드 순서 주의(실제로 겪은 함정)**: tree-sitter 쿼리에서 한 노드에 여러 필드
  제약(`receiver:`, `name:`)을 걸 때, **grammar의 실제 자식 순서와 다르면 쿼리 자체가
  컴파일 에러("Bad pattern structure")로 실패**한다. `method_declaration`은 실제
  자식 순서가 `receiver` → `name`이라 쿼리도 그 순서로 써야 한다(반대로 쓰면 실패,
  실제 wasm으로 재현/확인함).
- **import 해석 — go.mod 기반**: 워크스페이스 루트의 `go.mod`에서 `module` 선언을
  읽어 임포트 경로(`"myproject/pkg/util"`)를 워크스페이스 내 디렉토리로 매칭한다.
  Go 패키지는 파일이 아니라 **디렉토리 단위**라 "그 디렉토리의 어느 파일에 심볼이
  있는지"는 다시 텍스트 스캔(최상위 `func Name(` 존재 여부)으로 찾는다 — 이 스캔
  로직(`findTopLevelFuncFile`)은 같은 패키지 안 다른 파일을 한정자 없이 부르는
  Go의 흔한 관용구(`OtherFunc()`, 아래 calls 항목) 해석에도 재사용된다.
- **calls 해석**: 직접 호출은 같은 파일 유닛 → 안 되면 같은 디렉토리(같은 패키지)의
  다른 파일을 텍스트 스캔. `obj.attr()` 셀렉터 호출은 두 가지만 특별 취급 — ①
  `obj`가 그 메서드 자신의 리시버 변수 이름(Go는 Python의 고정된 `self`와 달리
  리시버 이름을 자유롭게 지으므로 유닛마다 실제 이름을 다시 읽어야 함)과 같으면
  같은 구조체의 다른 메서드로, ② `obj`가 임포트한 패키지의 로컬 이름이면 그
  패키지 디렉토리에서 스캔. 그 외 임의 지역 변수(`c := &Calculator{}; c.Add()`처럼
  리시버도 임포트한 패키지도 아닌 경우)는 JS/Python과 동일하게 대상 특정 불가로
  스킵한다(회귀 아님, 의도된 동일 수준의 한계).
- **import 단독 엣지 없음**: Go의 셀렉터 호출은 사실상 전부 "패키지 전체 임포트"
  형태라(Python처럼 "심볼만 콕 집어 임포트"하는 문법이 없음) `calls` 하나로
  수렴시켰다 — Python의 `imports` 엣지 타입에 대응하는 것을 Go엔 아직 안 만듦.

### 핵심 동작 원리 — Java tree-sitter 경로 (`unit-extractor.ts`/`edge-extractor.ts`)
- **중첩 클래스 판별**: Java는 모든 메서드가 클래스류(class/interface/enum/record) 안에
  있어야 하는 문법이라 Go의 "중첩 불가" 이점은 없다 — 대신 내부 클래스가 흔하다.
  `collectJavaEnclosingClassLikes`가 declNode부터 `program`까지 걸어 올라가며 클래스류
  조상을 전부 센다: 정확히 1겹이면 최상위 클래스의 직속 멤버로 포함, 0겹(클래스
  자신이면 최상위)이거나 2겹 이상(중첩 클래스 소속)이면 제외 — "최상위 선언만"(SPEC
  4.2) 원칙을 클래스에도 메서드에도 동일하게 적용.
- **소스 루트 — 이 파일 자신의 package 선언에서 역산**: 워크스페이스 전체에 대한
  휴리스틱(예: "src/main/java 관례겠거니") 대신, **지금 파싱 중인 파일**의
  `package com.example;` 선언과 그 파일의 실제 디렉토리를 대조해 세그먼트 단위로
  일치하는 만큼만 정확히 걷어낸다(`stripPackageSuffix`) — 안 맞으면(비정상
  프로젝트 구조) 그 파일의 임포트는 조용히 미해석 처리.
- **import 해석 — 두 갈래**: `import a.b.ClassName;`처럼 마지막 세그먼트가 파일로
  바로 풀리면 `classes` 맵(셀렉터 호출 `ClassName.method()`용). 안 풀리면 마지막
  세그먼트를 떼고 다시 시도해 앞 세그먼트를 파일로, 마지막 세그먼트를 그 파일의
  멤버로 취급하는 `members` 맵(`import static a.b.C.member;`나 `import
  a.b.Outer.Inner;` 같은 중첩/정적 임포트용, 보통 한정자 없이 쓰이므로 bare 호출
  쪽에서 매칭). 와일드카드(`import a.b.*;`)는 Python과 동일하게 심볼을 몰라 미해석.
- **calls 해석**: `method_invocation`에 `object` 필드가 없거나 `this`면 **AST 구조
  자체가** 같은 클래스 자신의 메서드 호출이라고 알려준다(Python의 `self`/Go의 리시버
  변수 이름 확인 같은 별도 판별이 필요 없음 — Java가 Python/Go보다 쉬웠던 지점).
  `obj.method()` 형태는 ① `obj`가 임포트한 클래스의 로컬 이름이면 그 파일의
  `${obj}.${method}`로(Go와 달리 파일 내용 스캔 없이 관례상 바로 구성 가능), ②
  임포트가 없으면 같은 디렉토리에 `${obj}.java`가 있는지 확인(같은 패키지, import
  불필요 규칙) 순으로 시도. 둘 다 아니면 임의 지역 변수라 스킵(JS/Python/Go와 동일
  수준 한계).

## 검증한 것 (실제로 확인함, 추측 아님)
### ctags 경로 (Rust/C/C++ 등 나머지 언어 — 여전히 유효, 최초 세션에서 검증)
- **Go(ctags 시절)**: `type Foo struct{}` + 메서드 하나 + 최상위 함수 하나를 유닛으로
  정확히 추출하는 것까지만 확인했었다(엣지는 애초에 없음) — **이제 Go는 tree-sitter로
  옮겨서 이 검증 결과는 폐기, 아래 Go 섹션이 최신이다.**

### Python tree-sitter 경로 (이전 세션에 검증 — 이전 ctags 기반 검증 결과는 폐기)
CLI 파이프라인(`npm run pipeline`)을 격리된 스크래치 프로젝트 + 격리 DB로 직접 띄워서
DB에 쿼리로 확인함(스크린샷 아님, 실제 실행 결과):
- `from .helpers import shout`(상대 임포트) + 호출 → **`calls` 엣지** 정상 생성(ctags
  땐 `imports` 엣지만 가능했음, 아예 다른 엣지 타입으로 격상).
- `class Calculator: def add(self): return self.log_and_add()` → `Calculator.add`가
  `Calculator.log_and_add`를 부르는 **`calls` 엣지** 정상 생성 — ctags로는 원천적으로
  불가능했던 것.
- `Calculator()` 인스턴스화 → `calls` 엣지 정상.
- `from calculator import Calculator, subtract as sub`(절대 + 별칭 혼합) → 둘 다 정상 해석.
- `import calculator as calc; calc.subtract(...)`(모듈 전체 임포트 + 속성 호출) → 단독
  격리 테스트로 별도 확인, 정상 해석.
- **JS/TS 회귀 없음**: 같은 스크래치 프로젝트에 `.ts` 파일을 추가해 import/calls 엣지가
  그대로 나오는 것으로 `extractJsFamilyUnits`/`extractJsFamilyEdges` 분리 리팩터링이
  기존 동작을 안 깼음을 확인.

### Go tree-sitter 경로 (이번 세션에 검증)
CLI 파이프라인을 격리된 스크래치 Go 모듈(`go.mod` + 패키지 2개) + 격리 DB로 직접 띄워서
확인함:
- `type Calculator struct{}` + `func (c *Calculator) Add(...)`/`LogAndAdd(...)` →
  유닛 이름이 `Calculator`/`Calculator.Add`/`Calculator.LogAndAdd`로 정확히 합성됨.
- `func (c *Calculator) Add(a, b int) int { return c.LogAndAdd(a, b) }`(리시버로 같은
  구조체 메서드 호출) → **`calls` 엣지** 정상 생성.
- `Subtract(...)`을 다른 파일(`helpers.go`)에서 한정자 없이 호출(같은 패키지, Go의
  흔한 관용구) → 텍스트 스캔으로 정확히 해당 파일의 유닛에 `calls` 엣지 연결.
- `import "demoapp/pkg/util"` 후 `util.Shout(...)` 호출(다른 패키지, go.mod 기반 해석)
  → `pkg/util/util.go`의 `Shout` 유닛에 `calls` 엣지 정상 생성.
- **의도된 한계 확인**: `main()` 안에서 `c := &Calculator{}; c.Add(...)`처럼 리시버도
  임포트한 패키지도 아닌 임의 지역 변수의 메서드 호출은 예상대로 미해석(스킵) — JS/Python과
  동일한 수준의 한계라 회귀 아님.

### Java tree-sitter 경로 (이번 세션에 검증)
CLI 파이프라인을 격리된 스크래치 Maven 스타일 레이아웃(`src/main/java/com/example/...`)
+ 격리 DB로 직접 띄워서 확인함:
- `package com.example;` + `Calculator`/`Helper` 클래스, `package com.example.util;` +
  `Constants` 클래스 → 유닛 이름이 `Calculator`/`Calculator.add`/`Calculator.logAndAdd`/
  `Helper`/`Helper.shout`/`Constants`/`Constants.computeMax`로 정확히 합성됨(소스 루트를
  각 파일의 `package` 선언에서 역산한 게 정확히 맞아떨어짐).
- `public int add(...) { return logAndAdd(...); }`(한정자 없는 호출 = 같은 클래스 메서드,
  Python의 `self`나 Go의 리시버 이름 확인 없이 AST 구조만으로 판별) → **`calls` 엣지**
  정상 생성.
- `Helper.shout("adding")`(같은 패키지, import 문 없이 호출 — Java 특유의 규칙) → 같은
  디렉토리의 `Helper.java` 파일 존재만 확인해 정상 연결.
- `import static com.example.util.Constants.computeMax;` 후 한정자 없이 `computeMax()`
  호출(다른 패키지, 정적 임포트) → `Constants.java`의 `Constants.computeMax` 유닛에
  `calls` 엣지 정상 생성 — Go의 go.mod 같은 결정론적 단서가 없다고 우려했던 부분인데,
  이 파일 자신의 package 선언으로 소스 루트를 역산하는 방식으로 실제로 정확히 풀림.

## 아직 안 된 것 / 다음에 할 일 (우선순위 순)
**아래는 전부 ctags 경로(Rust/C/C++/... Python/Go/Java 제외) 얘기다.** Python/Go/Java는
각각 작업 당시 세션에서 패키징 갭(#1)과 엣지 갭(#2)이 전부 해결됐다.

### 1. 패키징 — 배포 빌드에서 ctags가 안 돌아감 (Rust/C/C++/... 대상, Python/Go/Java 무관)
Homebrew ctags 바이너리는 jansson/libyaml에 동적 링크돼 있어서 그대로 복사하면 다른
사용자 컴퓨터에서 실행이 안 된다. `electron-builder.yml`엔 TODO 주석만 있고 실제
`extraResources` 항목은 없음. **정적 링크로 다시 빌드한 플랫폼별(mac/win) 바이너리를
준비해서 주석을 풀어야 한다.** 크로스 컴파일 환경이 없어서 여러 세션째 안 하고 있음.
**지금은 `npm run dev`(개발 모드)만 작동한다.**

### 2. 다음 tree-sitter 이관 후보 — Rust/C++ 등, 우선순위 재확인 필요
Python → Go → Java 세 번 다 같은 결론이었다: **ctags 기반 엣지 해석은 구조적으로 한계가
뚜렷해서 결국 tree-sitter로 옮기는 게 정공법이다.** `tree-sitter-wasms` 패키지에 Rust/C/
C++/C#/Ruby/PHP/Kotlin/Swift 등 대부분의 `.wasm`이 이미 있음을 실제로 확인했으므로
(grammar 확보 비용은 0에 가까움), 다음도 쿼리+엣지 로직 작성 비용만 남는다. 원래
논의됐던 "Java → Go" 우선순위는 이제 소진됐으니, 다음 언어는 실사용 빈도 기준으로
다시 정할 것. 세 번 반복하며 쌓은 교훈:
- 쿼리에서 여러 필드 제약을 한 노드에 걸 때 **grammar의 실제 자식 순서**를 지켜야 함
  (안 그러면 컴파일 에러) — 다음 언어도 실제 wasm으로 먼저 파싱해보고 순서를 확인할 것.
- "패키지가 디렉토리 단위"(Go)처럼 언어마다 고유한 구조적 함정이 있을 수 있다 — 하지만
  "그 파일 자신의 선언에서 소스 루트/모듈 정보를 역산"하는 패턴(Java의 package
  선언, Go의 go.mod)이 매번 워크스페이스 전체 휴리스틱보다 훨씬 안정적이었다. 다음
  언어도 "그 언어가 파일 자신에 담고 있는 위치 정보"부터 찾아볼 것(예: Rust의
  `mod` 선언, C++의 `#include` 상대/절대 경로 관례).
- 메서드가 항상 컨테이너(클래스 등) 안에 있어야 하는 언어(Java)는 한정자 없는 호출이
  구조적으로 모호하지 않아 Python(`self`)/Go(리시버 이름) 같은 추가 판별이 필요 없었다
  — 다음 언어가 이 범주인지(Rust는 아님, impl 블록 밖 자유 함수 가능) 먼저 확인.

### 3. kind 매핑 테이블을 Python/Go/Java 외 언어로 검증 안 함
`ctags-extractor.ts`의 `FUNCTION_LIKE_KINDS`/`CLASS_LIKE_KINDS`는 일반적으로 알려진 ctags
kind 이름을 모아 만든 추정치다. Rust/C/C++/Ruby/PHP 등에서 `ctags
--list-kinds-full=<언어>`로 실제 kind 이름을 확인하고, 화이트리스트에 없는 kind가 쓰이고
있다면 추가해야 한다(안 그러면 그 언어의 함수/클래스가 조용히 목록에서 빠짐 — 에러 없이
그냥 안 보이는 실패라 알아채기 어렵다).

### 4. UI에 언어별 품질 차이 안내 없음
Python/Go/Java는 이제 JS/TS와 동급(엣지 포함 완전 지원)이지만, Rust/C/C++ 등 ctags 경로
언어는 여전히 노드만 나온다 — 그 차이를 UI가 설명 안 해줘서 사용자가 "화살표가 안
보이네 버그인가"로 오해할 여지가 계속 커지고 있다(완전 지원 언어가 넷으로 늘면서 그
반대편 격차도 더 도드라짐). 간단한 배지/툴팁 정도로 개선 여지가 있음(구현 안 됨, 제안만
있었음) — 완전 지원 언어를 늘릴 때마다 이 갭의 체감 임팩트도 커지므로, 다음 언어로
넘어가기 전에 이번엔 정말 먼저 해볼 만하다.

### 5. 턴 완료 시점 게이팅 미적용 (의도적 단순화, 버그 아님)
JS 경로와 동일한 디바운스(500ms) 트리거를 ctags 경로도 그대로 재사용한다. Python/Go/Java도
이제 tree-sitter 경로라 JS와 완전히 같은 트리거를 쓴다. 턴 경계 감지 로직은 별도로 안
만듦 — 필요해지면 `caption-worker.ts`의 "완료된 턴" 판별 패턴을 재사용할 것.

### 6. ctags가 아예 모르는 언어/확장자는 조용히 무시됨
`isCtagsCandidate`는 명백히 코드가 아닌 확장자(json/md/lock 등)만 걸러낼 뿐, ctags가
인식 못 하는 언어면 빈 태그만 나오고 아무 안내 없이 그냥 구조도에 안 뜬다.

## Python에 남은 작은 갭 (tree-sitter 경로로 옮긴 뒤에도 남음)
- **와일드카드 임포트**(`from x import *`): 어떤 심볼이 노출되는지 알 방법이 없어 여전히
  미해석. 대상 파일을 미리 파싱해서 심볼 목록을 알아내는 방식으로 개선 가능하나 안 함.
- **`src/` 레이아웃 패키지**(`pyproject.toml`/`setup.py`로 소스 루트가 워크스페이스 루트와
  다른 경우): 지금은 워크스페이스 루트를 그대로 소스 루트로 가정한다. 소스 루트를 마커
  파일로 추정하는 휴리스틱이 필요 — Java의 소스 루트 문제(`src/main/java/...`)와 사실상
  동일한 난이도라 별도로 시간을 들여야 함.
- **임의 인스턴스의 메서드 호출**(`some_obj.method()`, `self`/`cls`도 아니고 임포트한
  모듈도 아닌 경우): JS 경로도 이 케이스는 원래 스킵한다(멤버 표현식은 대상 특정 불가) —
  같은 수준의 한계로 남겨둠, Python만의 갭은 아님.

## Go에 남은 작은 갭 (tree-sitter 경로로 옮긴 뒤에도 남음)
- **임의 지역 변수의 메서드 호출** — 위 "검증한 것" 참조, JS/Python과 동일 수준 한계.
- **패키지 이름을 import 경로의 마지막 세그먼트로 추정**(`import "a/b/util"` → 로컬 이름
  `util`) — 실제 `package` 선언이 경로 마지막 세그먼트와 다르면(드물지만 가능) 어긋남.
  정확히 하려면 대상 디렉토리의 파일 하나를 열어 `package X` 선언을 읽어야 함, 안 함.
- **구조체 인스턴스화가 calls 엣지에 안 잡힘** — `Calculator{}`(composite literal)는
  tree-sitter AST에서 `call_expression`이 아니라 `composite_literal`이라 지금 로직이
  아예 안 봄. Python의 `Foo()` 인스턴스화 엣지에 대응하는 걸 Go엔 아직 안 만듦.
- **import 단독(`imports`) 엣지 타입 없음** — 위 "핵심 동작 원리" 참조.
- **모노레포/멀티 모듈 미지원** — `go.mod`이 워크스페이스 루트에 정확히 하나 있다고
  가정한다. `go.work`로 여러 모듈을 묶는 프로젝트나 워크스페이스 루트가 아닌 하위
  디렉토리에 `go.mod`이 있는 경우는 미해석.

## Java에 남은 작은 갭 (tree-sitter 경로로 옮긴 뒤에도 남음)
- **임의 지역 변수의 메서드 호출** — JS/Python/Go와 동일 수준 한계(이번 세션엔 별도로
  격리 테스트하지 않았으나 같은 코드 경로라 동일하게 적용됨).
- **와일드카드 임포트**(`import a.b.*;`) — Python과 동일하게 심볼을 몰라 미해석.
- **`new Foo()` 인스턴스화가 calls 엣지에 안 잡힘** — Java에서 `object_creation_expression`은
  `method_invocation`과 다른 노드 타입이라 지금 로직이 아예 안 봄. Go의 composite literal
  인스턴스화 갭과 동일한 성격.
- **import 단독(`imports`) 엣지 타입 없음** — Go와 동일한 이유(셀렉터 호출이 사실상
  전부 calls로 수렴).
- **패키지 이름을 import 경로의 마지막 세그먼트로 추정**(Go와 동일한 성격의 근사) —
  실제로는 파일명이 곧 (public) 클래스 이름이라는 관례에 의존하므로, 파일명과
  public 클래스 이름이 다른 비표준 파일(드묾, 컴파일 안 되는 경우도 있음)은 어긋남.
- **정적 임포트 중 필드(메서드 아닌 상수/변수)는 unit 자체가 없어서 여전히 미해석** —
  `members` 맵은 만들어지지만, 그 타깃이 애초에 함수/클래스가 아니라 필드라면
  code_units에 대응하는 유닛이 없어 엣지가 안 만들어짐(자연스럽게 미해석, 에러 아님).

## 참고
- 검증에 쓴 ctags(Rust/C/C++ 등 나머지 언어 대상): Homebrew `brew install universal-ctags`
  (6.2.1, jansson/libyaml 의존).
- Python/Go/Java용 tree-sitter 문법: `tree-sitter-wasms@0.1.13`(npm)에서
  `tree-sitter-python.wasm`/`tree-sitter-go.wasm`/`tree-sitter-java.wasm` 추출 후
  `src/pipeline/ast-diff/grammars/`에 커밋. `web-tree-sitter@0.24.6`과 ABI 호환 확인(실제
  로드 + 파싱 성공, 에러 없음). 이 패키지가 커버하는 언어 목록 전체(Rust/C/C++/C#/Ruby/
  PHP/Kotlin/Swift/Dart/Scala 등 30여개)를 실제로 확인해뒀다 — 다음 언어 작업 때 grammar
  부터 다시 찾을 필요 없음.
- 검증 방법: `npm run pipeline`(CLI 진입점, `src/pipeline/cli.ts`)을 격리된
  `FACTCODING_DB_PATH`/`FACTCODING_PROJECT_PATH` 환경변수로 실행해 스크래치 프로젝트를
  관찰시키고, DB(`code_units`/`code_unit_edges`)를 `sqlite3`로 직접 쿼리해 확인. Electron
  GUI를 띄우지 않고도 파이프라인 로직만 빠르게 검증 가능한 경로라 이번엔 이 방법을 썼음
  (`.claude/skills/verify/SKILL.md`에 있는 `capturePage` 방식보다 가벼움 — GUI 자체를
  바꾸는 작업이 아니었으므로).
