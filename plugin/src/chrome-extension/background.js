"use strict";

const DEFAULT_SERVER_BASE_URL = "https://reviewraccoon.com";
const MIN_LINES_STORAGE_KEY = "detect-moved-blocks__min-lines-count";
const DEFAULT_MIN_LINES_COUNT = 2;
const EXPAND_ALL_LARGE_DIFFS_STORAGE_KEY = "detect-moved-blocks__expand-all-large-diffs";
const DEFAULT_EXPAND_ALL_LARGE_DIFFS = true;
const DETECTION_ENABLED_STORAGE_KEY = "detect-moved-blocks__enabled";
const DEFAULT_DETECTION_ENABLED = true;
const CUSTOM_SERVER_ENABLED_STORAGE_KEY = "detect-moved-blocks__custom-server-enabled";
const DEFAULT_CUSTOM_SERVER_ENABLED = false;
const CUSTOM_SERVER_BASE_URL_STORAGE_KEY = "detect-moved-blocks__custom-server-base-url";
const DEFAULT_CUSTOM_SERVER_BASE_URL = DEFAULT_SERVER_BASE_URL;
const MAX_BADGE_COUNT = 999;
const tabState = new Map();
const popupPorts = new Set();
const POPUP_TOGGLE_GUARD_MS = 500;
let lastPopupClosedAt = 0;
let iconDataUrlPromise = null;

function create_default_state() {
  return {
    phase: "idle",
    subPhase: null,
    status: "idle",
    blockCount: 0,
    reasonCode: null,
    errorMessage: null,
    minLinesCount: DEFAULT_MIN_LINES_COUNT,
    expandAllLargeDiffs: DEFAULT_EXPAND_ALL_LARGE_DIFFS,
    detectionEnabled: DEFAULT_DETECTION_ENABLED,
    customServerEnabled: DEFAULT_CUSTOM_SERVER_ENABLED,
    customServerBaseUrl: DEFAULT_CUSTOM_SERVER_BASE_URL,
    diffUrl: null,
    updatedAt: new Date().toISOString(),
  };
}

function to_error_message(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return JSON.stringify(error);
}

function is_supported_github_diff_page(url) {
  if (!url || typeof url !== "string") return false;
  return /https:\/\/github\.com\/[^/]+\/[^/]+\/(pull\/\d+\/(?:files|changes)|pull\/\d+\/commits?\/[A-Za-z0-9]+|commits?\/[A-Za-z0-9]+)/.test(
    url
  );
}

function get_repo_params_from_url(url) {
  if (!url) return null;

  let pr_commit_match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/commits?\/([A-Za-z0-9]+)(?:\/.*)?$/
  );
  if (pr_commit_match) {
    return {
      user_name: pr_commit_match[1],
      repo_name: pr_commit_match[2],
      pull_number: pr_commit_match[3],
      commit_hash: pr_commit_match[4],
    };
  }

  let pr_match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/);
  if (pr_match) {
    return {
      user_name: pr_match[1],
      repo_name: pr_match[2],
      pull_number: pr_match[3],
      commit_hash: undefined,
    };
  }

  let commit_match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/commits?\/([A-Za-z0-9]+)(?:\/.*)?$/);
  if (commit_match) {
    return {
      user_name: commit_match[1],
      repo_name: commit_match[2],
      pull_number: undefined,
      commit_hash: commit_match[3],
    };
  }
  return null;
}

function get_diff_url(page_url) {
  let repo_params = get_repo_params_from_url(page_url);
  if (!repo_params) {
    return null;
  }
  if (repo_params.commit_hash === undefined) {
    return `https://github.com/${repo_params.user_name}/${repo_params.repo_name}/pull/${repo_params.pull_number}.diff`;
  }
  return `https://github.com/${repo_params.user_name}/${repo_params.repo_name}/commit/${repo_params.commit_hash}.diff`;
}

function normalize_min_lines_count(value) {
  let parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return DEFAULT_MIN_LINES_COUNT;
  return Math.max(0, parsed);
}

