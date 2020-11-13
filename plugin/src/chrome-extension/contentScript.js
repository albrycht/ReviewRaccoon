const ADDED_LINES_SELECTOR = "td.blob-code-addition > button.add-line-comment";
const REMOVED_LINES_SELECTOR = "td.blob-code-deletion > button.add-line-comment";
const REMOVED_DATA_TYPE_ATTR = "deletion";
const ADDED_DATA_TYPE_ATTR = "addition";
const ALL_COLORS = ['#058DC7', '#50B432', '#ED561B', '#DDDF00', '#24CBE5', '#64E572', '#FF9655', '#FFF263', '#6AF9C4',
                    'red', 'orange', 'green', 'blue', 'purple', 'brown'];

let timer = null;
let detection_started = false;

function insertAfter(newNode, referenceNode) {
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

function markLine(line, line_in_block_index, detected_block_index, data_type, is_first_line, is_last_line, replace_html_content, alt_msg) {
    const button_selector_prefix = data_type === REMOVED_DATA_TYPE_ATTR ? REMOVED_LINES_SELECTOR : ADDED_LINES_SELECTOR;
    const add_comment_button_selector = button_selector_prefix +`[data-path="${line.file}"][data-line="${line.line_no}"]`;
    let add_comment_button_elem = document.querySelector(add_comment_button_selector);
    let parent_node = add_comment_button_elem.parentNode;
    let id_prefix = `detected-block-${detected_block_index}-${line_in_block_index}`;
    let oposite_data_type = data_type === REMOVED_DATA_TYPE_ATTR ? ADDED_DATA_TYPE_ATTR : REMOVED_DATA_TYPE_ATTR;
    let block_color = ALL_COLORS[detected_block_index % ALL_COLORS.length];

    let line_content_elem = parent_node.querySelector('.blob-code-inner.blob-code-marker');
    line_content_elem.innerHTML = replace_html_content;

    const block_marker = document.createElement('a');
    block_marker.innerHTML = ' ';
    block_marker.id = `${id_prefix}-${data_type}`;
    block_marker.className = "detectedMovedBlock";
    block_marker.style.backgroundColor = block_color;
    block_marker.title = alt_msg;
    block_marker.onclick = function() {document.querySelector(`#${id_prefix}-${oposite_data_type}`).scrollIntoView(true); window.scrollBy(0, -103)};
    insertAfter(block_marker, add_comment_button_elem);

    if (is_first_line) {
        parent_node.style.borderTop = `solid 1px ${block_color}`;
    }
    if (is_last_line) {
        parent_node.style.borderBottom = `solid 1px ${block_color}`;
    }
}

function escape_html_markup(text){
    return text.replace("<", "&lt;")
}


function get_diff_part_as_html(diff_op, text, diff_op_to_skip){
    if (diff_op === diff_op_to_skip){
        return '';
    }
    if (diff_op === 1 || diff_op === -1) {
        return `<span class='x'>${escape_html_markup(text)}</span>`;
    }
    return escape_html_markup(text);
}

function highlightDetectedBlock(block_index, detected_block) {
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
        for (let i=0; i<diff.length; i++) {
            let diff_part = diff[i];
            let [op, text] = diff_part;
            removed_line_html += get_diff_part_as_html(op, text, 1);
            added_line_html += get_diff_part_as_html(op, text, -1)
        }
        let is_first_line = line_in_block_index === 0;
        let is_last_line = line_in_block_index === detected_block.lines.length - 1;
        let alt_msg = `Block index: ${block_index} Block match: ${block_match_weight.toFixed(2)} Line match: ${match_probability.toFixed(2)}`;
        if (removed_line) {
            markLine(removed_line, line_in_block_index, block_index, REMOVED_DATA_TYPE_ATTR, is_first_line, is_last_line, removed_line_html, alt_msg);
        }
        if (added_line) {
            markLine(added_line, line_in_block_index, block_index, ADDED_DATA_TYPE_ATTR, is_first_line, is_last_line, added_line_html, alt_msg)
        }
    }
}

function htmlToElement(html) {
    let template = document.createElement('template');
    html = html.trim(); // Never return a text node of whitespace as the result
    template.innerHTML = html;
    return template.content.firstChild;
}

function detect_moved_block_button_exists(){
    let existing_button = document.querySelector("#detect_moved_blocks");
    return existing_button !== null;
}

function get_min_lines_count_or_default(){
    let min_lines_count = localStorage.getItem('detect-moved-blocks__min-lines-count');
    if (min_lines_count === null || isNaN(min_lines_count)) {
        min_lines_count = 2;
    }
    return min_lines_count
}

