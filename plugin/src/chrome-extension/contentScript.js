(() => {
if (globalThis.__reviewRaccoonContentScriptLoaded) {
    return;
}
globalThis.__reviewRaccoonContentScriptLoaded = true;

const REMOVED = "removed";
const ADDED = "added";
const DETECTION_ENABLED_STORAGE_KEY = "detect-moved-blocks__enabled";
const DEFAULT_DETECTION_ENABLED = true;
const EXPAND_ALL_LARGE_DIFFS_STORAGE_KEY = "detect-moved-blocks__expand-all-large-diffs";
const DEFAULT_EXPAND_ALL_LARGE_DIFFS = true;
const ALL_COLORS = ['#058DC7', '#50B432', '#ED561B', '#DDDF00', '#24CBE5', '#64E572', '#FF9655', '#FFF263', '#6AF9C4',
    'red', 'orange', 'green', 'blue', 'purple', 'brown'];

// Cache for file containers in new view to avoid repeated DOM queries
let filepath_to_container_new = {};

function is_new_view() {
    return document.querySelector('[class*="DiffComparisonViewer-module__FileContainer"]') !== null ||
        document.querySelector('button[class*="ReviewMenuButton-module__ReviewMenuButton"]') !== null;
}

let filepath_to_anchor = {};

let timer = null;
let url_watch_timer = null;
let detection_started = false;
let auto_detection_done = false;
function get_navigation_identity_url(raw_url) {
    // Treat hash-only navigation (e.g. #diff-...) as the same diff page.
    try {
        let parsed = new URL(raw_url, window.location.origin);
        return `${parsed.origin}${parsed.pathname}${parsed.search}`;
    } catch (_error) {
        return String(raw_url || "").split("#")[0];
    }
}
let last_seen_url = get_navigation_identity_url(window.location.href);
let last_known_page_supported = null;

const DETECT_MOVES_INTERVAL_MS = 3000;
const URL_POLL_INTERVAL_MS = 500;
const NAVIGATION_EVENT_NAME = "reviewraccoon:navigation";
const DIFF_SETTLE_POLL_INTERVAL_MS = 100;
const DIFF_SETTLE_QUIET_PERIOD_MS = 600;
const DIFF_SETTLE_TIMEOUT_MS = 20000;
const EXTENSION_CONTEXT_INVALIDATED_FRAGMENT = "Extension context invalidated";

function is_extension_context_invalidated_error(error) {
    if (!error) {
        return false;
    }
    let message = typeof error === "string" ? error : (error.message || String(error));
    return message.includes(EXTENSION_CONTEXT_INVALIDATED_FRAGMENT);
}

function stop_detection_timers() {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }
    if (url_watch_timer !== null) {
        clearInterval(url_watch_timer);
        url_watch_timer = null;
    }
}

function insertAfter(newNode, referenceNode) {
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

function get_anchor_for_filepath(filepath) {
    if (filepath in filepath_to_anchor) {
        return filepath_to_anchor[filepath]
    }

    if (is_new_view()) {
        return null; // Anchor logic not used in new view
    }

    let file_header = document.querySelector(`.file-header[data-path="${filepath}"`)
    if (file_header === null) {
        console.log(`Could not find file-header for path: ${filepath}`)
        return null
    } else {
        let anchor = file_header.getAttribute('data-anchor')
        filepath_to_anchor[filepath] = anchor
        return anchor

    }
}

function get_file_container_new_view(filepath) {
    if (filepath in filepath_to_container_new) {
        if (document.body.contains(filepath_to_container_new[filepath])) {
            return filepath_to_container_new[filepath];
        }
    }

    // New view doesn't have data-path on container usually, so we might need to find the header with the filename
    // and find the parent container.
    // Headers often have the filename in a heading or similar.
    // Based on inspection, headers are .DiffFileHeader-module__header--xG9S8
    // We can look for the filename in the header text or title attribute.

    // Strategy: Find all file headers, check their text for filepath.
    const headers = document.querySelectorAll('[class*="DiffFileHeader"]');
    for (let header of headers) {
        if (header.textContent.includes(filepath) || (header.getAttribute('data-path') === filepath)) { // Fallback if data-path exists
            let container = header.parentElement;
            // Traverse up to find the main container (DiffComparisonViewer...)
            while (container && !container.className.includes('DiffComparisonViewer-module__FileContainer')) {
                container = container.parentElement;
            }
            if (container) {
                filepath_to_container_new[filepath] = container;
                return container;
            }
        }
    }

    // Alternative: Try to find by specific file-info classes if textContent is too broad
    // But textContent usually contains the filename "path/to/file.ext"
    return null;
}

function get_line_node_new_view(line, is_removed) {
    let container = get_file_container_new_view(line.file);
    if (!container) return null;

    // Find all rows in this container
    let rows = container.querySelectorAll('.diff-line-row');

    // We need to find the cell with the correct line number
    // "L" means removed (left side usually), "R" means added (right side usually)
    // In DOM:
    // Removed lines have specific class or their number cell has specific attributes?
    // Let's rely on data-line-number if present, or cell position/class.

    // Typically:
    // Left number cell: .diff-line-number (and maybe specific col index)
    // Right number cell: .diff-line-number

    // A robust way is to look for the number cell with the matching number.
    // If split view:
    //  Left side number: 1st number cell in row?
    //  Right side number: 2nd number cell in row?

    // Let's iterate rows and check cells.
    for (let row of rows) {
        // Get number cells
        let num_cells = row.querySelectorAll('.diff-line-number');

        // Split view logic assumption:
        // If is_removed (Left):
        //   Check 1st number cell.
        // If !is_removed (Right):
        //   Check 2nd number cell (if exists) or 1st if it's an added-only row?

        // Better: Check content of number cells.
        // Usually there are 2 number cells in split view.

        // Let's refine based on "is_removed".
        // remove_line -> "original" line number
        // added_line -> "new" line number

        // In the new view, data-line-number-original and data-line-number-new might exist?
        // Inspection didn't show them explicitly in my summary, but they often exist.
        // If not, we use textContent.

        for (let cell of num_cells) {
            let num = parseInt(cell.textContent.trim());
            if (isNaN(num)) continue;

            if (num === line.line_no) {
                // Check if this cell represents left or right.
                // In split view, left is usually first child or earlier sibling?
                // Or we can check the corresponding code cell.

                // Let's look for the code cell that corresponds to this number cell.
                // In new view table structure, it's often:
                // Num(L) | Code(L) | Num(R) | Code(R)

                let rowChildren = row.children;
                let cellIndex = Array.from(rowChildren).indexOf(cell);
                let next = cell.nextElementSibling;

                // Simple Heuristic:
                if (rowChildren.length >= 4) {
                    // Split view
                    if (is_removed) {
                        // We want the 'original' side. Index 0 is typically NumL.
                        if (cellIndex === 0 && next) return next;
                    } else {
                        // We want the 'new' side. Index 2 is typically NumR.
                        if (cellIndex === 2 && next) return next;
                    }
                } else {
                    // Unified or other view
                    // If unified: NumL, NumR, Code
                    if (rowChildren.length === 3) {
                        if (is_removed && cellIndex === 0) return rowChildren[2];
                        if (!is_removed && cellIndex === 1) return rowChildren[2];
                    } else {
                        // Fallback
                        if (next && (next.classList.contains('diff-text-cell') || next.classList.contains('blob-code-inner'))) {
                            return next;
                        }
                    }
                }
            }
        }
    }
    return null;
}

function get_line_node(line, is_removed) {
    if (is_new_view()) {
        return get_line_node_new_view(line, is_removed);
    }
    let anchor = get_anchor_for_filepath(line.file)
    if (anchor === null) {
        return null
    }
    let node_id = anchor + (is_removed ? 'L' : 'R') + line.line_no;
    let node = document.getElementById(node_id);
    if (!node) return null;
    node = node.nextElementSibling;  // nextElementSibling because id points to td with line number
    if (node.classList.contains('empty-cell')) {
        // in unified view (unified == non-split) there is extra column between line number and line content -> skip it
        node = node.nextElementSibling;
    }
    return node
}

function clear_previous_detection_markers() {
    let markers = document.querySelectorAll(".detectedMovedBlock");
    for (const marker of markers) {
        marker.remove();
    }

    let content_nodes = document.querySelectorAll("[data-rr-original-html]");
    for (const content_node of content_nodes) {
        let original_html = content_node.getAttribute("data-rr-original-html");
        if (original_html !== null) {
            content_node.innerHTML = original_html;
        }
        content_node.removeAttribute("data-rr-original-html");
    }

    let bordered_nodes = document.querySelectorAll("[data-rr-original-border-top], [data-rr-original-border-bottom]");
    for (const bordered_node of bordered_nodes) {
        let original_top = bordered_node.getAttribute("data-rr-original-border-top");
        let original_bottom = bordered_node.getAttribute("data-rr-original-border-bottom");
        if (original_top !== null) {
            bordered_node.style.borderTop = original_top;
            bordered_node.removeAttribute("data-rr-original-border-top");
        }
        if (original_bottom !== null) {
            bordered_node.style.borderBottom = original_bottom;
            bordered_node.removeAttribute("data-rr-original-border-bottom");
        }
    }
}

function markLine(line, line_in_block_index, detected_block_index, is_removed, is_first_line, is_last_line, replace_html_content, alt_msg) {
    let line_node = get_line_node(line, is_removed);
    if (!line_node) {
        return false;
    }
    let id_prefix = `detected-block-${detected_block_index}-${line_in_block_index}`;
    let data_type = is_removed ? REMOVED : ADDED;
    let oposite_data_type = is_removed ? ADDED : REMOVED;
    let block_color = ALL_COLORS[detected_block_index % ALL_COLORS.length];

    let line_content_elem = line_node.querySelector('.blob-code-inner.blob-code-marker');
    // Fallback for new view
    if (!line_content_elem && is_new_view()) {
        line_content_elem = line_node.querySelector('.diff-text-inner') || line_node;
        // In new view, sometimes the cell IS the container if no inner div? 
        // But usually there is a div or span inside.
        // Let's create one if needed or just use the cell.
        // If we use the cell, we must be careful not to overwrite the marker if we prepend it again.
    }

    if (!line_content_elem) {
        return false;
    }
    if (!line_content_elem.hasAttribute("data-rr-original-html")) {
        line_content_elem.setAttribute("data-rr-original-html", line_content_elem.innerHTML);
    }
    line_content_elem.innerHTML = replace_html_content;

    const block_marker = document.createElement('a');
    block_marker.innerHTML = ' ';
    block_marker.id = `${id_prefix}-${data_type}`;
    block_marker.className = "detectedMovedBlock";
    block_marker.style.backgroundColor = block_color;
    block_marker.title = alt_msg;
    block_marker.onclick = function () { document.querySelector(`#${id_prefix}-${oposite_data_type}`).scrollIntoView(true); window.scrollBy(0, -103) };
    line_node.prepend(block_marker);

    if (is_first_line) {
        if (!line_node.hasAttribute("data-rr-original-border-top")) {
            line_node.setAttribute("data-rr-original-border-top", line_node.style.borderTop || "");
        }
        line_node.style.borderTop = `solid 1px ${block_color}`;
    }
    if (is_last_line) {
        if (!line_node.hasAttribute("data-rr-original-border-bottom")) {
            line_node.setAttribute("data-rr-original-border-bottom", line_node.style.borderBottom || "");
        }
        line_node.style.borderBottom = `solid 1px ${block_color}`;
    }
    return true;
}

function escape_html_markup(text) {
    return text.replace("<", "&lt;")
}


function get_diff_part_as_html(diff_op, text, diff_op_to_skip) {
    if (diff_op === diff_op_to_skip) {
        return '';
    }
    if (diff_op === 1 || diff_op === -1) {
        return `<span class='x'>${escape_html_markup(text)}</span>`;
    }
    return escape_html_markup(text);
}

function highlightDetectedBlock(block_index, detected_block) {
    let marked_lines_count = 0;
    let block_match_weight = 0;
    for (const iter of detected_block.lines.entries()) {
        let [line_in_block_index, matching_lines] = iter;
        block_match_weight += matching_lines.match_probability;
    }
    for (const iter of detected_block.lines.entries()) {
        let [line_in_block_index, matching_lines] = iter;
        let removed_line = matching_lines.removed_line;
        let added_line = matching_lines.added_line;
        let match_probability = matching_lines.match_probability;
        let dmp = new diff_match_patch();
        let added_text = added_line ? added_line.leading_whitespaces + added_line.trim_text : '';
        let removed_text = removed_line ? removed_line.leading_whitespaces + removed_line.trim_text : '';
        let diff = dmp.diff_main(removed_text, added_text);
        dmp.diff_cleanupSemantic(diff);
        let removed_line_html = '';
        let added_line_html = '';
        for (let i = 0; i < diff.length; i++) {
            let diff_part = diff[i];
            let [op, text] = diff_part;
            removed_line_html += get_diff_part_as_html(op, text, 1);
            added_line_html += get_diff_part_as_html(op, text, -1)
        }
        let is_first_line = line_in_block_index === 0;
        let is_last_line = line_in_block_index === detected_block.lines.length - 1;
        let average_match = detected_block.lines.length > 0
            ? (block_match_weight / detected_block.lines.length) * 100
            : 0;
        let alt_msg = `Moved block ${block_index + 1}. Approximate similarity ${average_match.toFixed(0)}%. Click marker to jump to matching location.`;
        if (removed_line) {
            if (markLine(removed_line, line_in_block_index, block_index, true, is_first_line, is_last_line, removed_line_html, alt_msg)) {
                marked_lines_count += 1;
            }
        }
        if (added_line) {
            if (markLine(added_line, line_in_block_index, block_index, false, is_first_line, is_last_line, added_line_html, alt_msg)) {
                marked_lines_count += 1;
            }
        }
    }
    return marked_lines_count;
}

function htmlToElement(html) {
    let template = document.createElement('template');
    html = html.trim(); // Never return a text node of whitespace as the result
    template.innerHTML = html;
    return template.content.firstChild;
}

function detect_moved_block_button_exists() {
    let existing_button = document.querySelector("#detect_moved_blocks");
    return existing_button !== null;
}

function remove_detect_moved_blocks_button() {
    let button = document.querySelector("#detect_moved_blocks");
    if (!button) {
        return;
    }
    let container = button.closest(".diffbar-item");
    if (container) {
        container.remove();
        return;
    }
    button.remove();
}

function get_min_lines_count_or_default() {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['detect-moved-blocks__min-lines-count'], (result) => {
                if (chrome.runtime.lastError) {
                    resolve(2);
                    return;
                }
                let min_lines_count = parseFloat(result['detect-moved-blocks__min-lines-count']);
                if (Number.isNaN(min_lines_count)) {
                    min_lines_count = 2;
                } else if (min_lines_count < 0) {
                    min_lines_count = 0;
                }
                resolve(min_lines_count);
            });
        } catch (_error) {
            resolve(2);
        }
    });
}