function normalize_expand_all_large_diffs(value) {
  if (typeof value === "boolean") return value;
  return DEFAULT_EXPAND_ALL_LARGE_DIFFS;
}

function normalize_detection_enabled(value) {
  if (typeof value === "boolean") return value;
  return DEFAULT_DETECTION_ENABLED;
}

function normalize_custom_server_enabled(value) {
  if (typeof value === "boolean") return value;
  return DEFAULT_CUSTOM_SERVER_ENABLED;
}

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

async function get_min_lines_count_setting() {
  let result = await chrome.storage.local.get([MIN_LINES_STORAGE_KEY]);
  return normalize_min_lines_count(result[MIN_LINES_STORAGE_KEY]);
}

async function set_min_lines_count_setting(value) {
  let normalized = normalize_min_lines_count(value);
  await chrome.storage.local.set({ [MIN_LINES_STORAGE_KEY]: normalized });
  return normalized;
}

async function get_expand_all_large_diffs_setting() {
  let result = await chrome.storage.local.get([EXPAND_ALL_LARGE_DIFFS_STORAGE_KEY]);
  return normalize_expand_all_large_diffs(result[EXPAND_ALL_LARGE_DIFFS_STORAGE_KEY]);
}

async function set_expand_all_large_diffs_setting(value) {
  let normalized = normalize_expand_all_large_diffs(value);
  await chrome.storage.local.set({ [EXPAND_ALL_LARGE_DIFFS_STORAGE_KEY]: normalized });
  return normalized;
}

async function get_detection_enabled_setting() {
  let result = await chrome.storage.local.get([DETECTION_ENABLED_STORAGE_KEY]);
  return normalize_detection_enabled(result[DETECTION_ENABLED_STORAGE_KEY]);
}

async function set_detection_enabled_setting(value) {
  let normalized = normalize_detection_enabled(value);
  await chrome.storage.local.set({ [DETECTION_ENABLED_STORAGE_KEY]: normalized });
  return normalized;
}

async function get_custom_server_enabled_setting() {
  let result = await chrome.storage.local.get([CUSTOM_SERVER_ENABLED_STORAGE_KEY]);
  return normalize_custom_server_enabled(result[CUSTOM_SERVER_ENABLED_STORAGE_KEY]);
}

async function set_custom_server_enabled_setting(value) {
  let normalized = normalize_custom_server_enabled(value);
  await chrome.storage.local.set({ [CUSTOM_SERVER_ENABLED_STORAGE_KEY]: normalized });
  return normalized;
}

async function get_custom_server_base_url_setting() {
  let result = await chrome.storage.local.get([CUSTOM_SERVER_BASE_URL_STORAGE_KEY]);
  return normalize_custom_server_base_url(result[CUSTOM_SERVER_BASE_URL_STORAGE_KEY]);
}

async function set_custom_server_base_url_setting(value) {
  let normalized = normalize_custom_server_base_url(value);
  await chrome.storage.local.set({ [CUSTOM_SERVER_BASE_URL_STORAGE_KEY]: normalized });
  return normalized;
}

function resolve_moved_blocks_api_url(settings) {
  let use_custom_server = normalize_custom_server_enabled(settings && settings.customServerEnabled);
  if (!use_custom_server) {
    return `${DEFAULT_SERVER_BASE_URL}/moved-blocks`;
  }
  let base_url = normalize_custom_server_base_url(settings && settings.customServerBaseUrl);
  return `${base_url}/moved-blocks`;
}

async function get_settings_snapshot() {
  let [min_lines_count, expand_all_large_diffs, detection_enabled, custom_server_enabled, custom_server_base_url] =
    await Promise.all([
      get_min_lines_count_setting(),
      get_expand_all_large_diffs_setting(),
      get_detection_enabled_setting(),
      get_custom_server_enabled_setting(),
      get_custom_server_base_url_setting(),
    ]);
  return {
    minLinesCount: min_lines_count,
    expandAllLargeDiffs: expand_all_large_diffs,
    detectionEnabled: detection_enabled,
    customServerEnabled: custom_server_enabled,
    customServerBaseUrl: custom_server_base_url,
  };
}

