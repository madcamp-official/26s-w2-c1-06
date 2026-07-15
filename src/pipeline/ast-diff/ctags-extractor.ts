import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UnitLike, UnitType } from './unit-extractor.js';
import type { EdgeCandidate } from './edge-extractor.js';

const execFileAsync = promisify(execFile);

// tree-sitter grammar가 없는 언어(JS/TS/TSX/Python 외 전부)를 위한 대체 경로 (SPEC 7 확장).
// Universal Ctags가 이미 ~100개 언어의 심볼 파서를 내장하고 있으므로, 언어별로 grammar를
// 구하거나 쿼리를 새로 짜는 대신 ctags 실행 결과(JSON Lines)를 우리 형태로 변환만 한다.
// 대가는 명확하다: ctags는 정의만 태깅하고 참조/호출은 해석하지 않으므로 엣지(imports/calls)가
// 전혀 없다 — 함수/클래스 노드만 나온다. (Python은 import/calls 엣지가 필요해 tree-sitter
// 경로로 옮겼다 — edge-extractor.ts 참조. 이 파일의 옛 Python 전용 import 해석 로직은
// 그래서 제거했다: 남은 언어(Go/Java/...) 중 ctags의 scope 필드를 같은 방식으로 안 쓰는
// 언어뿐이라 그대로 두면 죽은 코드였다.)
let ctagsBinary: string | null = null;

export function configureCtags(binaryPath: string): void {
  ctagsBinary = binaryPath;
}

// ctags 자체가 못 알아듣는 확장자에 매번 프로세스를 띄우는 낭비를 막는 최소 방어선.
// 여기 없는 확장자도 실행은 되지만(ctags가 언어를 못 알아보면 태그 0개로 조용히 끝남),
// 흔히 코드가 아닌 파일(설정/락파일/문서)은 미리 걸러 프로세스 스폰 자체를 아낀다.
const SKIP_EXTENSIONS = new Set([
  '.json', '.md', '.txt', '.lock', '.yml', '.yaml', '.toml', '.log', '.csv',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf',
  '.db', '.sqlite', '.sqlite3', '.map', '.min.js', '.d.ts',
]);

export function isCtagsCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '') return false;
  return !SKIP_EXTENSIONS.has(ext);
}

interface CtagsTag {
  _type: string;
  name: string;
  path: string;
  line?: number;
  kind: string;
  scope?: string;
  scopeKind?: string;
  roles?: string;
}

// "이게 실제 정의(함수/클래스 등)로 취급할 kind인가"의 화이트리스트. 언어마다 kind 이름이
// 조금씩 다르므로(예: JS 계열 없이 Go는 func/struct, Python은 function/class/member) 흔한
// 이름을 폭넓게 모아둔다 — 여기 없는 kind(변수/파라미터 등)는 구조도 노이즈라 제외한다.
const FUNCTION_LIKE_KINDS = new Set([
  'function', 'func', 'method', 'member', 'subroutine', 'procedure', 'constructor', 'destructor',
]);
const CLASS_LIKE_KINDS = new Set(['class', 'struct', 'interface', 'enum', 'trait', 'protocol']);
// 메서드의 scope가 이 kind 중 하나일 때만 "Class.method" 형태로 이름을 합성한다(JS의
// findEnclosingClassName과 같은 목적) — package/namespace 스코프는 접두어를 안 붙인다.
const CONTAINER_SCOPE_KINDS = new Set(['class', 'struct', 'interface', 'enum', 'trait', 'protocol']);

function classifyKind(kind: string): UnitType | null {
  if (CLASS_LIKE_KINDS.has(kind)) return 'class';
  if (FUNCTION_LIKE_KINDS.has(kind)) return 'function';
  return null;
}

