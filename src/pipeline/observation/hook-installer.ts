import fs from 'node:fs';
import path from 'node:path';

interface HookCommandEntry {
  type: 'command';
  command: string;
}

interface HookMatcherGroup {
  matcher?: string;
  hooks: HookCommandEntry[];
}

type HooksSection = Record<string, HookMatcherGroup[]>;

interface ClaudeSettings {
  hooks?: HooksSection;
  [key: string]: unknown;
}

function buildHookCommand(hookScriptPath: string): string {
  // CLI(node/tsx) 실행이면: node가 PATH에 없는 환경에서도 동작하도록 현재 실행 중인
  // node 바이너리 경로를 그대로 쓴다.
  // Electron main 안에서 실행되면: process.execPath가 Electron 바이너리라 그대로 쓰면
  // 훅이 불릴 때마다 앱이 통째로 또 켜진다 — 이 경우 PATH의 node에 위임한다
  // (Claude Code 자체가 Node 기반이라 훅 실행 환경에는 node가 있다고 가정해도 안전).
  const runner = process.versions.electron ? 'node' : `"${process.execPath}"`;
  return `${runner} "${hookScriptPath}"`;
}

function ensureHookRegistered(hooks: HooksSection, eventName: string, matcher: string | undefined, hookScriptPath: string): void {
  if (!Array.isArray(hooks[eventName])) hooks[eventName] = [];
  const command = buildHookCommand(hookScriptPath);

  const alreadyRegistered = hooks[eventName].some(
    (group) => Array.isArray(group?.hooks) && group.hooks.some((h) => h?.type === 'command' && h?.command === command)
  );
  if (alreadyRegistered) return;

  const entry: HookMatcherGroup = { hooks: [{ type: 'command', command }] };
  if (matcher !== undefined) entry.matcher = matcher;
  hooks[eventName].push(entry);
}

/**
 * 대상 프로젝트의 .claude/settings.json에 SessionStart/SessionEnd 훅을 자동 등록한다
 * (SPEC 4.1). 기존 훅 배열은 절대 덮어쓰지 않고 append하며, 이미 등록돼 있으면
 * 아무것도 하지 않는다(매 파이프라인 시작마다 호출해도 안전).
 *
 * SPEC 원문은 "SessionStart/Stop" 훅이라고 되어 있으나, 실제로 `Stop`은 세션 전체가
 * 아니라 매 턴 종료마다 발생하는 이벤트라 세션 종료 신호로 쓸 수 없다(Claude Code
 * 훅 문서 확인 결과). 세션이 실제로 끝나는 시점(정상 종료/Ctrl-C 등)을 안정적으로
 * 잡으려면 `SessionEnd`를 써야 한다 — 이 구현은 SessionEnd를 사용한다.
 */
export function installHooks(targetProjectPath: string, hookScriptPath: string): void {
  const claudeDir = path.join(targetProjectPath, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  fs.mkdirSync(claudeDir, { recursive: true });

  let settings: ClaudeSettings = {};
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (raw.trim().length > 0) {
      settings = JSON.parse(raw) as ClaudeSettings; // 손상된 JSON이면 사용자 파일을 건드리지 않도록 그대로 던진다
    }
  }

  settings.hooks ??= {};
  // SessionStart: matcher 생략 → startup/resume/clear/compact 전부에서 발생
  ensureHookRegistered(settings.hooks, 'SessionStart', undefined, hookScriptPath);
  // SessionEnd: matcher를 빈 문자열로 두면 모든 reason(clear/resume/logout/other 등)에 매칭
  ensureHookRegistered(settings.hooks, 'SessionEnd', '', hookScriptPath);

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}
