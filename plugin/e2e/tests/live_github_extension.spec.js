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
const E2E_DIR = path.resolve(__dirname, "..");
const GITHUB_AUTH_CONFIG_PATH = path.join(E2E_DIR, "github-auth.local.json");
const LOCAL_BACKEND_BASE_URL = "http://127.0.0.1:8000";
const DIFF_VIEW_UNIFIED = "unified";
const DIFF_VIEW_SPLIT = "split";
const ARTIFACTS_DIR = resolveArtifactsDir();
const GITHUB_AUTH_CONFIG = loadGithubAuthConfig();

function getRunTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveArtifactsDir() {
  const configuredDir = (process.env.RR_E2E_ARTIFACTS_DIR || "").trim();
  if (configuredDir) {
    const resolved = path.resolve(configuredDir);
    ensureLatestArtifactsSymlink(resolved);
    return resolved;
  }
  const resolved = path.resolve(__dirname, "..", "artifacts", `run-${getRunTimestamp()}`);
  ensureLatestArtifactsSymlink(resolved);
  return resolved;
}

function ensureLatestArtifactsSymlink(artifactsDir) {
  const artifactsRoot = path.resolve(__dirname, "..", "artifacts");
  const latestPath = path.join(artifactsRoot, "latest");
  fs.mkdirSync(artifactsRoot, { recursive: true });
  if (fs.existsSync(latestPath) && !fs.lstatSync(latestPath).isSymbolicLink()) {
    fs.rmSync(latestPath, { recursive: true, force: true });
  }
  try {
    fs.unlinkSync(latestPath);
  } catch (_error) {
    // Ignore: latest link might not exist yet.
  }
  fs.symlinkSync(artifactsDir, latestPath, "dir");
}

function loadGithubAuthConfig() {
  const setupMessage =
    `Missing or invalid GitHub auth config.\n` +
    `Create "${GITHUB_AUTH_CONFIG_PATH}" by copying "${GITHUB_AUTH_CONFIG_PATH}.example", then set username/password/prUrl.`;

  if (!fs.existsSync(GITHUB_AUTH_CONFIG_PATH)) {
    throw new Error(setupMessage);
  }

  let parsedConfig;
  try {
    parsedConfig = JSON.parse(fs.readFileSync(GITHUB_AUTH_CONFIG_PATH, "utf8"));
  } catch (_error) {
    throw new Error(`${setupMessage}\nThe file is not valid JSON.`);
  }

  const username = typeof parsedConfig.username === "string" ? parsedConfig.username.trim() : "";
  const password = typeof parsedConfig.password === "string" ? parsedConfig.password : "";
  const prUrl = typeof parsedConfig.prUrl === "string" ? parsedConfig.prUrl.trim() : "";
  if (!username || !password || !prUrl) {
    throw new Error(`${setupMessage}\nRequired keys: username, password, prUrl.`);
  }
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/(files|changes)(?:[/?#].*)?$/.test(prUrl)) {
    throw new Error(
      `${setupMessage}\nprUrl must be a GitHub pull request files/changes page URL.`
    );
  }

  return { username, password, prUrl };
}

async function savePostDetectionArtifacts(page, markerCount, view) {
  const artifactsDir = ARTIFACTS_DIR;
  fs.mkdirSync(artifactsDir, { recursive: true });

  const screenshotPath = path.join(artifactsDir, `after-detection-${view}.png`);
  const htmlPath = path.join(artifactsDir, `after-detection-${view}.html`);
  const metadataPath = path.join(artifactsDir, "metadata.json");
  const capturedAt = new Date().toISOString();

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const badge = document.querySelector("#detected_moves_counter");
          if (!badge) return false;
          const text = (badge.textContent || "").trim();
          const className = badge.className || "";
          if (text === "…" || className.includes("rr-detect-badge-running")) {
            return false;
          }
          return className.includes("rr-detect-badge-success") && text.length > 0;
        }),
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 3_000, 5_000],
        message: `Detection badge is still running while capturing "${view}" artifacts.`,
      }
    )
    .toBe(true);

  await page.waitForLoadState("domcontentloaded");
  let htmlContent = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      htmlContent = await page.content();
      break;
    } catch (error) {
      if (attempt === 5) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(500 * attempt);
    }
  }
  fs.writeFileSync(htmlPath, htmlContent || "", "utf8");

  let metadata = {};
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    } catch (_error) {
      metadata = {};
    }
  }

  if (!metadata.createdAt) {
    metadata.createdAt = capturedAt;
  }
  if (!metadata.views || typeof metadata.views !== "object") {
    metadata.views = {};
  }
  metadata.updatedAt = capturedAt;
  metadata.lastCapturedView = view;
  metadata.views[view] = {
    capturedAt,
    pageUrl: page.url(),
    markerCount,
    screenshotFile: path.basename(screenshotPath),
    htmlFile: path.basename(htmlPath),
  };

  fs.writeFileSync(
    metadataPath,
    JSON.stringify(metadata, null, 2),
    "utf8"
  );

  console.log(`Saved ${view} post-detection artifacts to: ${artifactsDir}`);
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

