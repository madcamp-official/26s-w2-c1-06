import { diff_match_patch, DIFF_DELETE, DIFF_INSERT } from 'diff-match-patch';

const dmp = new diff_match_patch();

/**
 * 사람이 읽는 +/- 라인 diff를 생성해 code_unit_versions.diff_text에 저장한다.
 * 예전의 patch_toText()는 URL 인코딩된 patch 포맷이라(한글이 %EC%84…로 보임)
 * UI "DIFF 보기"와 강의노트 프롬프트 양쪽에서 읽을 수 없었다 — 라인 단위 diff로 교체.
 */
export function makeDiffText(before: string, after: string): string {
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(before, after);
  const diffs = dmp.diff_main(chars1, chars2, false);
  dmp.diff_charsToLines_(diffs, lineArray);

  const out: string[] = [];
  for (const [op, text] of diffs) {
    const prefix = op === DIFF_INSERT ? '+' : op === DIFF_DELETE ? '-' : ' ';
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop(); // 라인 diff라 각 조각은 \n로 끝난다
    for (const line of lines) out.push(prefix + ' ' + line);
  }
  return out.join('\n');
}
