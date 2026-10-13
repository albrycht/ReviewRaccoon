"use strict";

const REFRESH_INTERVAL_MS = 1500;
const DEFAULT_EXPAND_ALL_LARGE_DIFFS = true;
const DEFAULT_DETECTION_ENABLED = true;
const DEFAULT_CUSTOM_SERVER_ENABLED = false;
const DEFAULT_CUSTOM_SERVER_BASE_URL = "https://reviewraccoon.com";

let activeTabId = null;
let activeTabUrl = "";
let refreshTimer = null;
let settingsDirty = false;
let isSavingSettings = false;
let isUpdatingDetectionEnabled = false;
let popupLocalError = null;
let settingsState = "Up to date";
let latestState = null;
let popupPort = null;

function runtime_send_message(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response from background." });
    });
  });
}

function tab_send_message(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

function get_active_tab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve((tabs && tabs[0]) || null);
    });
  });
}

function format_status(status) {
  const map = {
    idle: "Ready",
    running: "Detecting",
    success: "Found blocks",
    no_blocks: "No blocks found",
    error: "Needs attention",
    disabled_by_settings: "Paused",
    not_supported_page: "Unsupported page",
  };
  return map[status] || status || "Unknown";
}

function is_detection_enabled_state(state) {
  if (!state || typeof state.detectionEnabled !== "boolean") {
    return DEFAULT_DETECTION_ENABLED;
  }
  return state.detectionEnabled;
}

function is_custom_server_enabled_state(state) {
  if (!state || typeof state.customServerEnabled !== "boolean") {
    return DEFAULT_CUSTOM_SERVER_ENABLED;
  }
  return state.customServerEnabled;
}

function get_custom_server_base_url_state(state) {
  if (!state || typeof state.customServerBaseUrl !== "string" || !state.customServerBaseUrl.trim()) {
    return DEFAULT_CUSTOM_SERVER_BASE_URL;
  }
  return state.customServerBaseUrl;
}

function get_status_pill_class(status) {
  if (status === "running") return "statusRunning";
  if (status === "success" || status === "no_blocks") return "statusSuccess";
  if (status === "error") return "statusError";
  if (status === "not_supported_page" || status === "disabled_by_settings") return "statusNeutral";
  return "statusIdle";
}

function format_phase(phase, subPhase) {
  if (!phase) return "-";
  if (!subPhase) return phase;
  return `${phase} / ${subPhase}`;
}

function format_updated_at(updatedAt) {
  if (!updatedAt) return "-";
  let date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString();
}

function format_context(url) {
  if (!url) return "No active tab URL";
  try {
    let parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return parsed.hostname;
    }
    let parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 4 && parts[2] === "pull") {
      return `${parts[0]}/${parts[1]} #${parts[3]}`;
    }
    if (parts.length >= 4 && (parts[2] === "commit" || parts[2] === "commits")) {
      return `${parts[0]}/${parts[1]} @${parts[3].slice(0, 8)}`;
    }
    return "GitHub page";
  } catch (_ignored_error) {
    return "Unknown page";
  }
}

function render_diff_url(element, diffUrl) {
  if (!element) {
    return;
  }
  element.textContent = "";
  if (!diffUrl) {
    element.textContent = "-";
    return;
  }
  let link = document.createElement("a");
  link.href = diffUrl;
  link.textContent = diffUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "technicalLink";
  element.appendChild(link);
}

