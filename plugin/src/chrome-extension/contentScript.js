(() => {
if (globalThis.__reviewRaccoonContentScriptLoaded) {
    return;
}
globalThis.__reviewRaccoonContentScriptLoaded = true;

const REMOVED = "removed";
const ADDED = "added";
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
let detection_started = false;
let auto_detection_done = false;

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
        line_node.style.borderTop = `solid 1px ${block_color}`;
    }
    if (is_last_line) {
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

function get_min_lines_count_or_default() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['detect-moved-blocks__min-lines-count'], (result) => {
            let min_lines_count = parseFloat(result['detect-moved-blocks__min-lines-count']);
            if (Number.isNaN(min_lines_count)) {
                min_lines_count = 2;
            }
            resolve(min_lines_count);
        });
    });
}

function update_background_state(state) {
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
    });
}

function request_icon_data_url() {
    return new Promise((resolve) => {
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


    async function expand_large_diffs() {
        let load_diff_buttons = document.querySelectorAll(".load-diff-button");
        for (const load_diff_button of load_diff_buttons) {
            load_diff_button.click();
        }
        if (load_diff_buttons.length > 0) {
            console.log(`Expanded ${load_diff_buttons.length} large diffs`);
            await sleep(3000);
        }
    }

    async function wait_for_page_load() {
        let count = 1;
        while (count > 0) {
            count = document.querySelectorAll("div.js-diff-progressive-container include-fragment.diff-progressive-loader").length;
            await sleep(100);
        }
        await sleep(1000);  // just in case
    }

    function is_proper_page() {
        let url_regex = /\/files([^\/].*)?$|\/(commits?\/([^\/].*)?)$/g;
        return window.location.href.match(url_regex);
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
        detection_started = true;
        try {
            set_detect_button_state("running");
            await wait_for_page_load();
            await expand_large_diffs();
            let min_lines_count = await get_min_lines_count_or_default();
            console.log(`Starting detection: min_lines_count=${min_lines_count}`);
            if (min_lines_count >= 0) {
                let page_url = window.location.href;
                let user_name = get_user_name();
                let response = await request_detected_blocks(page_url, user_name, min_lines_count);
                if (!response || !response.ok) {
                    set_detect_button_state("error");
                    return;
                }
                try {
                    let detected_blocks = response.detectedBlocks || [];
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
                set_detect_button_state("idle");
            }
        } finally {
            detection_started = false;
        }
    }

    async function detect_moves() {
        if (!is_proper_page()) {
            return;
        }
        let added = await add_detect_moved_blocks_button();
        if (!added) {
            return;
        }
        if (!auto_detection_done) {
            auto_detection_done = true;
            run_detection();
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
        timer = setInterval(detect_moves, 3000);
    }

    main();
})();
