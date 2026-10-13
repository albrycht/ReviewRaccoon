# ReviewRaccoon Agent and Contributor Guide

This file is intentionally written for two audiences:

1. New contributors onboarding to the project.
2. AI agents (or future automated sessions) that need fast navigation and debugging context.

Maintenance rule:
- After meaningful runtime, UX, state-flow, or debugging-path changes, update this file in the same session when the new information will help future debugging/navigation.

## Project purpose

ReviewRaccoon improves GitHub PR review by detecting moved code blocks (including blocks with small edits) and showing these relations directly in GitHub diff UI.

Core end-to-end flow:

1. User opens a GitHub PR/commit files page.
2. Extension derives `.diff` URL and fetches raw diff.
3. Extension sends diff to backend `/moved-blocks`.
4. Backend detects moved blocks and returns matched line pairs.
5. Extension annotates removed/added lines in GitHub UI and enables jump between linked parts.

---

## Quick map of the repo

- `plugin/`: Chrome extension runtime and client-side UI logic.
- `server/`: Falcon API and moved-block detection engine.
- `ansible/`: production/deployment automation.
- `examples/`: sample files and historical examples.

---

## Track A: New contributor onboarding

### First orientation (read in this order)

1. `project.txt` (intent and top-level flow)
2. `README.md` (high-level overview)
3. `plugin/src/chrome-extension/manifest.json`
4. `plugin/src/chrome-extension/contentScript.js`
5. `plugin/src/chrome-extension/background.js`
6. `server/main.py`
7. `server/detector.py`

### Runtime ownership by area

- Extension UI and DOM integration: `plugin/src/chrome-extension/contentScript.js`
- Diff fetch and backend call: `plugin/src/chrome-extension/background.js`
- API entrypoint: `server/main.py`
- Detection algorithm: `server/detector.py`
- Infra/provisioning: `ansible/setup-movedetector-server.yaml` and included playbooks

### Practical local workflow (current project shape)

There is no root build script (`package.json`) or standard CI config in repo root, so use direct/manual workflow:

1. Load extension unpacked from `plugin/src/chrome-extension` in Chrome.
   - Firefox: open `about:debugging#/runtime/this-firefox` -> "Load Temporary Add-on..." -> pick `plugin/src/chrome-extension/manifest.json` (removed on browser restart). Or `npx web-ext run --source-dir plugin/src/chrome-extension`. The manifest declares both `background.service_worker` (Chrome) and `background.scripts` (Firefox event page) plus a `browser_specific_settings.gecko.id`; keep both background keys.
2. Open a known PR files page (example from `project.txt`: `https://github.com/albrycht/ReviewRaccoon/pull/1/files`).
3. Verify extension UI injection and marker rendering.
4. Use browser DevTools:
   - content script logs for DOM/selectors,
   - service worker logs for diff fetch and backend POST.
5. Validate backend behavior separately with API smoke checks and known diff fixtures.
6. Run extension E2E regression (live GitHub + localhost backend):
   - `cd plugin/e2e && npm run test:agent`
   - this auto-starts backend via Playwright `webServer`, logs in with `plugin/e2e/github-auth.local.json`, and verifies moved-block markers in signed-in new/classic Files experiences.

### Where contributors usually get blocked

- GitHub DOM has old/new diff views; selectors in `contentScript.js` are brittle by nature.
- Extension and server test files contain stale references and are not fully aligned with current runtime API.
- Deployment automation is legacy and includes old naming and older Python assumptions.

---

## Track B: AI-agent navigation and debugging

### Fast call graph (mental model)

1. `contentScript.js` schedules detection (`setInterval`), injects the GitHub toolbar icon control, and triggers runtime messages.
2. `background.js` converts page URL to `.diff`, fetches diff, POSTs to `https://reviewraccoon.com/moved-blocks`.
3. `main.py` handles POST and invokes `MovedBlocksDetector.from_diff(...).detect_moved_blocks(...)`.
4. `detector.py` parses diff, fuzzy-matches lines, builds/merges/filters blocks, returns JSON-serializable structures.
5. `contentScript.js` renders markers and inline highlights with `diff_match_patch`.

### Recent extension UX and toolbar behavior (Mar 2026)

- Popup UX is state-driven (`idle`, `running`, `success`, `no_blocks`, `error`, `disabled_by_settings`, `not_supported_page`) with phase/subPhase diagnostics from `background.js`.
- Popup settings persist in `chrome.storage.local` via `background.js` and currently include:
  - `detect-moved-blocks__enabled` (default `true`, exposed as compact header toggle in popup)
  - `detect-moved-blocks__min-lines-count`
  - `detect-moved-blocks__expand-all-large-diffs` (default `true`, exposed as slider toggle in popup settings)
  - `detect-moved-blocks__custom-server-enabled` (default `false`, exposed as "Custom server" toggle in popup settings)
  - `detect-moved-blocks__custom-server-base-url` (default `https://reviewraccoon.com`, shown when custom server toggle is enabled)