function get_status_headline_and_hint(state) {
  if (state.status === "running") {
    return {
      headline: "Detecting moved blocks",
      hint: "Analyzing this diff now. This usually takes a few seconds.",
    };
  }
  if (state.status === "success") {
    return {
      headline: `Found ${state.blockCount} moved block${state.blockCount === 1 ? "" : "s"}`,
      hint: "Use the in-page markers to jump between matching code sections.",
    };
  }
  if (state.status === "no_blocks") {
    return {
      headline: "No moved blocks found",
      hint: "Try lowering Min lines in block, then run detection again.",
    };
  }
  if (state.status === "disabled_by_settings") {
    return {
      headline: "Detection is paused",
      hint: "Turn on Enable detection to resume moved block analysis.",
    };
  }
  if (state.status === "not_supported_page") {
    return {
      headline: "Unsupported page",
      hint: "Open a GitHub PR files page or commit page to use ReviewRaccoon.",
    };
  }
  if (state.status === "error") {
    return {
      headline: "Something went wrong",
      hint: "Try Retry first. If it fails again, open technical details below.",
    };
  }
  return {
    headline: "Ready to detect moved blocks",
    hint: "Run detection now, or open a GitHub PR files page first.",
  };
}

// Mirrors normalize_custom_server_base_url() in background.js.
function normalize_custom_server_base_url(value) {
  let raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return DEFAULT_CUSTOM_SERVER_BASE_URL;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) {
    raw = `http://${raw}`;
  }
  try {
    let parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_CUSTOM_SERVER_BASE_URL;
    }
    return parsed.origin;
  } catch (_ignored_error) {
    return DEFAULT_CUSTOM_SERVER_BASE_URL;
  }
}

// Must be called synchronously from a click handler (user gesture). Not awaited
// before saving: Firefox may close the popup while the permission prompt is open.
function request_custom_server_permission(base_url) {
  let parsed = new URL(normalize_custom_server_base_url(base_url));
  let origin = `${parsed.protocol}//${parsed.hostname}/*`;
  return chrome.permissions
    .request({ origins: [origin] })
    .then((granted) => ({ granted: granted, origin: origin }))
    .catch((error) => ({ granted: false, origin: origin, error: error }));
}

function get_readable_error_title(state) {
  if (!state || state.status !== "error") return "Detection failed";
  if (state.reasonCode === "server_permission_missing") return "Server access not granted";
  if (state.phase === "diff_download") return "Couldn't download GitHub diff";
  if (state.phase === "server_request") return "Couldn't reach ReviewRaccoon server";
  if (state.phase === "server_response") return "ReviewRaccoon server returned invalid response";
  if (state.phase === "render") return "Couldn't display blocks on GitHub page";
  if (state.phase === "precheck") return "Page is not ready for detection";
  return "Detection failed";
}

function diagnostics_payload(state) {
  return {
    context: {
      tabId: activeTabId,
      tabUrl: activeTabUrl,
      generatedAt: new Date().toISOString(),
    },
    state: state,
    popupLocalError: popupLocalError,
  };
}