function get_detection_enabled_or_default() {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get([DETECTION_ENABLED_STORAGE_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    resolve(DEFAULT_DETECTION_ENABLED);
                    return;
                }
                let detection_enabled = result[DETECTION_ENABLED_STORAGE_KEY];
                if (typeof detection_enabled === "boolean") {
                    resolve(detection_enabled);
                    return;
                }
                resolve(DEFAULT_DETECTION_ENABLED);
            });
        } catch (_error) {
            resolve(DEFAULT_DETECTION_ENABLED);
        }
    });
}

function get_expand_all_large_diffs_or_default() {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get([EXPAND_ALL_LARGE_DIFFS_STORAGE_KEY], (result) => {
                if (chrome.runtime.lastError) {
                    resolve(DEFAULT_EXPAND_ALL_LARGE_DIFFS);
                    return;
                }
                let expand_all_large_diffs = result[EXPAND_ALL_LARGE_DIFFS_STORAGE_KEY];
                if (typeof expand_all_large_diffs === "boolean") {
                    resolve(expand_all_large_diffs);
                    return;
                }
                resolve(DEFAULT_EXPAND_ALL_LARGE_DIFFS);
            });
        } catch (_error) {
            resolve(DEFAULT_EXPAND_ALL_LARGE_DIFFS);
        }
    });
}