- Popup "Technical details" includes the exact `.diff` URL used for the latest detection attempt (`diffUrl` in tab state), shown as a clickable link for debugging.
- Popup "Settings" now lives in its own collapsed `details` block directly below "Technical details"; the old cog-triggered settings panel was removed.
- When detection is disabled from the header toggle, popup body content is replaced by a sleeping raccoon image (`images/sleeping_raccoon_512.png`) while header title/toggle remain visible.
- Custom server URL normalization in `background.js` accepts formats like `localhost`, `http://localhost`, `localhost:8000`, trims trailing slashes, prepends `http://` when missing, and always sends detection requests to `<normalized-base>/moved-blocks`.
- GitHub page control is now an icon-only ReviewRaccoon control in the right toolbar (`.pr-review-tools`), inserted as first item and styled as icon + badge.
- In-page badge semantics mirror extension badge semantics:
  - paused/disabled: `⏸` (gray)
  - running: `…` (blue)
  - success/no blocks: numeric count (green)
  - error: `!` (red)
- Clicking toolbar icon toggles popup state:
  - closed -> opens popup (`chrome.action.openPopup`)
  - open -> closes popup via runtime port (`reviewraccoon-popup`) and `close_popup` message
  - a short reopen guard in `background.js` prevents close+immediate-reopen race.
- Toolbar icon rendering avoids GitHub page CSP issues by requesting a base64 data URL from `background.js` (`contentScriptQuery: "get_icon_data_url"`), instead of directly using `chrome-extension://...` in page DOM.
- Supported GitHub diff page routes in `background.js` include:
  - `/pull/<number>/files`
  - `/pull/<number>/changes` (signed-in new Files experience)
  - `/pull/<number>/commits/<sha>`
  - `/commit/<sha>` and `/commits/<sha>`