function render_state(state) {
  latestState = state;
  let enabledContentEl = document.getElementById("enabledContent");
  let disabledContentEl = document.getElementById("disabledContent");
  let statusEl = document.getElementById("statusValue");
  let blockCountEl = document.getElementById("blockCountValue");
  let phaseEl = document.getElementById("phaseValue");
  let diffUrlEl = document.getElementById("diffUrlValue");
  let reasonEl = document.getElementById("errorReasonValue");
  let errorSectionEl = document.getElementById("errorSection");
  let errorTitleEl = document.getElementById("errorReadableTitle");
  let errorMessageEl = document.getElementById("errorMessageValue");
  let statusPillEl = document.getElementById("statusPill");
  let contextValueEl = document.getElementById("contextValue");
  let statusHeadlineEl = document.getElementById("statusHeadline");
  let statusHintEl = document.getElementById("statusHint");
  let updatedAtEl = document.getElementById("updatedAtValue");
  let settingsStateEl = document.getElementById("settingsStateValue");
  let minLinesInputEl = document.getElementById("minLinesInput");
  let expandLargeDiffsToggleEl = document.getElementById("expandLargeDiffsToggle");
  let customServerToggleEl = document.getElementById("customServerToggle");
  let customServerUrlInputEl = document.getElementById("customServerUrlInput");
  let customServerInputRowEl = document.getElementById("customServerInputRow");
  let enableDetectionToggleEl = document.getElementById("enableDetectionToggle");
  let runNowButtonEl = document.getElementById("runNowButton");
  let retryButtonEl = document.getElementById("retryButton");
  let openPageButtonEl = document.getElementById("openPageButton");

  statusEl.textContent = format_status(state.status);
  blockCountEl.textContent = Number.isFinite(state.blockCount) ? String(state.blockCount) : "-";
  phaseEl.textContent = format_phase(state.phase, state.subPhase);
  render_diff_url(diffUrlEl, state.diffUrl);
  reasonEl.textContent = state.reasonCode || "-";
  updatedAtEl.textContent = format_updated_at(state.updatedAt);
  settingsStateEl.textContent = settingsState;
  contextValueEl.textContent = format_context(activeTabUrl);

  let statusUi = get_status_headline_and_hint(state);
  statusHeadlineEl.textContent = statusUi.headline;
  statusHintEl.textContent = statusUi.hint;
  statusPillEl.textContent = format_status(state.status);
  statusPillEl.className = `statusPill ${get_status_pill_class(state.status)}`;

  let detection_enabled = is_detection_enabled_state(state);
  if (enabledContentEl && disabledContentEl) {
    enabledContentEl.classList.toggle("hidden", !detection_enabled);
    disabledContentEl.classList.toggle("hidden", detection_enabled);
  }

  runNowButtonEl.disabled = state.status === "running" || !detection_enabled;
  retryButtonEl.disabled = state.status === "running";
  openPageButtonEl.disabled = !Number.isFinite(activeTabId);

  if (!settingsDirty && !isSavingSettings) {
    minLinesInputEl.value = Number.isFinite(state.minLinesCount) ? String(state.minLinesCount) : "2";
    expandLargeDiffsToggleEl.checked =
      typeof state.expandAllLargeDiffs === "boolean" ? state.expandAllLargeDiffs : DEFAULT_EXPAND_ALL_LARGE_DIFFS;
    customServerToggleEl.checked = is_custom_server_enabled_state(state);
    customServerUrlInputEl.value = get_custom_server_base_url_state(state);
  }
  if (!isUpdatingDetectionEnabled && enableDetectionToggleEl) {
    enableDetectionToggleEl.checked = detection_enabled;
  }
  if (enableDetectionToggleEl) {
    enableDetectionToggleEl.disabled = isUpdatingDetectionEnabled;
  }
  if (customServerInputRowEl && customServerToggleEl) {
    customServerInputRowEl.classList.toggle("hidden", !customServerToggleEl.checked);
  }

  if (popupLocalError) {
    errorSectionEl.classList.remove("hidden");
    errorTitleEl.textContent = "Popup action failed";
    errorMessageEl.textContent = popupLocalError.errorMessage || "Unknown popup error.";
    return;
  }

  if (state.status === "error") {
    errorSectionEl.classList.remove("hidden");
    errorTitleEl.textContent = get_readable_error_title(state);
    errorMessageEl.textContent = state.errorMessage || "Unknown error.";
  } else {
    errorSectionEl.classList.add("hidden");
    errorTitleEl.textContent = "Detection failed";
    errorMessageEl.textContent = "-";
  }
}

async function refresh_popup_state() {
  if (!Number.isFinite(activeTabId)) {
    return;
  }
  let response = await runtime_send_message({
    popupQuery: "get_tab_state",
    tabId: activeTabId,
    tabUrl: activeTabUrl,
  });
  if (!response.ok) {
    render_state({
      status: "error",
      blockCount: 0,
      phase: "precheck",
      subPhase: null,
      reasonCode: "popup_state_fetch_failed",
      errorMessage: response.error || "Failed to read extension state.",
      updatedAt: new Date().toISOString(),
      minLinesCount: 2,
      expandAllLargeDiffs: DEFAULT_EXPAND_ALL_LARGE_DIFFS,
      customServerEnabled: DEFAULT_CUSTOM_SERVER_ENABLED,
      customServerBaseUrl: DEFAULT_CUSTOM_SERVER_BASE_URL,
      detectionEnabled: DEFAULT_DETECTION_ENABLED,
    });
    return;
  }
  render_state(response.state);
}

