#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${E2E_DIR}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACTS_DIR="${RR_E2E_ARTIFACTS_DIR:-${E2E_DIR}/artifacts/${TIMESTAMP}}"
mkdir -p "${ARTIFACTS_DIR}"

LATEST_LINK="${E2E_DIR}/artifacts/latest"
if [[ -e "${LATEST_LINK}" && ! -L "${LATEST_LINK}" ]]; then
  rm -rf "${LATEST_LINK}"
fi
ln -sfn "${ARTIFACTS_DIR}" "${LATEST_LINK}"

echo "Running Playwright in headless mode."
echo "Artifacts directory: ${ARTIFACTS_DIR}"
echo "Latest artifacts symlink: ${LATEST_LINK}"

PW_HEADLESS=1 RR_E2E_ARTIFACTS_DIR="${ARTIFACTS_DIR}" npx playwright test "$@"