async function signInToGitHub(page, authConfig) {
  await navigateWithRetry(page, "https://github.com/login", 3);

  await expect(
    page.locator("#login_field"),
    "GitHub login page did not render expected username field."
  ).toBeVisible({ timeout: 30_000 });

  await page.locator("#login_field").fill(authConfig.username);
  await page.locator("#password").fill(authConfig.password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator('input[type="submit"][name="commit"]').click(),
  ]);

  if (page.url().includes("/login")) {
    throw new Error(
      "GitHub sign-in failed (still on /login). Check credentials in github-auth.local.json."
    );
  }
  if (page.url().includes("/sessions/two-factor")) {
    throw new Error(
      "GitHub account requires 2FA challenge; this E2E flow currently expects no interactive 2FA."
    );
  }
}

async function switchToNewExperienceIfAvailable(page) {
  const tryNewExperienceButton = page
    .locator('button:visible', { hasText: "Try the new experience" })
    .first();
  if (await tryNewExperienceButton.isVisible()) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      tryNewExperienceButton.click(),
    ]);
  }

  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() => {
            const pathLooksNew = /\/pull\/\d+\/changes(?:\/.*)?$/.test(window.location.pathname);
            const hasPreviewBadge =
              document.querySelector('[class*="FilesChangedFeedback-module__PreviewLabel"]') !== null;
            return pathLooksNew || hasPreviewBadge;
          });
        } catch (_error) {
          return false;
        }
      },
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 3_000],
        message:
          "Could not detect GitHub new Files experience. Ensure the account has preview enabled.",
      }
    )
    .toBe(true);
}

async function switchToClassicExperience(page) {
  const previewMenuButton = page
    .locator('button:has([class*="FilesChangedFeedback-module__PreviewLabel"]):visible')
    .first();
  await expect(
    previewMenuButton,
    'Preview menu button for "Switch to the classic experience" was not found.'
  ).toBeVisible({ timeout: 45_000 });

  await previewMenuButton.click();

  const classicExperienceMenuItem = page
    .locator('a:visible', { hasText: "Switch to the classic experience" })
    .first();
  await expect(
    classicExperienceMenuItem,
    'Menu item "Switch to the classic experience" was not found after opening Preview menu.'
  ).toBeVisible({ timeout: 20_000 });

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    classicExperienceMenuItem.click(),
  ]);
}

async function getNewExperienceDiffView(page) {
  try {
    const parsed = new URL(page.url());
    const diffParam = (parsed.searchParams.get("diff") || "").toLowerCase();
    if (diffParam === "split") return "split";
    if (diffParam === "unified") return "unified";
  } catch (_error) {
    // Ignore URL parsing issues and fall back to DOM heuristics.
  }

  return page.evaluate(() => {
    const leftCells = document.querySelectorAll(
      '.left-side-diff-cell[data-line-number], [data-diff-side="left"][data-line-number]'
    ).length;
    const rightCells = document.querySelectorAll(
      '.right-side-diff-cell[data-line-number], [data-diff-side="right"][data-line-number]'
    ).length;
    if (leftCells > 0 && rightCells > 0) {
      return "split";
    }
    if (leftCells > 0 || rightCells > 0) {
      return "unified";
    }
    return "unknown";
  });
}

