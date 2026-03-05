# ReviewRaccoon Agent and Contributor Guide

This file is intentionally written for two audiences:

1. New contributors onboarding to the project.
2. AI agents (or future automated sessions) that need fast navigation and debugging context.

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
2. Open a known PR files page (example from `project.txt`: `https://github.com/albrycht/ReviewRaccoon/pull/1/files`).
3. Verify extension UI injection and marker rendering.
4. Use browser DevTools:
   - content script logs for DOM/selectors,
   - service worker logs for diff fetch and backend POST.
5. Validate backend behavior separately with API smoke checks and known diff fixtures.

### Where contributors usually get blocked

- GitHub DOM has old/new diff views; selectors in `contentScript.js` are brittle by nature.
- Extension and server test files contain stale references and are not fully aligned with current runtime API.
- Deployment automation is legacy and includes old naming and older Python assumptions.

---

## Track B: AI-agent navigation and debugging

### Fast call graph (mental model)

1. `contentScript.js` schedules detection (`setInterval`), injects button/settings, triggers runtime message.
2. `background.js` converts page URL to `.diff`, fetches diff, POSTs to `https://reviewraccoon.com/moved-blocks`.
3. `main.py` handles POST and invokes `MovedBlocksDetector.from_diff(...).detect_moved_blocks(...)`.
4. `detector.py` parses diff, fuzzy-matches lines, builds/merges/filters blocks, returns JSON-serializable structures.
5. `contentScript.js` renders markers and inline highlights with `diff_match_patch`.

### Debug entry points by symptom

- **No "Detect moved blocks" button**
  - Check page gating and toolbar insertion in `contentScript.js` (`is_proper_page`, `is_new_view`, button container lookup).
- **Button exists but no highlighted blocks**
  - Check message path `contentScript.js` -> `background.js`.
  - Verify `.diff` fetch and `/moved-blocks` response shape.
- **Backend returns surprising matches**
  - Inspect `diff_to_added_and_removed_lines`, then `detect_moved_blocks`, then `join_nearby_blocks`, then filters.
- **Prod issue**
  - Start from `ansible/setup-movedetector-server.yaml`, then nginx/supervisor/certbot includes and templates.

### Algorithm checkpoints in `server/detector.py`

When triaging false positive/false negative behavior, inspect in this order:

1. Diff parsing (`diff_to_added_and_removed_lines`)
2. Candidate matching (`added_lines_fuzzy_set.get(...)`)
3. Block growth (`try_extend_with_line`, empty-line extension)
4. Block merge (`join_nearby_blocks`)
5. Block filtering (`_filter_out_small_blocks`, nested block filtering)

Important defaults/heuristics:

- `min_lines_count` defaults to `2` when not provided.
- Low `min_match_score` is used for very short lines; higher threshold for normal lines.
- Small blocks are filtered by both weighted line count and `char_count >= 20`.
- Empty lines can be included around blocks but do not count as non-empty match lines.

---

## Current inconsistencies and risks (keep this updated)

1. **Content script control-flow risk**
   - `detect_moves()` checks truthiness of `add_detect_moved_blocks_button()`, but the button function does not clearly return explicit success/failure.
   - Large `if (is_new_view())` wrapper around substantial logic increases risk of structural regressions.

2. **Popup branding is outdated**
   - `popup.html` still contains "GTmetrix Analyzer" text, which does not match ReviewRaccoon branding.

3. **Icon assets must stay in sync with manifest**
   - `manifest.json` references `plugin/src/chrome-extension/images/raccoon_16|32|48|128.png`.
   - If icon files are moved or renamed, update both `action.default_icon` and top-level `icons`.

4. **Plugin test references missing module**
   - `plugin/tests/block_move_detector.test.js` imports `../src/moved_block_detector`, which is absent.

5. **Server tests partially stale**
   - Some tests post `added_lines` and `removed_lines`, while runtime `main.py` expects `diff_text`.
   - Several tests reflect older API/contracts.

6. **Missing private test dependency**
   - `server/tests/server_test.py` imports `tests.github_token.GITHUB_TOKEN`; file is not in repository.

7. **Naming drift**
   - Mixed names exist: `ReviewRaccoon`, `MoveBlockDetector`, `movedetector`.
   - Ansible checkout URL still targets `albrycht/MoveBlockDetector.git`.

8. **Legacy provisioning assumptions**
   - Ansible installs old Python-era dependencies and may be fragile on newer distros.

---

## Suggested workflow for next sessions

1. Confirm extension UX on a known PR page.
2. Confirm network path: `.diff` fetch and backend POST.
3. Validate detector output against one saved diff fixture.
4. Align runtime and tests (contracts first, refactors later).
5. Add a deterministic end-to-end regression fixture (`diff` in, expected blocks out).