- Playwright E2E flow is now signed-in and stateful:
  - requires local gitignored auth config `plugin/e2e/github-auth.local.json` (template: `.example`)
  - GitHub requires 2FA on the test account: `totpSecret` in that config lets the test generate TOTP codes; without it GitHub falls back to emailed device-verification codes, which block unattended runs
  - `RR_E2E_PR_URL` overrides `prUrl` (PR #8 `https://github.com/albrycht/ReviewRaccoon/pull/8/files` is the reference case: exactly 1 moved block)
  - backend needs Python 3.10 (`UV_PYTHON=3.10`); `levenshtein==0.21.1` fails to build on 3.12/3.14
  - attempts `Try the new experience`, validates markers, switches back via `Preview` -> `Switch to the classic experience`, then validates classic markers
  - updates `plugin/e2e/artifacts/latest` symlink on every run (including direct `npm test`)
- Content-script navigation handling is SPA-aware: it watches History API (`pushState`/`replaceState`), `popstate`, `hashchange`, GitHub Turbo/PJAX events, and a short URL polling fallback. URL identity ignores hash fragments (`#diff-...`), so in-page diff anchor jumps do not reset detection state or trigger re-detection.
- Content script now defensively handles Chrome `"Extension context invalidated"` runtime/storage errors (e.g. right after extension reload) by falling back to defaults and stopping polling timers instead of throwing uncaught promise errors.
- Large diff expansion is now detection-aware in `contentScript.js`:
  - detection fetch runs before expansion, then expansion can target only files that contain detected moved blocks.
  - default behavior still expands all large diffs (`detect-moved-blocks__expand-all-large-diffs` defaults to `true` in local storage).
  - post-click waiting uses loader/DOM settle checks (quiet period + timeout), replacing fixed sleep.
- Re-running detection now clears prior ReviewRaccoon markers/highlights first (and pause mode clears them as well), preventing duplicated in-page markers after pause/resume or repeated runs.

### Debug entry points by symptom

- **No ReviewRaccoon toolbar icon**
  - Check page gating and toolbar insertion in `contentScript.js` (`is_proper_page`, `is_new_view`, `.pr-review-tools` lookup, first-child insertion).
- **Toolbar icon shows fallback emoji instead of raccoon image**
  - Verify `contentScript.js` -> `background.js` message path for `contentScriptQuery: "get_icon_data_url"`.
  - Verify `background.js` `get_icon_data_url()` can fetch `images/raccoon_32.png` and return valid `data:image/png;base64,...`.
- **Button exists but no highlighted blocks**
  - Check message path `contentScript.js` -> `background.js`.
  - Verify `.diff` fetch and `/moved-blocks` response shape.
- **Toolbar icon click reopens popup immediately after close**
  - Check popup port lifecycle in `popup.js` (`chrome.runtime.connect({ name: "reviewraccoon-popup" })`).
  - Check close/open toggle and `POPUP_TOGGLE_GUARD_MS` timing in `background.js`.
- **Backend returns surprising matches**
  - Inspect `diff_to_added_and_removed_lines`, then `detect_moved_blocks`, then `join_nearby_blocks`, then filters.
- **Prod issue**
  - Start from `ansible/setup-movedetector-server.yaml`, then nginx/supervisor/certbot includes and templates.

### Algorithm checkpoints in `server/detector.py` and `server/alignment_detector.py`

When triaging false positive/false negative behavior, inspect in this order:

1. Diff parsing (`diff_to_added_and_removed_lines`)
2. Detector mode routing (`resolve_detector_mode`, `MovedBlocksDetector.from_diff(...)`)
3. If `legacy`: candidate matching (`added_lines_fuzzy_set.get(...)`) then block growth/merge/filtering
4. If `alignment`: stream build/tokenization, Smith-Waterman candidate extraction, candidate-to-block conversion
5. Non-overlap resolution and small-block filtering (`char_count >= 20`, `min_lines_count`)

Important defaults/heuristics:

- `min_lines_count` defaults to `2` when not provided.
- Detector mode defaults to `legacy`; set env `REVIEWRACCOON_DETECTOR_MODE=alignment` or request `detector_mode: "alignment"` to run the new algorithm.
- Low `min_match_score` is used for very short lines; higher threshold for normal lines.
- Small blocks are filtered by both weighted line count and `char_count >= 20`.
- Empty lines can be included around blocks but do not count as non-empty match lines.

---

## Current inconsistencies and risks (keep this updated)

1. **GitHub DOM volatility**
   - Toolbar and diff-line selectors are still brittle across GitHub UI versions (old/new views).
   - Signed-in new Files preview uses different PRC classnames and menu structure (`Preview`, `Switch to the classic experience`) that can change without notice.
   - New-view CSS-module classnames changed (Oct 2026) from `<Module>-module__<Name>__<hash>` to `<Name>__<hash>` (e.g. `ReviewMenuButton__9e8CKv`, `PreviewLabel__44UECa`, `diff-file-header__CV6GPS`). This silently broke `is_new_view()` and toolbar-icon injection. Match only the stable `<Name>` part (see `NEW_VIEW_*_SELECTOR` constants in `contentScript.js`). Diff rows still use stable classes (`.diff-line-row`, `.diff-text-cell`, `data-line-number`).
   - Changes in `.pr-review-tools` structure or diff row layout can silently break injection/marker placement.

2. **Popup toggle is timing-sensitive**
   - Popup close/open toggle depends on runtime port lifecycle plus reopen guard timing.
   - If Chrome behavior changes, `POPUP_TOGGLE_GUARD_MS` may need retuning.

3. **Icon assets must stay in sync with manifest and background icon loader**
   - `manifest.json` references `plugin/src/chrome-extension/images/raccoon_16|32|48|128.png`.
   - `background.js` also fetches `images/raccoon_32.png` for in-page data URL rendering.
   - If icon files are moved or renamed, update `action.default_icon`, top-level `icons`, and background icon fetch path.

4. **Plugin test references missing module**
   - `plugin/tests/block_move_detector.test.js` imports `../src/moved_block_detector`, which is absent.

5. **Server tests partially stale**
   - Runtime now accepts both `diff_text` and `added_lines`/`removed_lines`, but several tests still reflect older detector behavior and thresholds.

6. **Missing private test dependency**
   - `server/tests/server_test.py` imports `tests.github_token.GITHUB_TOKEN`; file is not in repository.

7. **Naming drift**
   - Mixed names exist: `ReviewRaccoon`, `MoveBlockDetector`, `movedetector`.
   - Ansible checkout URL still targets `albrycht/MoveBlockDetector.git`.

8. **Legacy provisioning assumptions**
   - Ansible installs old Python-era dependencies and may be fragile on newer distros.

9. **Python `fuzzyset` import collision risk**
   - Runtime detector expects repository module `server/fuzzyset.py` (supports `exact_match_only` argument).
   - Environment dependency also installs external `fuzzyset` package with incompatible API.
   - For Playwright E2E backend startup, use `PYTHONPATH=server` to force local module resolution.

---

## Suggested workflow for next sessions

1. Confirm extension UX on a known PR page.
2. Confirm network path: `.diff` fetch and backend POST.
3. Validate detector output against one saved diff fixture.
4. Align runtime and tests (contracts first, refactors later).
5. Add a deterministic end-to-end regression fixture (`diff` in, expected blocks out).
6. After each change in `server/` code, run static checks:
   - `uv run --with ruff ruff check server`
   - `uv run --with ty ty check server`
