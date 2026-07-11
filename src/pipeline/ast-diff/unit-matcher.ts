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
      changes.push({ unitName: name, unitType: afterUnit.unitType, changeType: 'created', diffText: null });
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
      changes.push({ unitName: name, unitType: beforeUnit.unitType, changeType: 'deleted', diffText: null });
    }
  }

  return changes;
}
