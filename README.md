# ReviewRaccoon
ReviewRaccoon helps developers in doing faster and better pull request review by detecting moved blocks of code. Detected blocks don't have to identical - small changes are allowed and they are indicated with darker background color.
It works for all text documents (language agnostic).

Currently project is in prototype phase.
## Examples

#### Python code example
Review of python code without ReviewRaccoon extension:
![Python code without ReviewRaccoon extension](examples/python_before.png/?raw=true "Python before")

The same page with ReviewRaccoon extension:
![Python code with ReviewRaccoon extension](examples/python_after.png/?raw=true "Python after")

#### Javascript code example

Before:
![Javascript code without ReviewRaccoon extension](examples/javascript_before.png/?raw=true "Javascript before")

After:
![Javascript code with ReviewRaccoon extension](examples/javascript_after.png/?raw=true "Javascript after")

## Server Development

Run all commands from the repository root.

### Start development server

```bash
uv run gunicorn --chdir server main:app --reload --bind 127.0.0.1:8000
```

The API will be available at `http://127.0.0.1:8000` (for example, `POST /moved-blocks`).

### Run tests

```bash
uv run --extra test python -m pytest server/tests
```

### Run Ruff (lint + format)

```bash
uv run --with ruff ruff check server
uv run --with ruff ruff format server
```

### Run Ty (type checker)

```bash
uv run --with ty ty check server
```

## Extension E2E (Playwright)

Run all commands from the repository root.

### One-time setup

```bash
cd plugin/e2e
npm install
npm run install:browsers
```

### Run live GitHub + localhost backend E2E

```bash
# from plugin/e2e
npm run test:agent
```

What this test does:
- loads unpacked extension from `plugin/src/chrome-extension`,
- opens live GitHub PR page `https://github.com/albrycht/ReviewRaccoon/pull/1/files`,
- starts backend on `http://127.0.0.1:8000`,
- runs Chromium in headless mode,
- verifies toolbar icon appears and moved-block markers are rendered,
- saves persistent artifacts for later analysis in `plugin/e2e/artifacts/<timestamp>/`:
  - `after-detection.png`
  - `after-detection.html`
  - `metadata.json`
- refreshes stable symlink `plugin/e2e/artifacts/latest` to the newest artifact directory.