function update_background_state(state) {
    try {
        chrome.runtime.sendMessage(
            {
                contentScriptQuery: "update_tab_state",
                state: state,
            },
            () => {
                // Ignore disconnected background errors during navigation/unload.
                void chrome.runtime.lastError;
            }
        );
    } catch (error) {
        if (is_extension_context_invalidated_error(error)) {
            stop_detection_timers();
        }
    }
}

function get_detect_button_refs() {
    return {
        button: document.querySelector("#detect_moved_blocks"),
        badge: document.querySelector("#detected_moves_counter"),
    };
}

function set_detect_button_state(state, payload = {}) {
    let refs = get_detect_button_refs();
    if (!refs.button) {
        return;
    }

    let count = Number.isFinite(payload.count) ? payload.count : 0;
    if (refs.badge) {
        refs.badge.className = "rr-detect-badge";
        if (state === "running") {
            refs.badge.innerText = "…";
            refs.badge.classList.add("rr-detect-badge-running");
            refs.badge.style.display = "inline-flex";
        } else if (state === "paused") {
            refs.badge.innerText = "⏸";
            refs.badge.classList.add("rr-detect-badge-paused");
            refs.badge.style.display = "inline-flex";
        } else if (state === "error") {
            refs.badge.innerText = "!";
            refs.badge.classList.add("rr-detect-badge-error");
            refs.badge.style.display = "inline-flex";
        } else if (state === "success" || state === "no_results") {
            refs.badge.innerText = String(count);
            refs.badge.classList.add("rr-detect-badge-success");
            refs.badge.style.display = "inline-flex";
        } else {
            refs.badge.style.display = "none";
        }
    }
}

