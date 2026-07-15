import type { CodeUnitCandidate, UnitType } from './unit-extractor.js';
import { makeDiffText } from './diff-text.js';

export interface UnitChange {
  unitName: string;
  unitType: UnitType;
  changeType: 'created' | 'modified' | 'deleted';
  diffText: string | null;
}

/**
 * before/after 유닛 집합을 unitName 기준으로 매칭한다 (SPEC 4.2 step 3).
 * - after에만 있음 → created / before에만 있음 → deleted
 * - 둘 다 있고 본문(text) 다름 → modified(diff_text 생성) / 본문 동일 → 스킵
 */
export function matchUnits(before: CodeUnitCandidate[], after: CodeUnitCandidate[]): UnitChange[] {
  const beforeMap = new Map(before.map((u) => [u.unitName, u]));
  const afterMap = new Map(after.map((u) => [u.unitName, u]));
  const changes: UnitChange[] = [];

  for (const [name, afterUnit] of afterMap) {
    const beforeUnit = beforeMap.get(name);
    if (!beforeUnit) {
      // created 유닛도 diffText를 채운다(전부 '+' 라인) — 예전엔 null이라 관제실
      // "더 자세히" 카드에서 새로 생성된 함수/컴포넌트/클래스의 실제 코드를 볼 방법이
      // 없었다(생성이 가장 흔한 changeType인데도).
      changes.push({
        unitName: name,
        unitType: afterUnit.unitType,
        changeType: 'created',
        diffText: makeDiffText('', afterUnit.text),
      });
    } else if (beforeUnit.text !== afterUnit.text) {
      changes.push({
        unitName: name,
        unitType: afterUnit.unitType,
        changeType: 'modified',
        diffText: makeDiffText(beforeUnit.text, afterUnit.text),
      });
    }
  }

  for (const [name, beforeUnit] of beforeMap) {
    if (!afterMap.has(name)) {
      // created와 대칭: 삭제된 코드도 전부 '-' 라인으로 남겨 무엇이 없어졌는지 볼 수 있게 한다.
      changes.push({
        unitName: name,
        unitType: beforeUnit.unitType,
        changeType: 'deleted',
        diffText: makeDiffText(beforeUnit.text, ''),
      });
    }
  }

  return changes;
}
