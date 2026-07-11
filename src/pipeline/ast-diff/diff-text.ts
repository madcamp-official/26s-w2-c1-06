import { diff_match_patch } from 'diff-match-patch';

const dmp = new diff_match_patch();

/** unified patch 텍스트 형태로 diff를 생성해 code_unit_versions.diff_text에 저장한다. */
export function makeDiffText(before: string, after: string): string {
  const patches = dmp.patch_make(before, after);
  return dmp.patch_toText(patches);
}