async function save_settings() {
  if (isSavingSettings) {
    return;
  }
  let inputEl = document.getElementById("minLinesInput");
  let expandLargeDiffsToggleEl = document.getElementById("expandLargeDiffsToggle");
  let customServerToggleEl = document.getElementById("customServerToggle");
  let customServerUrlInputEl = document.getElementById("customServerUrlInput");
  let enableDetectionToggleEl = document.getElementById("enableDetectionToggle");
  let saveButtonEl = document.getElementById("saveSettingsButton");
  let value = Number.parseFloat(inputEl.value);
  if (Number.isNaN(value)) {
    value = 2;
  }
  let expand_all_large_diffs = expandLargeDiffsToggleEl.checked;
  let custom_server_enabled = customServerToggleEl ? customServerToggleEl.checked : DEFAULT_CUSTOM_SERVER_ENABLED;
  let custom_server_base_url = customServerUrlInputEl
    ? customServerUrlInputEl.value
    : DEFAULT_CUSTOM_SERVER_BASE_URL;
  let detection_enabled = enableDetectionToggleEl ? enableDetectionToggleEl.checked : DEFAULT_DETECTION_ENABLED;
  let permission_request = custom_server_enabled
    ? request_custom_server_permission(custom_server_base_url)
    : null;

  isSavingSettings = true;
  settingsState = "Saving...";
  saveButtonEl.disabled = true;
  saveButtonEl.textContent = "Saving...";
  render_state(latestState || {
    status: "idle",
    blockCount: 0,
    phase: "idle",
    subPhase: null,
    reasonCode: null,
    updatedAt: new Date().toISOString(),
    minLinesCount: value,
    expandAllLargeDiffs: expand_all_large_diffs,
    customServerEnabled: custom_server_enabled,
    customServerBaseUrl: custom_server_base_url,
    detectionEnabled: detection_enabled,
  });

  let response = await runtime_send_message({
    popupQuery: "set_settings",
    minLinesCount: value,
    expandAllLargeDiffs: expand_all_large_diffs,
    customServerEnabled: custom_server_enabled,
    customServerBaseUrl: custom_server_base_url,
    detectionEnabled: detection_enabled,
    tabId: activeTabId,
  });

  isSavingSettings = false;
  saveButtonEl.disabled = false;
  saveButtonEl.textContent = "Save";

  if (!response || !response.ok) {
    popupLocalError = {
      reasonCode: "settings_save_failed",
      errorMessage: response && response.error ? response.error : "Could not save settings.",
    };
    settingsState = "Save failed";
    await refresh_popup_state();
    return;
  }

  if (permission_request) {
    let permission_result = await permission_request;
    if (!permission_result.granted) {
      popupLocalError = {
        reasonCode: "server_permission_denied",
        errorMessage: `Settings saved, but access to ${permission_result.origin} was not granted. Detection will fail until you click Save again and allow it.`,
      };
      settingsDirty = false;
      settingsState = "Saved";
      await refresh_popup_state();
      return;
    }
  }

  popupLocalError = null;
  settingsDirty = false;
  settingsState = "Saved";
  await refresh_popup_state();
}

