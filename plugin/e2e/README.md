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

## Run tests

Local developer run:

```bash
cd plugin/e2e
npm test
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
- After moved blocks are detected, the test stores persistent artifacts:
  - screenshot: `after-detection.png`
  - full DOM snapshot: `after-detection.html`
  - metadata: `metadata.json`
  - default location: `plugin/e2e/artifacts/<timestamp>/`
  - stable symlink to newest run: `plugin/e2e/artifacts/latest`
  - override location with `RR_E2E_ARTIFACTS_DIR=/custom/path`
- The suite uses a live GitHub page and can fail if GitHub is unavailable or heavily rate-limited.