async function switchNewExperienceDiffView(page, view) {
  if (view !== DIFF_VIEW_UNIFIED && view !== DIFF_VIEW_SPLIT) {
    throw new Error(`Unsupported new-experience diff view: ${view}`);
  }

  const currentView = await getNewExperienceDiffView(page);
  if (currentView === view) {
    return;
  }

  const diffSettingsButton = page
    .getByRole("button", { name: /open diff view settings/i })
    .first();
  await expect(
    diffSettingsButton,
    "Could not find new-experience diff settings button."
  ).toBeVisible({ timeout: 45_000 });
  await diffSettingsButton.click();

  let optionLocator = page.getByRole("menuitemradio", {
    name: view === DIFF_VIEW_UNIFIED ? /unified/i : /split/i,
  });
  if (!(await optionLocator.first().isVisible().catch(() => false))) {
    optionLocator = page.getByRole("menuitem", {
      name: view === DIFF_VIEW_UNIFIED ? /unified/i : /split/i,
    });
  }
  if (!(await optionLocator.first().isVisible().catch(() => false))) {
    optionLocator = page.getByRole("button", {
      name: view === DIFF_VIEW_UNIFIED ? /unified/i : /split/i,
    });
  }

  const option = optionLocator.first();
  await expect(
    option,
    `Could not find "${view}" option in new-experience diff settings menu.`
  ).toBeVisible({ timeout: 20_000 });

  await option.click();
  await page.waitForLoadState("domcontentloaded");

  await expect
    .poll(async () => getNewExperienceDiffView(page), {
      timeout: 45_000,
      intervals: [1_000, 2_000, 3_000, 5_000],
      message: `New-experience diff view did not switch to "${view}".`,
    })
    .toBe(view);
}

async function isClassicDiffSettingsAvailable(page) {
  const diffSettingsControl = page
    .locator('details.diffbar-item summary:has(svg[aria-label="Diff settings"]):visible')
    .first();
  return diffSettingsControl.isVisible();
}

async function switchGitHubDiffView(page, view) {
  if (view !== DIFF_VIEW_UNIFIED && view !== DIFF_VIEW_SPLIT) {
    throw new Error(`Unsupported diff view: ${view}`);
  }

  const radioSelector =
    view === DIFF_VIEW_UNIFIED
      ? "#diff_unified_lg:visible, #diff_unified:visible"
      : "#diff_split_lg:visible, #diff_split:visible";
  const targetRadio = page.locator(radioSelector).first();

  if (!(await targetRadio.isVisible())) {
    const diffSettingsSummary = page
      .locator('details.diffbar-item summary:has(svg[aria-label="Diff settings"]):visible')
      .first();
    await expect(
      diffSettingsSummary,
      "Could not find visible GitHub diff settings control."
    ).toBeVisible({ timeout: 45_000 });
    await diffSettingsSummary.click();
    await expect(
      targetRadio,
      `Could not open diff settings to select "${view}" view.`
    ).toBeVisible({ timeout: 15_000 });
  }

  if (await targetRadio.isChecked()) {
    return;
  }

  await targetRadio.check({ force: true });
  const applyButton = page
    .locator('button:visible', { hasText: "Apply and reload" })
    .first();
  await expect(
    applyButton,
    `Apply and reload button is missing for "${view}" view change.`
  ).toBeVisible({ timeout: 15_000 });

  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    applyButton.click(),
  ]);
}