async function set_badge_for_tab(tabId, state) {
  if (typeof tabId !== "number") return;
  try {
    let set_text_color = async (color) => {
      if (typeof chrome.action.setBadgeTextColor === "function") {
        await chrome.action.setBadgeTextColor({ tabId: tabId, color: color });
      }
    };

    if (state.status === "disabled_by_settings") {
      await chrome.action.setBadgeText({ tabId: tabId, text: "⏸" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: [0, 0, 0, 0] });
      await set_text_color("#5f6368");
      return;
    }

    if (state.status === "error") {
      await chrome.action.setBadgeText({ tabId: tabId, text: "!" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#d93025" });
      await set_text_color("#ffffff");
      return;
    }

    if (state.status === "running") {
      await chrome.action.setBadgeText({ tabId: tabId, text: "…" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#1a73e8" });
      await set_text_color("#ffffff");
      return;
    }

    if (state.status === "success" || state.status === "no_blocks") {
      let badge_text = String(Math.min(state.blockCount || 0, MAX_BADGE_COUNT));
      await chrome.action.setBadgeText({ tabId: tabId, text: badge_text });
      await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#188038" });
      await set_text_color("#ffffff");
      return;
    }

    await chrome.action.setBadgeText({ tabId: tabId, text: "" });
  } catch (_ignored_error) {
    // Tab might be gone or inaccessible while badge update is in flight.
  }
}

async function update_tab_state(tabId, patch) {
  if (typeof tabId !== "number") return create_default_state();
  let current = tabState.get(tabId) || create_default_state();
  let next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  tabState.set(tabId, next);
  await set_badge_for_tab(tabId, next);
  return next;
}

async function get_or_create_tab_state(tabId, tabUrl) {
  let settings = await get_settings_snapshot();
  let is_supported_page = is_supported_github_diff_page(tabUrl);
  let existing = tabState.get(tabId);
  if (existing && !is_supported_page) {
    let downgraded = {
      ...existing,
      phase: "precheck",
      subPhase: null,
      status: "not_supported_page",
      blockCount: 0,
      reasonCode: null,
      errorMessage: null,
      minLinesCount: settings.minLinesCount,
      expandAllLargeDiffs: settings.expandAllLargeDiffs,
      detectionEnabled: settings.detectionEnabled,
      customServerEnabled: settings.customServerEnabled,
      customServerBaseUrl: settings.customServerBaseUrl,
      diffUrl: null,
    };
    tabState.set(tabId, downgraded);
    await set_badge_for_tab(tabId, downgraded);
    return downgraded;
  }
  if (is_supported_page && !settings.detectionEnabled) {
    let paused_state = {
      ...(existing || create_default_state()),
      phase: "precheck",
      subPhase: null,
      status: "disabled_by_settings",
      blockCount: 0,
      reasonCode: null,
      errorMessage: null,
      minLinesCount: settings.minLinesCount,
      expandAllLargeDiffs: settings.expandAllLargeDiffs,
      detectionEnabled: settings.detectionEnabled,
      customServerEnabled: settings.customServerEnabled,
      customServerBaseUrl: settings.customServerBaseUrl,
      diffUrl: null,
    };
    tabState.set(tabId, paused_state);
    await set_badge_for_tab(tabId, paused_state);
    return paused_state;
  }
  if (existing) {
    return {
      ...existing,
      minLinesCount: settings.minLinesCount,
      expandAllLargeDiffs: settings.expandAllLargeDiffs,
      detectionEnabled: settings.detectionEnabled,
      customServerEnabled: settings.customServerEnabled,
      customServerBaseUrl: settings.customServerBaseUrl,
    };
  }

  let initial = {
    ...create_default_state(),
    minLinesCount: settings.minLinesCount,
    expandAllLargeDiffs: settings.expandAllLargeDiffs,
    detectionEnabled: settings.detectionEnabled,
    customServerEnabled: settings.customServerEnabled,
    customServerBaseUrl: settings.customServerBaseUrl,
  };
  if (!is_supported_page) {
    initial.phase = "precheck";
    initial.status = "not_supported_page";
  } else if (!settings.detectionEnabled) {
    initial.phase = "precheck";
    initial.status = "disabled_by_settings";
  }
  tabState.set(tabId, initial);
  await set_badge_for_tab(tabId, initial);
  return initial;
}

function make_error_state(phase, subPhase, reasonCode, errorMessage, diffUrl) {
  let error_state = {
    phase: phase,
    subPhase: subPhase || null,
    status: "error",
    reasonCode: reasonCode || "unknown_error",
    errorMessage: errorMessage || "Unknown error",
  };
  if (diffUrl !== undefined) {
    error_state.diffUrl = diffUrl;
  }
  return error_state;
}

function array_buffer_to_base64(buffer) {
  let bytes = new Uint8Array(buffer);
  let chunk_size = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk_size) {
    let chunk = bytes.subarray(i, i + chunk_size);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function get_icon_data_url() {
  if (!iconDataUrlPromise) {
    iconDataUrlPromise = (async () => {
      let icon_url = chrome.runtime.getURL("images/raccoon_32.png");
      let response = await fetch(icon_url);
      if (!response.ok) {
        throw new Error(`Icon fetch failed with status ${response.status}`);
      }
      let buffer = await response.arrayBuffer();
      let base64 = array_buffer_to_base64(buffer);
      return `data:image/png;base64,${base64}`;
    })().catch((error) => {
      iconDataUrlPromise = null;
      throw error;
    });
  }
  return iconDataUrlPromise;
}

async function handle_diff_text_request(request, sender, sendResponse) {
  let tab_id = sender && sender.tab ? sender.tab.id : undefined;
  let page_url = request.pull_request_url || (sender && sender.tab ? sender.tab.url : "");
  let settings = await get_settings_snapshot();
  let min_lines_count = settings.minLinesCount;
  let detection_enabled = settings.detectionEnabled;
  let server_api_url = resolve_moved_blocks_api_url(settings);

  if (typeof tab_id !== "number") {
    sendResponse({
      ok: false,
      error: make_error_state("precheck", null, "missing_tab_id", "Could not determine tab id."),
    });
    return;
  }

  await update_tab_state(tab_id, {
    phase: "precheck",
    subPhase: null,
    status: "running",
    reasonCode: null,
    errorMessage: null,
    minLinesCount: min_lines_count,
    expandAllLargeDiffs: settings.expandAllLargeDiffs,
    detectionEnabled: detection_enabled,
    customServerEnabled: settings.customServerEnabled,
    customServerBaseUrl: settings.customServerBaseUrl,
    diffUrl: null,
  });

  if (!is_supported_github_diff_page(page_url)) {
    let state = await update_tab_state(tab_id, {
      phase: "precheck",
      status: "not_supported_page",
      reasonCode: null,
      errorMessage: null,
      blockCount: 0,
      diffUrl: null,
    });
    sendResponse({
      ok: false,
      error: {
        phase: state.phase,
        subPhase: state.subPhase,
        reasonCode: "unsupported_page",
        errorMessage: "This is not a supported GitHub PR files or commit page.",
      },
    });
    return;
  }

  if (min_lines_count < 0) {
    let state = await update_tab_state(tab_id, {
      phase: "precheck",
      status: "disabled_by_settings",
      reasonCode: null,
      errorMessage: null,
      blockCount: 0,
      diffUrl: null,
    });
    sendResponse({
      ok: false,
      error: {
        phase: state.phase,
        subPhase: state.subPhase,
        reasonCode: "disabled_by_settings",
        errorMessage: "Detection is disabled in settings.",
      },
    });
    return;
  }

  if (!detection_enabled) {
    let state = await update_tab_state(tab_id, {
      phase: "precheck",
      status: "disabled_by_settings",
      reasonCode: null,
      errorMessage: null,
      blockCount: 0,
      diffUrl: null,
    });
    sendResponse({
      ok: false,
      error: {
        phase: state.phase,
        subPhase: state.subPhase,
        reasonCode: "detection_paused",
        errorMessage: "Detection is paused in popup settings.",
      },
    });
    return;
  }

  let diff_url = get_diff_url(page_url);
  if (!diff_url) {
    let state = await update_tab_state(
      tab_id,
      make_error_state("precheck", null, "invalid_page_url", "Could not parse GitHub URL.", null)
    );
    sendResponse({ ok: false, error: state });
    return;
  }

  let diff_text = "";
  try {
    await update_tab_state(tab_id, {
      phase: "diff_download",
      subPhase: null,
      status: "running",
      reasonCode: null,
      errorMessage: null,
      diffUrl: diff_url,
    });

    let diff_response = await fetch(diff_url, {
      method: "GET",
      mode: "cors",
      headers: { "Content-Type": "text/plain" },
    });
    if (!diff_response.ok) {
      let state = await update_tab_state(
        tab_id,
        make_error_state(
          "diff_download",
          null,
          "diff_http_error",
          `GitHub diff request failed with status ${diff_response.status}.`,
          diff_url
        )
      );
      sendResponse({ ok: false, error: state });
      return;
    }
    diff_text = await diff_response.text();
  } catch (error) {
    let state = await update_tab_state(
      tab_id,
      make_error_state("diff_download", null, "diff_download_failed", to_error_message(error), diff_url)
    );
    sendResponse({ ok: false, error: state });
    return;
  }

  let server_response;
  try {
    await update_tab_state(tab_id, {
      phase: "server_request",
      subPhase: "server_connect",
      status: "running",
      reasonCode: null,
      errorMessage: null,
    });

    server_response = await fetch(server_api_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        diff_text: diff_text,
        pull_request_url: page_url,
        user_name: request.user_name,
        min_lines_count: min_lines_count,
      }),
    });
  } catch (error) {
    let state = await update_tab_state(
      tab_id,
      make_error_state("server_request", "server_connect", "server_connect_failed", to_error_message(error), diff_url)
    );
    sendResponse({ ok: false, error: state });
    return;
  }

  if (!server_response.ok) {
    let response_body = "";
    try {
      response_body = await server_response.text();
    } catch (_ignored_error) {
      response_body = "";
    }
    let state = await update_tab_state(
      tab_id,
      make_error_state(
        "server_response",
        "server_http_error",
        `server_http_${server_response.status}`,
        response_body || `ReviewRaccoon server returned ${server_response.status}.`,
        diff_url
      )
    );
    sendResponse({ ok: false, error: state });
    return;
  }

  let detected_blocks = null;
  try {
    await update_tab_state(tab_id, {
      phase: "server_response",
      subPhase: null,
      status: "running",
      reasonCode: null,
      errorMessage: null,
    });
    detected_blocks = await server_response.json();
    if (!Array.isArray(detected_blocks)) {
      throw new Error("Invalid response payload. Expected array of detected blocks.");
    }
  } catch (error) {
    let state = await update_tab_state(
      tab_id,
      make_error_state(
        "server_response",
        "server_invalid_payload",
        "server_invalid_payload",
        to_error_message(error),
        diff_url
      )
    );
    sendResponse({ ok: false, error: state });
    return;
  }

  await update_tab_state(tab_id, {
    phase: "render",
    subPhase: null,
    status: "running",
    reasonCode: null,
    errorMessage: null,
    blockCount: detected_blocks.length,
    diffUrl: diff_url,
  });
  sendResponse({
    ok: true,
    detectedBlocks: detected_blocks,
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "reviewraccoon-popup") {
    return;
  }
  popupPorts.add(port);
  port.onDisconnect.addListener(() => {
    popupPorts.delete(port);
    lastPopupClosedAt = Date.now();
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "loading") {
    return;
  }
  let settings = await get_settings_snapshot();
  if (!is_supported_github_diff_page(tab.url || "")) {
    await update_tab_state(tabId, {
      phase: "precheck",
      subPhase: null,
      status: "not_supported_page",
      blockCount: 0,
      reasonCode: null,
      errorMessage: null,
      minLinesCount: settings.minLinesCount,
      expandAllLargeDiffs: settings.expandAllLargeDiffs,
      detectionEnabled: settings.detectionEnabled,
      customServerEnabled: settings.customServerEnabled,
      customServerBaseUrl: settings.customServerBaseUrl,
      diffUrl: null,
    });
  } else {
    await update_tab_state(tabId, {
      phase: settings.detectionEnabled ? "idle" : "precheck",
      subPhase: null,
      status: settings.detectionEnabled ? "idle" : "disabled_by_settings",
      blockCount: 0,
      reasonCode: null,
      errorMessage: null,
      minLinesCount: settings.minLinesCount,
      expandAllLargeDiffs: settings.expandAllLargeDiffs,
      detectionEnabled: settings.detectionEnabled,
      customServerEnabled: settings.customServerEnabled,
      customServerBaseUrl: settings.customServerBaseUrl,
      diffUrl: null,
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.contentScriptQuery === "diff_text") {
      await handle_diff_text_request(request, sender, sendResponse);
      return;
    }

    if (request.contentScriptQuery === "update_tab_state") {
      let tab_id = sender && sender.tab ? sender.tab.id : request.tabId;
      let state = request.state || {};
      if (typeof tab_id !== "number") {
        sendResponse({ ok: false, error: "Missing tab id for state update." });
        return;
      }

      if (state.status === "success") {
        let block_count = Number.isFinite(state.blockCount) ? state.blockCount : 0;
        let saved_state = await update_tab_state(tab_id, {
          phase: state.phase || "render",
          subPhase: state.subPhase || null,
          status: block_count > 0 ? "success" : "no_blocks",
          blockCount: block_count,
          reasonCode: null,
          errorMessage: null,
        });
        sendResponse({ ok: true, state: saved_state });
        return;
      }

      if (state.status === "error") {
        let saved_state = await update_tab_state(
          tab_id,
          make_error_state(
            state.phase || "render",
            state.subPhase || null,
            state.reasonCode || "render_error",
            state.errorMessage || "Failed to render blocks on the page."
          )
        );
        sendResponse({ ok: true, state: saved_state });
        return;
      }

      let saved_state = await update_tab_state(tab_id, state);
      sendResponse({ ok: true, state: saved_state });
      return;
    }

    if (request.contentScriptQuery === "open_popup") {
      if (popupPorts.size > 0) {
        for (let port of popupPorts) {
          try {
            port.postMessage({ type: "close_popup" });
          } catch (_port_error) {
            // Ignore disconnected popup ports; onDisconnect will clean them up.
          }
        }
        sendResponse({ ok: true, toggled: "closed" });
        return;
      }
      if (Date.now() - lastPopupClosedAt < POPUP_TOGGLE_GUARD_MS) {
        // The page click closed popup first; prevent immediate reopen.
        sendResponse({ ok: true, toggled: "closed_recently" });
        return;
      }
      try {
        await chrome.action.openPopup();
        sendResponse({ ok: true, toggled: "opened" });
        return;
      } catch (_open_error) {
        try {
          await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html"), active: true });
          sendResponse({ ok: true, fallback: "tab" });
          return;
        } catch (fallback_error) {
          sendResponse({ ok: false, error: to_error_message(fallback_error) });
          return;
        }
      }
    }

    if (request.contentScriptQuery === "get_icon_data_url") {
      try {
        let data_url = await get_icon_data_url();
        sendResponse({ ok: true, dataUrl: data_url });
      } catch (error) {
        sendResponse({ ok: false, error: to_error_message(error) });
      }
      return;
    }

    if (request.popupQuery === "get_tab_state") {
      let tab_id = request.tabId;
      if (typeof tab_id !== "number") {
        sendResponse({ ok: true, state: create_default_state() });
        return;
      }
      let state = await get_or_create_tab_state(tab_id, request.tabUrl || "");
      sendResponse({ ok: true, state: state });
      return;
    }

    if (request.popupQuery === "set_min_lines_count") {
      let min_lines_count = await set_min_lines_count_setting(request.value);
      if (typeof request.tabId === "number" && tabState.has(request.tabId)) {
        await update_tab_state(request.tabId, { minLinesCount: min_lines_count });
      }
      sendResponse({ ok: true, minLinesCount: min_lines_count });
      return;
    }

    if (request.popupQuery === "set_detection_enabled") {
      let detection_enabled = await set_detection_enabled_setting(request.detectionEnabled);
      let [custom_server_enabled, custom_server_base_url] = await Promise.all([
        get_custom_server_enabled_setting(),
        get_custom_server_base_url_setting(),
      ]);
      if (typeof request.tabId === "number" && tabState.has(request.tabId)) {
        let is_supported_page = false;
        try {
          let tab = await chrome.tabs.get(request.tabId);
          is_supported_page = is_supported_github_diff_page(tab && tab.url ? tab.url : "");
        } catch (_ignored_error) {
          is_supported_page = false;
        }
        await update_tab_state(request.tabId, {
          phase: is_supported_page ? (detection_enabled ? "idle" : "precheck") : "precheck",
          subPhase: null,
          status: !is_supported_page ? "not_supported_page" : detection_enabled ? "idle" : "disabled_by_settings",
          blockCount: 0,
          reasonCode: null,
          errorMessage: null,
          diffUrl: null,
          detectionEnabled: detection_enabled,
          customServerEnabled: custom_server_enabled,
          customServerBaseUrl: custom_server_base_url,
        });
      }
      sendResponse({
        ok: true,
        detectionEnabled: detection_enabled,
        customServerEnabled: custom_server_enabled,
        customServerBaseUrl: custom_server_base_url,
      });
      return;
    }

    if (request.popupQuery === "set_settings") {
      let min_lines_count = await set_min_lines_count_setting(request.minLinesCount);
      let expand_all_large_diffs = await set_expand_all_large_diffs_setting(request.expandAllLargeDiffs);
      let detection_enabled =
        typeof request.detectionEnabled === "boolean"
          ? await set_detection_enabled_setting(request.detectionEnabled)
          : await get_detection_enabled_setting();
      let custom_server_enabled =
        typeof request.customServerEnabled === "boolean"
          ? await set_custom_server_enabled_setting(request.customServerEnabled)
          : await get_custom_server_enabled_setting();
      let custom_server_base_url =
        typeof request.customServerBaseUrl === "string"
          ? await set_custom_server_base_url_setting(request.customServerBaseUrl)
          : await get_custom_server_base_url_setting();
      if (typeof request.tabId === "number" && tabState.has(request.tabId)) {
        let current_state = tabState.get(request.tabId) || create_default_state();
        let patch = {
          minLinesCount: min_lines_count,
          expandAllLargeDiffs: expand_all_large_diffs,
          detectionEnabled: detection_enabled,
          customServerEnabled: custom_server_enabled,
          customServerBaseUrl: custom_server_base_url,
        };
        if (!detection_enabled) {
          patch = {
            ...patch,
            phase: "precheck",
            subPhase: null,
            status: "disabled_by_settings",
            blockCount: 0,
            reasonCode: null,
            errorMessage: null,
            diffUrl: null,
          };
        } else if (current_state.status === "disabled_by_settings") {
          patch = {
            ...patch,
            phase: "idle",
            subPhase: null,
            status: "idle",
            blockCount: 0,
            reasonCode: null,
            errorMessage: null,
            diffUrl: null,
          };
        }
        await update_tab_state(request.tabId, patch);
      }
      sendResponse({
        ok: true,
        minLinesCount: min_lines_count,
        expandAllLargeDiffs: expand_all_large_diffs,
        detectionEnabled: detection_enabled,
        customServerEnabled: custom_server_enabled,
        customServerBaseUrl: custom_server_base_url,
      });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type." });
  })().catch((error) => {
    sendResponse({ ok: false, error: to_error_message(error) });
  });
  return true;
});