function open_extension_popup() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(
                {
                    contentScriptQuery: "open_popup",
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(response || { ok: false, error: "No response from background." });
                }
            );
        } catch (error) {
            if (is_extension_context_invalidated_error(error)) {
                stop_detection_timers();
            }
            resolve({ ok: false, error: error && error.message ? error.message : String(error) });
        }
    });
}

function request_icon_data_url() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(
                {
                    contentScriptQuery: "get_icon_data_url",
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        resolve(null);
                        return;
                    }
                    if (!response || !response.ok || !response.dataUrl) {
                        resolve(null);
                        return;
                    }
                    resolve(response.dataUrl);
                }
            );
        } catch (error) {
            if (is_extension_context_invalidated_error(error)) {
                stop_detection_timers();
            }
            resolve(null);
        }
    });
}

function get_user_name() {
    let user_img_node = document.querySelector("header > div.Header-item > details > summary > img");
    if (user_img_node) {
        return user_img_node.alt;
    }
    return null;
}

function request_detected_blocks(page_url, user_name, min_lines_count) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(
                {
                    contentScriptQuery: "diff_text",
                    pull_request_url: page_url,
                    user_name: user_name,
                    min_lines_count: min_lines_count,
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({
                            ok: false,
                            error: {
                                phase: "precheck",
                                reasonCode: "runtime_message_error",
                                errorMessage: chrome.runtime.lastError.message,
                            },
                        });
                        return;
                    }
                    resolve(response || { ok: false, error: { errorMessage: "No response from background." } });
                }
            );
        } catch (error) {
            if (is_extension_context_invalidated_error(error)) {
                stop_detection_timers();
            }
            resolve({
                ok: false,
                error: {
                    phase: "precheck",
                    reasonCode: "runtime_message_error",
                    errorMessage: error && error.message ? error.message : String(error),
                },
            });
        }
    });
}