async function runDetectionAndExpectMarkers(page, serviceWorker, view) {
  await expect(
    page.locator("#detect_moved_blocks"),
    `ReviewRaccoon toolbar icon button was not injected after switching to "${view}" view.`
  ).toBeVisible({ timeout: 90_000 });

  let lastTriggerErrorMessage = null;
  try {
    await expect
      .poll(
        async () => {
          try {
            await enableDetectionAndTriggerRun(serviceWorker, LOCAL_BACKEND_BASE_URL);
            lastTriggerErrorMessage = null;
            return true;
          } catch (error) {
            lastTriggerErrorMessage = error && error.message ? error.message : String(error);
            return false;
          }
        },
        {
          timeout: 45_000,
          intervals: [1_000, 2_000, 3_000, 5_000],
          message: `Failed to trigger run_detection_now in "${view}" view.`,
        }
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `Failed to trigger run_detection_now in "${view}" view. Last error: ${
        lastTriggerErrorMessage || "unknown"
      }. Original error: ${error.message}`
    );
  }

  try {
    await expect
      .poll(async () => page.locator(".rr-marker").count(), {
        timeout: 120_000,
        intervals: [1_000, 2_000, 3_000, 5_000],
        message: `No moved-block markers were rendered on GitHub diff page in "${view}" view.`,
      })
      .toBeGreaterThan(0);
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const badge = document.querySelector("#detected_moves_counter");
      const status = badge ? badge.textContent : null;
      const markerCount = document.querySelectorAll(".rr-marker").length;
      const hasButton = !!document.querySelector("#detect_moved_blocks");
      return { markerCount, hasButton, badgeText: status };
    });
    throw new Error(
      `No moved-block markers detected in "${view}" view. Diagnostics: ${JSON.stringify(
        diagnostics
      )}. Original error: ${error.message}`
    );
  }

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const badge = document.querySelector("#detected_moves_counter");
          if (!badge) return false;
          const text = (badge.textContent || "").trim();
          const className = badge.className || "";
          if (text === "…" || className.includes("rr-detect-badge-running")) {
            return false;
          }
          return className.includes("rr-detect-badge-success") && text.length > 0;
        }),
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 3_000, 5_000],
        message: `Detection badge did not reach success state in "${view}" view before artifact capture.`,
      }
    )
    .toBe(true);

  return page.locator(".rr-marker").count();
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

  const shouldRunHeadless = process.env.PW_HEADLESS !== "0";
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
    await signInToGitHub(page, GITHUB_AUTH_CONFIG);
    await navigateWithRetry(page, GITHUB_AUTH_CONFIG.prUrl, 3);
    await switchToNewExperienceIfAvailable(page);

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

    await switchNewExperienceDiffView(page, DIFF_VIEW_UNIFIED);
    const newUnifiedMarkerCount = await runDetectionAndExpectMarkers(
      page,
      serviceWorker,
      "new-unified"
    );
    await savePostDetectionArtifacts(page, newUnifiedMarkerCount, "new-unified");

    await switchNewExperienceDiffView(page, DIFF_VIEW_SPLIT);
    const newSplitMarkerCount = await runDetectionAndExpectMarkers(
      page,
      serviceWorker,
      "new-split"
    );
    await savePostDetectionArtifacts(page, newSplitMarkerCount, "new-split");

    await switchToClassicExperience(page);
    await expect
      .poll(async () => isClassicDiffSettingsAvailable(page), {
        timeout: 45_000,
        intervals: [1_000, 2_000, 3_000],
        message: "Classic diff settings control is required to capture classic unified/split screenshots.",
      })
      .toBe(true);

    await switchGitHubDiffView(page, DIFF_VIEW_UNIFIED);
    const classicUnifiedMarkerCount = await runDetectionAndExpectMarkers(
      page,
      serviceWorker,
      "classic-unified"
    );
    await savePostDetectionArtifacts(page, classicUnifiedMarkerCount, "classic-unified");

    await switchGitHubDiffView(page, DIFF_VIEW_SPLIT);
    const classicSplitMarkerCount = await runDetectionAndExpectMarkers(
      page,
      serviceWorker,
      "classic-split"
    );
    await savePostDetectionArtifacts(page, classicSplitMarkerCount, "classic-split");
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
