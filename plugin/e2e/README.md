# ReviewRaccoon Playwright E2E

This suite runs a real end-to-end flow:

1. loads the unpacked extension from `plugin/src/chrome-extension`,
2. opens a live GitHub PR files page,
3. starts/uses the local backend at `http://127.0.0.1:8000`,
4. verifies toolbar icon injection and moved-block markers in GitHub diff UI.

## Prerequisites

- `uv` available in PATH
- Node.js and npm
- Chromium installed by Playwright (`npx playwright install chromium`)
- `xvfb-run` if you run on headless Linux without a display

## Setup

```bash
cd plugin/e2e
npm install
npm run install:browsers
```

Create local GitHub auth config for signed-in tests:

```bash
cd plugin/e2e
cp github-auth.local.json.example github-auth.local.json
# edit github-auth.local.json and set:
# - username
# - password
# - prUrl (must be /pull/<number>/files or /pull/<number>/changes)
# - totpSecret (authenticator-app setup key; GitHub requires 2FA)
```

`RR_E2E_PR_URL=<url>` overrides `prUrl` for a single run.

The backend needs Python 3.10 (`levenshtein==0.21.1` does not build on 3.12+);
if uv picks a newer interpreter, run with `UV_PYTHON=3.10`.

The real `github-auth.local.json` is gitignored; only the `.example` file is committed.

## Run tests

Local developer run (headless by default):

```bash
cd plugin/e2e
npm test
```

Headed debug run:

```bash
cd plugin/e2e
PW_HEADLESS=0 npm test -- tests/live_github_extension.spec.js
```

Linux headless/agent-friendly run:

```bash
cd plugin/e2e
npm run test:xvfb
```

Unified helper script (headless by default and artifact-friendly):

```bash
bash plugin/e2e/scripts/run-e2e.sh
```

Or from `plugin/e2e`:

```bash
npm run test:agent
```

## Notes

- Playwright config starts backend automatically with:
  - `PYTHONPATH=server uv run gunicorn --chdir server main:app --bind 127.0.0.1:8000`
- The test forces extension settings to use localhost backend:
  - `detect-moved-blocks__custom-server-enabled = true`
  - `detect-moved-blocks__custom-server-base-url = http://127.0.0.1:8000`
- `scripts/run-e2e.sh` always runs Chromium headless (`PW_HEADLESS=1`).
- The signed-in flow verifies:
  - new Files experience detection
  - switch back to classic experience detection
  - classic unified/split checks when diff-settings controls are present
- After moved blocks are detected, the test stores persistent artifacts per stage:
  - `after-detection-new-experience.png` and `after-detection-new-experience.html`
  - `after-detection-classic.png` and `after-detection-classic.html` (or `classic-unified` + `classic-split` files when available)
  - metadata: `metadata.json` (records under `views.<stage>`)
  - default location: `plugin/e2e/artifacts/<timestamp>/`
  - stable symlink to newest run: `plugin/e2e/artifacts/latest`
  - override location with `RR_E2E_ARTIFACTS_DIR=/custom/path`
- If `github-auth.local.json` is missing or invalid, the test fails fast with setup instructions.
- The suite uses a live GitHub page and can fail if GitHub is unavailable or heavily rate-limited.