async function set_detection_enabled(detectionEnabled) {
  if (isUpdatingDetectionEnabled) {
    return;
  }
  isUpdatingDetectionEnabled = true;
  popupLocalError = null;
  settingsState = detectionEnabled ? "Enabling detection..." : "Pausing detection...";
  render_state(
    latestState || {
      status: "idle",
      blockCount: 0,
      phase: "idle",
      subPhase: null,
      reasonCode: null,
      updatedAt: new Date().toISOString(),
      minLinesCount: 2,
      expandAllLargeDiffs: DEFAULT_EXPAND_ALL_LARGE_DIFFS,
      customServerEnabled: DEFAULT_CUSTOM_SERVER_ENABLED,
      customServerBaseUrl: DEFAULT_CUSTOM_SERVER_BASE_URL,
      detectionEnabled: detectionEnabled,
    }
  );

  let response = await runtime_send_message({
    popupQuery: "set_detection_enabled",
    detectionEnabled: detectionEnabled,
    tabId: activeTabId,
  });

  isUpdatingDetectionEnabled = false;

  if (!response || !response.ok) {
    popupLocalError = {
      reasonCode: "toggle_detection_failed",
      errorMessage: response && response.error ? response.error : "Could not update detection setting.",
    };
    settingsState = "Toggle failed";
    await refresh_popup_state();
    return;
  }

  settingsState = detectionEnabled ? "Detection enabled" : "Detection paused";
  await refresh_popup_state();
}

async function run_detection_now() {
  popupLocalError = null;
  if (!Number.isFinite(activeTabId)) {
    popupLocalError = {
      reasonCode: "no_active_tab",
      errorMessage: "No active tab found to run detection.",
    };
    await refresh_popup_state();
    return;
  }
  let response = await tab_send_message(activeTabId, {
    popupCommand: "run_detection_now",
  });
  if (!response || response.ok === false) {
    popupLocalError = {
      reasonCode: "run_now_failed",
      errorMessage: response && response.error ? response.error : "Could not trigger detection on this tab.",
    };
    await refresh_popup_state();
    return;
  }
  settingsState = "Up to date";
  await refresh_popup_state();
}

async function retry_detection() {
  await run_detection_now();
}

async function open_active_page() {
  if (Number.isFinite(activeTabId)) {
    await chrome.tabs.update(activeTabId, { active: true });
    window.close();
  }
}

