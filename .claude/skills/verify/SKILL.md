---
name: verify
description: Build/launch/drive recipe for verifying the Factcoding Electron app end-to-end
---

# Verifying Factcoding

## ABI dance (better-sqlite3 is built for exactly one target at a time)

- Plain-Node scripts (`npm run db:init` / `db:seed` via tsx): `npm rebuild better-sqlite3` first.
- Electron app: `npx electron-rebuild -f -w better-sqlite3` first.
  (`electron-builder install-app-deps` sometimes short-circuits and leaves the wrong ABI — use electron-rebuild with `-f`.)

## Launch

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev
```

The harness shell exports `ELECTRON_RUN_AS_NODE=1`, which silently turns Electron into plain Node — always unset it. Add `ELECTRON_ENABLE_LOGGING=1` to surface renderer console errors in the main log.

## Fresh end-to-end cycle

1. `npm rebuild better-sqlite3 && rm -f db/factcoding.db* && npm run db:init && npm run db:seed`
2. `sqlite3 db/factcoding.db "PRAGMA foreign_key_check"` — silence means clean
3. `npx electron-rebuild -f -w better-sqlite3`, then launch (above)
4. Watch the caption worker fill `ai_explanations` (5s ticks, tool_events first, then code_unit_versions):
   `sqlite3 db/factcoding.db "SELECT skill_level, target_type, COUNT(*) FROM ai_explanations GROUP BY 1,2"`

## Driving / capturing the GUI

`screencapture` fails in this sandbox ("could not create image from display"). Instead, temporarily add a block in `createWindow()` (src/app/main/index.ts) gated on an env var that uses `mainWindow.webContents.capturePage()` → PNG, and `webContents.executeJavaScript('document.querySelector(...).click()')` to drive real UI clicks. Remove the block after. Read the PNGs with the Read tool to inspect visually.

**Caution:** the window opens on the user's real desktop — a human may click it mid-run. If the DB state doesn't match your scripted inputs, reconstruct the true sequence from `ai_explanations.created_at` timestamps before assuming a bug.

## Useful probes

- Live concurrent write (simulates Person A's pipeline): `sqlite3` INSERT into `tool_events` while the app runs — WAL allows it; UI picks it up within 1s poll; orphan (`prompt_id` NULL) events land in the "연결된 요청 없음" group.
- Skill-level cache: flip `user_settings.skill_level`, only missing `(target_type, target_id, skill_level)` rows should be generated; existing rows keep their `created_at` (cache hit = no API call).
- Key pool logic is covered by `npm run test:keypool` (pure logic, no network/DB — safe under either ABI).
