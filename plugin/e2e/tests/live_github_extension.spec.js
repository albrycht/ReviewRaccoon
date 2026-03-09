const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect, chromium } = require("@playwright/test");

const EXTENSION_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "chrome-extension"
);
const LIVE_GITHUB_PR_FILES_URL =
  "https://github.com/albrycht/ReviewRaccoon/pull/1/files";
const LOCAL_BACKEND_BASE_URL = "http://127.0.0.1:8000";

function getRunTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveArtifactsDir() {
  const configuredDir = (process.env.RR_E2E_ARTIFACTS_DIR || "").trim();
  if (configuredDir) {
    return path.resolve(configuredDir);
  }
  return path.resolve(__dirname, "..", "artifacts", `run-${getRunTimestamp()}`);
}

async function savePostDetectionArtifacts(page, markerCount) {
  const artifactsDir = resolveArtifactsDir();
  fs.mkdirSync(artifactsDir, { recursive: true });

  const screenshotPath = path.join(artifactsDir, "after-detection.png");
  const htmlPath = path.join(artifactsDir, "after-detection.html");
  const metadataPath = path.join(artifactsDir, "metadata.json");

  await page.screenshot({ path: screenshotPath, fullPage: true });
  fs.writeFileSync(htmlPath, await page.content(), "utf8");
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        pageUrl: page.url(),
        markerCount,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Saved post-detection artifacts to: ${artifactsDir}`);
}

async function enableDetectionAndTriggerRun(serviceWorker, localBackendBaseUrl) {
  await serviceWorker.evaluate(async ({ backendBaseUrl }) => {
    await chrome.storage.local.set({
      "detect-moved-blocks__enabled": true,
      "detect-moved-blocks__min-lines-count": 2,
      "detect-moved-blocks__expand-all-large-diffs": true,
      "detect-moved-blocks__custom-server-enabled": true,
      "detect-moved-blocks__custom-server-base-url": backendBaseUrl,
    });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== "number") {
      throw new Error("Could not determine active tab for run_detection_now.");
    }

    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { popupCommand: "run_detection_now" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.ok === false) {
          reject(new Error(response.error || "run_detection_now failed."));
          return;
        }
        resolve();
      });
    });
  }, { backendBaseUrl: localBackendBaseUrl });
}

async function navigateWithRetry(page, url, maxAttempts) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      if (!response || response.status() < 500) {
        return;
      }

      lastError = new Error(
        `Navigation returned ${response.status()} on attempt ${attempt}.`
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      await page.waitForTimeout(2_000 * attempt);
    }
  }

  throw new Error(
    `Failed to load GitHub page after ${maxAttempts} attempts: ${
      lastError ? lastError.message : "unknown error"
    }`
  );
}

async function getExtensionServiceWorker(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (serviceWorker) {
    return serviceWorker;
  }
  serviceWorker = await context.waitForEvent("serviceworker", {
    timeout: 30_000,
  });
  return serviceWorker;
}

test("loads extension on GitHub and renders moved-block markers", async () => {
  test.setTimeout(180_000);

  const shouldRunHeadless = process.env.PW_HEADLESS === "1";
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reviewraccoon-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: shouldRunHeadless,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    const serviceWorker = await getExtensionServiceWorker(context);
    const extensionId = new URL(serviceWorker.url()).host;
    expect(extensionId).toBeTruthy();

    await serviceWorker.evaluate(async ({ localBackendBaseUrl }) => {
      await chrome.storage.local.set({
        "detect-moved-blocks__enabled": false,
        "detect-moved-blocks__min-lines-count": 2,
        "detect-moved-blocks__expand-all-large-diffs": true,
        "detect-moved-blocks__custom-server-enabled": true,
        "detect-moved-blocks__custom-server-base-url": localBackendBaseUrl,
      });
    }, { localBackendBaseUrl: LOCAL_BACKEND_BASE_URL });

    const page = context.pages()[0] || (await context.newPage());
    await navigateWithRetry(page, LIVE_GITHUB_PR_FILES_URL, 3);

    const detectButton = page.locator("#detect_moved_blocks");
    await expect(
      detectButton,
      "ReviewRaccoon toolbar icon button was not injected on GitHub page."
    ).toBeVisible({ timeout: 90_000 });

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const button = document.querySelector("#detect_moved_blocks");
            if (!button) {
              return false;
            }
            const img = button.querySelector(".rr-detect-icon");
            const fallback = button.querySelector(".rr-detect-icon-fallback");
            const imgSrc = img ? img.getAttribute("src") || "" : "";
            const imgShown =
              !!img &&
              imgSrc.startsWith("data:image/png;base64,") &&
              window.getComputedStyle(img).display !== "none";
            const fallbackShown =
              !!fallback && window.getComputedStyle(fallback).display !== "none";
            return imgShown || fallbackShown;
          }),
        {
          timeout: 45_000,
          intervals: [1_000, 2_000, 3_000],
          message:
            "Neither raccoon icon image nor fallback icon became visible in toolbar button.",
        }
      )
      .toBe(true);

    await expect
      .poll(
        async () => {
          try {
            await enableDetectionAndTriggerRun(serviceWorker, LOCAL_BACKEND_BASE_URL);
            return true;
          } catch (_error) {
            return false;
          }
        },
        {
          timeout: 20_000,
          intervals: [1_000, 2_000, 3_000],
          message: "Failed to trigger run_detection_now from extension service worker.",
        }
      )
      .toBe(true);

    try {
      await expect
        .poll(async () => page.locator(".detectedMovedBlock").count(), {
          timeout: 120_000,
          intervals: [1_000, 2_000, 3_000, 5_000],
          message: "No moved-block markers were rendered on GitHub diff page.",
        })
        .toBeGreaterThan(0);

      const markerCount = await page.locator(".detectedMovedBlock").count();
      await savePostDetectionArtifacts(page, markerCount);
    } catch (error) {
      const diagnostics = await page.evaluate(() => {
        const badge = document.querySelector("#detected_moves_counter");
        const status = badge ? badge.textContent : null;
        const markerCount = document.querySelectorAll(".detectedMovedBlock").length;
        const hasButton = !!document.querySelector("#detect_moved_blocks");
        return { markerCount, hasButton, badgeText: status };
      });
      throw new Error(
        `No moved-block markers detected. Diagnostics: ${JSON.stringify(
          diagnostics
        )}. Original error: ${error.message}`
      );
    }
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