async function copy_diagnostics() {
  try {
    let payload = diagnostics_payload(latestState);
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    popupLocalError = null;
    settingsState = "Diagnostics copied";
  } catch (_error) {
    popupLocalError = {
      reasonCode: "clipboard_failed",
      errorMessage: "Could not copy diagnostics. Please grant clipboard permissions and retry.",
    };
  }
  await refresh_popup_state();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    popupPort = chrome.runtime.connect({ name: "reviewraccoon-popup" });
    popupPort.onMessage.addListener((message) => {
      if (message && message.type === "close_popup") {
        window.close();
      }
    });
  } catch (_connect_error) {
    popupPort = null;
  }

  let saveSettingsButtonEl = document.getElementById("saveSettingsButton");
  let runNowButtonEl = document.getElementById("runNowButton");
  let retryButtonEl = document.getElementById("retryButton");
  let openPageButtonEl = document.getElementById("openPageButton");
  let copyDiagButtonEl = document.getElementById("copyDiagButton");
  let minLinesInputEl = document.getElementById("minLinesInput");
  let expandLargeDiffsToggleEl = document.getElementById("expandLargeDiffsToggle");
  let customServerToggleEl = document.getElementById("customServerToggle");
  let customServerUrlInputEl = document.getElementById("customServerUrlInput");
  let enableDetectionToggleEl = document.getElementById("enableDetectionToggle");

  saveSettingsButtonEl.addEventListener("click", save_settings);
  runNowButtonEl.addEventListener("click", run_detection_now);
  retryButtonEl.addEventListener("click", retry_detection);
  openPageButtonEl.addEventListener("click", open_active_page);
  copyDiagButtonEl.addEventListener("click", copy_diagnostics);
  minLinesInputEl.addEventListener("input", () => {
    settingsDirty = true;
    settingsState = "Unsaved changes";
    popupLocalError = null;
    render_state(latestState || {
      status: "idle",
      blockCount: 0,
      phase: "idle",
      subPhase: null,
      reasonCode: null,
      updatedAt: new Date().toISOString(),
      minLinesCount: Number.parseFloat(minLinesInputEl.value),
      expandAllLargeDiffs: expandLargeDiffsToggleEl.checked,
      customServerEnabled: customServerToggleEl.checked,
      customServerBaseUrl: customServerUrlInputEl.value,
      detectionEnabled: enableDetectionToggleEl.checked,
    });
  });
  expandLargeDiffsToggleEl.addEventListener("change", () => {
    settingsDirty = true;
    settingsState = "Unsaved changes";
    popupLocalError = null;
    render_state(latestState || {
      status: "idle",
      blockCount: 0,
      phase: "idle",
      subPhase: null,
      reasonCode: null,
      updatedAt: new Date().toISOString(),
      minLinesCount: Number.parseFloat(minLinesInputEl.value),
      expandAllLargeDiffs: expandLargeDiffsToggleEl.checked,
      customServerEnabled: customServerToggleEl.checked,
      customServerBaseUrl: customServerUrlInputEl.value,
      detectionEnabled: enableDetectionToggleEl.checked,
    });
  });
  customServerToggleEl.addEventListener("change", () => {
    settingsDirty = true;
    settingsState = "Unsaved changes";
    popupLocalError = null;
    render_state(latestState || {
      status: "idle",
      blockCount: 0,
      phase: "idle",
      subPhase: null,
      reasonCode: null,
      updatedAt: new Date().toISOString(),
      minLinesCount: Number.parseFloat(minLinesInputEl.value),
      expandAllLargeDiffs: expandLargeDiffsToggleEl.checked,
      customServerEnabled: customServerToggleEl.checked,
      customServerBaseUrl: customServerUrlInputEl.value,
      detectionEnabled: enableDetectionToggleEl.checked,
    });
  });
  customServerUrlInputEl.addEventListener("input", () => {
    settingsDirty = true;
    settingsState = "Unsaved changes";
    popupLocalError = null;
    render_state(latestState || {
      status: "idle",
      blockCount: 0,
      phase: "idle",
      subPhase: null,
      reasonCode: null,
      updatedAt: new Date().toISOString(),
      minLinesCount: Number.parseFloat(minLinesInputEl.value),
      expandAllLargeDiffs: expandLargeDiffsToggleEl.checked,
      customServerEnabled: customServerToggleEl.checked,
      customServerBaseUrl: customServerUrlInputEl.value,
      detectionEnabled: enableDetectionToggleEl.checked,
    });
  });
  enableDetectionToggleEl.addEventListener("change", () => {
    set_detection_enabled(enableDetectionToggleEl.checked);
  });

  let activeTab = await get_active_tab();
  if (!activeTab || !Number.isFinite(activeTab.id)) {
    render_state({
      status: "error",
      blockCount: 0,
      phase: "precheck",
      subPhase: null,
      reasonCode: "no_active_tab",
      errorMessage: "Could not determine active tab.",
      updatedAt: new Date().toISOString(),
      minLinesCount: 2,
      expandAllLargeDiffs: DEFAULT_EXPAND_ALL_LARGE_DIFFS,
      customServerEnabled: DEFAULT_CUSTOM_SERVER_ENABLED,
      customServerBaseUrl: DEFAULT_CUSTOM_SERVER_BASE_URL,
      detectionEnabled: DEFAULT_DETECTION_ENABLED,
    });
    return;
  }

  activeTabId = activeTab.id;
  activeTabUrl = activeTab.url || "";

  await refresh_popup_state();

  refreshTimer = setInterval(() => {
    refresh_popup_state();
  }, REFRESH_INTERVAL_MS);
});

window.addEventListener("unload", () => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
  }
  if (popupPort) {
    try {
      popupPort.disconnect();
    } catch (_disconnect_error) {
      // Ignore disconnect errors during popup teardown.
    }
    popupPort = null;
  }
});
