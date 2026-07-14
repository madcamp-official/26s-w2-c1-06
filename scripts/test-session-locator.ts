// projectPathToHash 단위 테스트. 네트워크/DB 불필요 — 순수 문자열 변환만 검증.
// 이 변환이 실물 ~/.claude/projects/<hash> 디렉토리명과 어긋나면 파이프라인이
// 세션 파일을 영영 못 찾아 관찰이 조용히(에러 없이) 멈춘다 — 실제로 겪은 회귀.
// 실행: npm run test:session-locator

import assert from 'node:assert/strict'
import { projectPathToHash } from '../src/pipeline/observation/session-locator'

function testLowercasesOnlyDriveLetter(): void {
  const hash = projectPathToHash('C:\\Users\\gjtjw\\Desktop\\version_tts')
  assert.equal(
    hash,
    'c--Users-gjtjw-Desktop-version-tts',
    '드라이브 문자만 소문자화되고 나머지 경로(Users/Desktop)의 대소문자는 유지되어야 함'
  )
  console.log('✓ drive letter is lowercased, rest of the path keeps its casing')
}

function testUnderscoreBecomesHyphen(): void {
  const hash = projectPathToHash('C:\\repos\\my_project')
  assert.equal(hash, 'c--repos-my-project', '밑줄(_)도 구분자와 동일하게 "-"로 치환되어야 함')
  console.log('✓ underscores convert to hyphens, same as path separators')
}

function testAlreadyLowercaseDriveUnaffected(): void {
  const hash = projectPathToHash('c:\\Users\\gjtjw\\FactCoding')
  assert.equal(hash, 'c--Users-gjtjw-FactCoding')
  console.log('✓ an already-lowercase drive letter is left as-is')
}

const tests = [testLowercasesOnlyDriveLetter, testUnderscoreBecomesHyphen, testAlreadyLowercaseDriveUnaffected]

function main(): void {
  for (const test of tests) test()
  console.log('\nall projectPathToHash tests passed')
}

main()