function add_detect_moved_blocks_button() {
    let button_container = document.querySelector(".pr-review-tools");
    if (button_container === null) {
        return  // TODO this is workaround - you should add proper box for this button!
    }
    let loading_animation = htmlToElement(`
    <div id="detected_moves_loading_animation" style="display: inline-block;">
      <svg version="1.1" id="L4" x="0px" y="0px" viewBox="0 0 100 100" enable-background="new 0 0 0 0" 
        style="width: 20px; height: 20px; display: inline-block; vertical-align: middle;" 
      >
        <circle fill="#000" stroke="none" cx="6" cy="50" r="8">
          <animate attributeName="opacity" dur="1s" values="0;1;0" repeatCount="indefinite" begin="0.1"></animate>
        </circle>
        <circle fill="#000" stroke="none" cx="36" cy="50" r="8">
          <animate attributeName="opacity" dur="1s" values="0;1;0" repeatCount="indefinite" begin="0.2"></animate>
        </circle>
        <circle fill="#000" stroke="none" cx="66" cy="50" r="8">
          <animate attributeName="opacity" dur="1s" values="0;1;0" repeatCount="indefinite" begin="0.3"></animate>
        </circle>
      </svg>
    </div>`);
    let details = document.createElement("details");
    details.className = "diffbar-item details-reset details-overlay position-relative text-center";

    let carret = document.createElement("div");
    carret.className = "dropdown-caret";


    let summary = document.createElement("summary");

    summary.className = "btn btn-sm";
    summary.id = "detect_moved_blocks";
    summary.appendChild(loading_animation);
    summary.appendChild(htmlToElement('<span class="Counter" style="display: none; margin-right: 4px;" id="detected_moves_counter"></span>'));
    summary.appendChild(htmlToElement('<span style="margin-right: 4px;">Detect moved blocks</span>'));
    summary.appendChild(carret);
    details.appendChild(summary);
    let min_lines_count = get_min_lines_count_or_default();

    let popover = document.createElement("div");
    popover.className = "Popover js-diff-settings mt-2 pt-1";
    popover.style.left = "-62px";
    popover.innerHTML = `
        <div class="Popover-message text-left p-3 mx-auto Box box-shadow-large col-6">\n
            <form action="${window.location.href}" accept-charset="UTF-8" method="get">\n
                <h4 class="mb-2">Detection settings</h4>\n
                <label for="min-lines-count" class="text-normal" style="float: left; line-height: 25px;">Min lines in block</label>\n
                <input type="number" step="any" name="min-lines-count" value="${min_lines_count}" id="min-lines-count" style="width: 45px; text-align: right; float: right;">\n
                <p class="text-normal text-gray-light" style="clear: both">Value \< 0 disables detection.</p>\n
                <button class="btn btn-primary btn-sm col-12 mt-3" type="submit" id="detect-button">Apply and reload</button>\n
            </form>\n
        </div>`;
    details.appendChild(popover);
    let detect_button = details.querySelector("#detect-button");

    detect_button.addEventListener('click', function() {
        let min_lines_count = parseFloat(document.querySelector("#min-lines-count").value);
        console.log(`Starting detection: >${min_lines_count}<`);
        localStorage.setItem('detect-moved-blocks__min-lines-count', min_lines_count);
    }, false);

    button_container.appendChild(details);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function expand_large_diffs(){
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

function is_proper_page(){
    let url_regex = /\/files([^\/].*)?$|\/(commits?\/([^\/].*)?)$/g;
    return window.location.href.match(url_regex);
}

function highlights_changes(detected_blocks) {
    console.log(`Received detected blocks`);

    let loading_animation = document.querySelector("#detected_moves_loading_animation");
    if (loading_animation !== null) {
        loading_animation.style.display = "none";
    }
    let counter = document.querySelector("#detected_moves_counter");
    if (counter !== null){
        counter.innerText = detected_blocks.length;
        counter.style.display = "inline-block";
    }

    for (const iter of detected_blocks.entries()) {
        let [block_index, detected_block] = iter;
        highlightDetectedBlock(block_index, detected_block);
    }
    console.log("Done");
}

async function detect_moves(){
    if (detect_moved_block_button_exists() || detection_started){
        return
    }
    if (!is_proper_page()){
        return
    }
    detection_started = true;

    await add_detect_moved_blocks_button();
    await wait_for_page_load();
    await expand_large_diffs();
    let min_lines_count_el = document.querySelector("#min-lines-count");
    let min_lines_count = min_lines_count_el === null ? get_min_lines_count_or_default() : parseFloat(document.querySelector("#min-lines-count").value);
    console.log(`Starting detection: >${min_lines_count}<`);
    if (min_lines_count >= 0) {
        let page_url = window.location.href;

        let user_profile_link_node = document.querySelector("a.user-profile-link");
        let user_profile_url = null;
        if (user_profile_link_node){
            user_profile_url = user_profile_link_node.href;
        }
        console.log(`Sending message to background script with url: ${page_url}`);
        chrome.runtime.sendMessage(
            {contentScriptQuery: "diff_text", pull_request_url: page_url, user_profile_url: user_profile_url, min_lines_count: min_lines_count},
            (detected_blocks) => {highlights_changes(detected_blocks)}
        );
    } else {
        console.log("min_lines_count is smaller then 0 - detection disabled.");
    }
}

async function main() {
    timer = setInterval(detect_moves, 3000);
}

main();
