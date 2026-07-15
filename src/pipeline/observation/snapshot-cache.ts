import fs from 'node:fs';

/** text 안의 첫 번째 search 등장 위치만 순수 문자열 슬라이싱으로 교체($ 특수 패턴 해석 없음). */
function replaceFirstOccurrence(text: string, search: string, replacement: string): string {
  const index = text.indexOf(search);
  if (index === -1) return text; // 정상 흐름에선 Claude Code가 old_string 불일치 시 Edit 자체를 실패시킴
  return text.slice(0, index) + replacement + text.slice(index + search.length);
}

/**
 * 파일별 전체 내용의 인메모리 스냅샷. 디스크 재읽기 없이 Edit을 메모리 치환으로 반영해
 * "tool_use를 관찰한 시점"과 "디스크에 실제로 쓰인 시점" 사이의 레이스 컨디션을 없앤다.
 * (설계 근거: IMPLEMENTATION_PLAN_A.md 3장 "스냅샷 캐시 vs 디스크 재읽기", SPEC 4.2)
 */
export class SnapshotCache {
  private files = new Map<string, string>();

  has(filePath: string): boolean {
    return this.files.has(filePath);
  }

  /** 현재 캐시된 전체 내용. 없으면 빈 문자열(디바운스 flush 시 "현재 상태" 조회용). */
  get(filePath: string): string {
    return this.files.get(filePath) ?? '';
  }

  /** Read tool_use 관찰 시점 등에 호출. 이미 캐시돼 있으면 아무것도 하지 않는다. */
  seedFromDisk(filePath: string): void {
    if (this.files.has(filePath)) return;
    try {
      this.files.set(filePath, fs.readFileSync(filePath, 'utf8'));
    } catch {
      // 파일이 아직 없음 — Write로 새로 생성될 예정이면 자연스럽게 무시.
    }
  }

  /**
   * 성공한 Edit tool_result 확인 후에만 호출할 것. 캐시된 before에 old→new 치환을
   * 메모리에서 적용해 after를 계산하고 캐시를 갱신한다.
   */
  applyEdit(filePath: string, oldString: string, newString: string, replaceAll: boolean): { before: string; after: string } {
    const before = this.files.get(filePath) ?? '';
    // before.replace(oldString, newString)은 절대 쓰면 안 된다 — String.prototype.replace는
    // 검색값이 일반 문자열이어도 교체 문자열 안의 $&, $$, $` 같은 특수 패턴을 그대로 해석해버려서,
    // newString에 리터럴 `$$`/`$&`(쉘 PID, 정규식 치환 코드 등)가 들어있으면 실제 디스크 파일과
    // 다르게 저장되는 실제 버그가 있었다. split/join(순수 문자열 치환)만 사용한다.
    const after = replaceAll ? before.split(oldString).join(newString) : replaceFirstOccurrence(before, oldString, newString);
    this.files.set(filePath, after);
    return { before, after };
  }

  /** Write tool_use payload의 전체 내용을 그대로 캐시. before가 없으면(캐시 미스) 신규 생성으로 간주. */
  applyWrite(filePath: string, content: string): { before: string; after: string } {
    const before = this.files.get(filePath) ?? '';
    this.files.set(filePath, content);
    return { before, after: content };
  }

  /** manual-watch(Day 4)가 잡은 수동 수정 이후 디스크 상태로 강제 동기화. */
  syncFromDisk(filePath: string): void {
    try {
      this.files.set(filePath, fs.readFileSync(filePath, 'utf8'));
    } catch {
      this.files.delete(filePath);
    }
  }
}