async function add_detect_moved_blocks_button() {
        if (detect_moved_block_button_exists()) {
            return true;
        }
        let button_container = null;

        if (is_new_view()) {
            // Inject into the new toolbar
            // Look for the "Review changes" / "Submit review" button container
            // Try class first
            let reviewButton = document.querySelector('button[class*="ReviewMenuButton-module__ReviewMenuButton"]');
            // Fallback based on text if class approach fails
            if (!reviewButton) {
                let buttons = document.querySelectorAll('button');
                for (let btn of buttons) {
                    if (btn.textContent.includes('Submit review') || btn.textContent.includes('Review changes')) {
                        reviewButton = btn;
                        break;
                    }
                }
            }

            if (reviewButton) {
                // Traverse up to find some container
                // Usually it's in a div > div setup.
                // Let's just wrap it in the direct parent if "Stack" is not strictly required
                button_container = reviewButton.parentElement;

                // Try to find the stack if possible for better alignment
                let stack = reviewButton.closest('div[class*="Stack"]');
                if (stack) {
                    button_container = stack;
                }
            }
        } else {
            button_container = document.querySelector(".pr-review-tools");
        }

        if (button_container === null) {
            return  // TODO this is workaround - you should add proper box for this button!
        }
        let container = document.createElement("div");
        container.className = "diffbar-item details-reset position-relative text-center";
        if (is_new_view()) {
            container.style.marginRight = "8px";
            container.style.display = "flex";
            container.style.alignItems = "center";
        }

        let button = document.createElement("button");
        button.className = "rr-detect-button mr-3";
        button.id = "detect_moved_blocks";
        button.type = "button";
        button.title = "Open ReviewRaccoon";
        button.setAttribute("aria-label", "Open ReviewRaccoon popup");
        button.innerHTML = `
            <img class="rr-detect-icon" alt="" style="display:none;" />
            <span class="rr-detect-icon-fallback" aria-hidden="true">🦝</span>
            <span id="detected_moves_counter" class="rr-detect-badge" style="display: none;">0</span>
        `;
        let icon_img = button.querySelector(".rr-detect-icon");
        let icon_fallback = button.querySelector(".rr-detect-icon-fallback");
        if (icon_img && icon_fallback) {
            icon_img.addEventListener("error", () => {
                icon_img.style.display = "none";
                icon_fallback.style.display = "inline-flex";
            });
            icon_img.addEventListener("load", () => {
                icon_fallback.style.display = "none";
            });
            request_icon_data_url().then((icon_data_url) => {
                if (!icon_data_url) {
                    icon_img.style.display = "none";
                    icon_fallback.style.display = "inline-flex";
                    return;
                }
                icon_img.src = icon_data_url;
                icon_img.style.display = "block";
            });
        }
        button.addEventListener("click", async () => {
            let response = await open_extension_popup();
            if (!response || !response.ok) {
                set_detect_button_state("error");
            }
        });
        container.appendChild(button);

        // Keep ReviewRaccoon as the first right-side control.
        button_container.insertBefore(container, button_container.firstElementChild || null);
        set_detect_button_state("idle", {});
        return true;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    function get_pending_diff_loader_count() {
        return document.querySelectorAll("div.js-diff-progressive-container include-fragment.diff-progressive-loader, include-fragment.diff-progressive-loader").length;
    }

    async function wait_for_diff_content_to_settle(timeout_ms = DIFF_SETTLE_TIMEOUT_MS) {
        let started_at = Date.now();
        let stable_for_ms = 0;
        let last_snapshot = null;
        while (Date.now() - started_at < timeout_ms) {
            let pending_loader_count = get_pending_diff_loader_count();
            let load_button_count = document.querySelectorAll(".load-diff-button").length;
            let snapshot = `${pending_loader_count}:${load_button_count}`;
            if (snapshot === last_snapshot) {
                stable_for_ms += DIFF_SETTLE_POLL_INTERVAL_MS;
            } else {
                stable_for_ms = 0;
                last_snapshot = snapshot;
            }
            if (pending_loader_count === 0 && stable_for_ms >= DIFF_SETTLE_QUIET_PERIOD_MS) {
                return true;
            }
            await sleep(DIFF_SETTLE_POLL_INTERVAL_MS);
        }
        console.log(`Timed out waiting for diff content to settle after ${timeout_ms}ms.`);
        return false;
    }

    async function wait_for_page_load() {
        await wait_for_diff_content_to_settle();
    }

    function css_escape(value) {
        if (window.CSS && typeof window.CSS.escape === "function") {
            return window.CSS.escape(value);
        }
        return String(value).replace(/["\\]/g, "\\$&");
    }

    function get_filepaths_with_detected_blocks(detected_blocks) {
        let filepaths = new Set();
        for (const detected_block of detected_blocks || []) {
            let lines = Array.isArray(detected_block.lines) ? detected_block.lines : [];
            for (const matching_lines of lines) {
                if (matching_lines && matching_lines.removed_line && matching_lines.removed_line.file) {
                    filepaths.add(matching_lines.removed_line.file);
                }
                if (matching_lines && matching_lines.added_line && matching_lines.added_line.file) {
                    filepaths.add(matching_lines.added_line.file);
                }
            }
        }
        return filepaths;
    }

    function get_targeted_load_diff_buttons(filepaths_with_blocks) {
        let buttons = new Set();
        for (const filepath of filepaths_with_blocks) {
            let escaped_filepath = css_escape(filepath);
            let old_view_buttons = document.querySelectorAll(
                `.file-header[data-path="${escaped_filepath}"] .load-diff-button, .file[data-path="${escaped_filepath}"] .load-diff-button`
            );
            for (const button of old_view_buttons) {
                buttons.add(button);
            }
            let new_view_container = get_file_container_new_view(filepath);
            if (new_view_container) {
                let new_view_buttons = new_view_container.querySelectorAll(".load-diff-button");
                for (const button of new_view_buttons) {
                    buttons.add(button);
                }
            }
        }
        return Array.from(buttons);
    }

    async function expand_large_diffs(detected_blocks, expand_all_large_diffs) {
        let load_diff_buttons = [];
        if (expand_all_large_diffs) {
            load_diff_buttons = Array.from(document.querySelectorAll(".load-diff-button"));
        } else {
            let filepaths_with_blocks = get_filepaths_with_detected_blocks(detected_blocks);
            if (filepaths_with_blocks.size === 0) {
                console.log("Skipping large-diff expansion: no moved blocks detected.");
                return 0;
            }
            load_diff_buttons = get_targeted_load_diff_buttons(filepaths_with_blocks);
        }
        for (const load_diff_button of load_diff_buttons) {
            load_diff_button.click();
        }
        if (load_diff_buttons.length > 0) {
            console.log(`Triggered expansion for ${load_diff_buttons.length} large diffs`);
            await wait_for_diff_content_to_settle();
        }
        return load_diff_buttons.length;
    }

    function is_proper_page() {
        let pathname = window.location.pathname;
        return /\/pull\/\d+\/files(?:\/.*)?$|\/pull\/\d+\/commits?\/[A-Za-z0-9]+(?:\/.*)?$|\/commits?\/[A-Za-z0-9]+(?:\/.*)?$/.test(pathname);
    }

    function reset_detection_context_for_navigation() {
        clear_previous_detection_markers();
        filepath_to_anchor = {};
        filepath_to_container_new = {};
        detection_started = false;
        auto_detection_done = false;
    }

    function sync_background_supported_state() {
        let supported = is_proper_page();
        if (last_known_page_supported === supported) {
            return;
        }
        last_known_page_supported = supported;
        if (!supported) {
            remove_detect_moved_blocks_button();
            update_background_state({
                phase: "precheck",
                subPhase: null,
                status: "not_supported_page",
                reasonCode: null,
                errorMessage: null,
                blockCount: 0,
            });
            return;
        }
    }

    function emit_navigation_event() {
        window.dispatchEvent(new Event(NAVIGATION_EVENT_NAME));
    }

    function handle_possible_url_change() {
        let current_url = get_navigation_identity_url(window.location.href);
        if (current_url === last_seen_url) {
            return;
        }
        last_seen_url = current_url;
        reset_detection_context_for_navigation();
        sync_background_supported_state();
        detect_moves();
    }

    function install_navigation_watchers() {
        // GitHub uses Turbo/PJAX navigation (history + partial DOM updates), so
        // we watch history events and keep a short polling fallback.
        let original_push_state = history.pushState;
        let original_replace_state = history.replaceState;
        history.pushState = function (...args) {
            let result = original_push_state.apply(this, args);
            emit_navigation_event();
            return result;
        };
        history.replaceState = function (...args) {
            let result = original_replace_state.apply(this, args);
            emit_navigation_event();
            return result;
        };
        window.addEventListener("popstate", emit_navigation_event);
        window.addEventListener("hashchange", emit_navigation_event);
        window.addEventListener("pjax:end", emit_navigation_event);
        document.addEventListener("turbo:render", emit_navigation_event);
        document.addEventListener("turbo:load", emit_navigation_event);
        window.addEventListener(NAVIGATION_EVENT_NAME, handle_possible_url_change);
        if (url_watch_timer === null) {
            url_watch_timer = setInterval(handle_possible_url_change, URL_POLL_INTERVAL_MS);
        }
    }

    function highlights_changes(detected_blocks) {
        console.log(`Received ${detected_blocks.length} detected blocks`);
        let marked_lines_count = 0;
        for (const iter of detected_blocks.entries()) {
            let [block_index, detected_block] = iter;
            marked_lines_count += highlightDetectedBlock(block_index, detected_block);
        }
        return marked_lines_count;
    }

    async function run_detection() {
        if (detection_started) {
            return
        }
        if (!is_proper_page()) {
            set_detect_button_state("idle");
            update_background_state({
                phase: "precheck",
                status: "not_supported_page",
                reasonCode: null,
                errorMessage: null,
                blockCount: 0,
            });
            return
        }
        let added = await add_detect_moved_blocks_button();
        if (!added) {
            return;
        }
        let detection_enabled = await get_detection_enabled_or_default();
        if (!detection_enabled) {
            clear_previous_detection_markers();
            update_background_state({
                phase: "precheck",
                status: "disabled_by_settings",
                reasonCode: null,
                errorMessage: null,
                blockCount: 0,
            });
            set_detect_button_state("paused");
            return;
        }
        detection_started = true;
        try {
            set_detect_button_state("running");
            await wait_for_page_load();
            let min_lines_count = await get_min_lines_count_or_default();
            console.log(`Starting detection: min_lines_count=${min_lines_count}`);
            if (min_lines_count >= 0) {
                let page_url = window.location.href;
                let user_name = get_user_name();
                let response = await request_detected_blocks(page_url, user_name, min_lines_count);
                if (!response || !response.ok) {
                    let reason_code = response && response.error ? response.error.reasonCode : null;
                    if (reason_code === "disabled_by_settings" || reason_code === "detection_paused") {
                        set_detect_button_state("paused");
                    } else {
                        set_detect_button_state("error");
                    }
                    return;
                }
                let detection_still_enabled = await get_detection_enabled_or_default();
                if (!detection_still_enabled) {
                    clear_previous_detection_markers();
                    update_background_state({
                        phase: "precheck",
                        status: "disabled_by_settings",
                        reasonCode: null,
                        errorMessage: null,
                        blockCount: 0,
                    });
                    set_detect_button_state("paused");
                    return;
                }
                try {
                    let detected_blocks = response.detectedBlocks || [];
                    let expand_all_large_diffs = await get_expand_all_large_diffs_or_default();
                    await expand_large_diffs(detected_blocks, expand_all_large_diffs);
                    clear_previous_detection_markers();
                    let marked_lines_count = highlights_changes(detected_blocks);
                    if (detected_blocks.length > 0 && marked_lines_count === 0) {
                        update_background_state({
                            phase: "render",
                            subPhase: "render_dom_lookup",
                            status: "error",
                            reasonCode: "render_dom_lookup_failed",
                            errorMessage: "Could not locate matching diff lines in GitHub DOM.",
                        });
                        set_detect_button_state("error");
                        return;
                    }
                    update_background_state({
                        phase: "render",
                        status: "success",
                        blockCount: detected_blocks.length,
                    });
                    if (detected_blocks.length === 0) {
                        set_detect_button_state("no_results", { count: 0 });
                    } else {
                        set_detect_button_state("success", { count: detected_blocks.length });
                    }
                } catch (error) {
                    update_background_state({
                        phase: "render",
                        subPhase: "render_apply",
                        status: "error",
                        reasonCode: "render_apply_error",
                        errorMessage: error && error.message ? error.message : String(error),
                    });
                    set_detect_button_state("error");
                }
            } else {
                console.log("min_lines_count is smaller than 0 - detection disabled.");
                update_background_state({
                    phase: "precheck",
                    status: "disabled_by_settings",
                    reasonCode: null,
                    errorMessage: null,
                    blockCount: 0,
                });
                set_detect_button_state("paused");
            }
        } finally {
            detection_started = false;
        }
    }

    async function detect_moves() {
        try {
            sync_background_supported_state();
            if (!is_proper_page()) {
                return;
            }
            let added = await add_detect_moved_blocks_button();
            if (!added) {
                return;
            }
            let detection_enabled = await get_detection_enabled_or_default();
            if (!detection_enabled) {
                auto_detection_done = false;
                clear_previous_detection_markers();
                update_background_state({
                    phase: "precheck",
                    status: "disabled_by_settings",
                    reasonCode: null,
                    errorMessage: null,
                    blockCount: 0,
                });
                set_detect_button_state("paused");
                return;
            }
            if (!auto_detection_done) {
                auto_detection_done = true;
                run_detection();
            }
        } catch (error) {
            if (is_extension_context_invalidated_error(error)) {
                stop_detection_timers();
                return;
            }
            console.error("detect_moves failed", error);
        }
    }

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (request.popupCommand === "run_detection_now") {
            run_detection()
                .then(() => sendResponse({ ok: true }))
                .catch((error) => sendResponse({
                    ok: false,
                    error: error && error.message ? error.message : String(error),
                }));
            return true;
        }
        return false;
    });

    async function main() {
        install_navigation_watchers();
        sync_background_supported_state();
        timer = setInterval(detect_moves, DETECT_MOVES_INTERVAL_MS);
        detect_moves();
    }

    main();
})();