async function runCtags(filePath: string, source: string): Promise<CtagsTag[]> {
  if (!ctagsBinary) {
    throw new Error('[ctags-extractor] configureCtags()가 호출되지 않았습니다');
  }
  // ctags는 확장자로 언어를 판별하므로, 실제 파일 대신 같은 확장자를 가진 임시 파일에
  // (turn 완료 시점의) 소스 문자열을 써서 넘긴다 — 디스크의 "현재" 상태가 아니라 before/after
  // 스냅샷 각각을 독립적으로 분석해야 하기 때문(JS 경로의 parseSource(filePath, source)와 동일 이유).
  const ext = path.extname(filePath);
  const tmpFile = path.join(os.tmpdir(), `factcoding-ctags-${randomUUID()}${ext}`);
  await fs.promises.writeFile(tmpFile, source, 'utf8');
  try {
    const { stdout } = await execFileAsync(
      ctagsBinary,
      ['--output-format=json', '--fields=+n', '--fields=+r', '--extras=+r', '-f', '-', tmpFile],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    const tags: CtagsTag[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        tags.push(JSON.parse(line) as CtagsTag);
      } catch {
        // ctags가 가끔 진단 메시지를 stdout에 섞어 보낼 수 있다 — JSON이 아니면 조용히 스킵.
      }
    }
    return tags;
  } catch {
    // 지원 안 하는/깨진 입력이면 ctags가 0 종료가 아닐 수 있다 — 태그 없음으로 취급(JS 경로의
    // parseSource가 null을 리턴하고 스킵하는 것과 동일한 "우아한 실패").
    return [];
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

interface UnitLikeWithLine extends UnitLike {
  line: number;
  isContainer: boolean;
  containerName: string | null; // 이 유닛이 컨테이너면 자기 이름, 아니면 null(범위 계산용)
}

function buildUnits(tags: CtagsTag[], sourceLines: string[]): UnitLikeWithLine[] {
  const defs = tags
    .filter((t) => t.roles !== 'imported' && t.roles !== 'namespace' && typeof t.line === 'number')
    .map((t) => ({ tag: t, unitType: classifyKind(t.kind) }))
    .filter((x): x is { tag: CtagsTag; unitType: UnitType } => x.unitType !== null)
    .sort((a, b) => a.tag.line! - b.tag.line!);

  const units: UnitLikeWithLine[] = [];
  for (let i = 0; i < defs.length; i++) {
    const { tag, unitType } = defs[i];
    const isContainer = CLASS_LIKE_KINDS.has(tag.kind);
    const qualifies = tag.scope && tag.scopeKind && CONTAINER_SCOPE_KINDS.has(tag.scopeKind);
    const unitName = qualifies ? `${tag.scope}.${tag.name}` : tag.name;

    // 범위 끝: 컨테이너(class 등)는 "자기 자신을 scope로 갖지 않는" 다음 정의까지(=자기
    // 멤버들을 건너뜀), 그 외(함수/메서드)는 그냥 다음 정의까지. 마지막 유닛은 파일 끝까지.
    let endLineExclusive = sourceLines.length;
    for (let j = i + 1; j < defs.length; j++) {
      const next = defs[j].tag;
      if (isContainer && next.scope === tag.name) continue; // 이 클래스의 멤버 — 건너뜀
      endLineExclusive = next.line! - 1;
      break;
    }

    const startLine = tag.line! - 1; // ctags는 1-based
    const text = sourceLines.slice(startLine, Math.max(startLine + 1, endLineExclusive)).join('\n');

    units.push({
      unitName,
      unitType,
      text,
      line: tag.line!,
      isContainer,
      containerName: isContainer ? tag.name : null,
    });
  }
  return units;
}

export interface CtagsExtraction {
  units: UnitLike[];
  edges: EdgeCandidate[];
}

export async function extractWithCtags(filePath: string, source: string): Promise<CtagsExtraction> {
  const tags = await runCtags(filePath, source);
  const sourceLines = source.split('\n');
  const units = buildUnits(tags, sourceLines);
  return { units, edges: [] }; // 엣지 해석은 ctags 경로 밖(참조/호출 해석 불가 — 상단 주석 참조)
}
