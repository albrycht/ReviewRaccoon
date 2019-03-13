// ==UserScript==
// @name         GitHub PullRequest Move Finder
// @namespace    https://github.com/albrycht/MoveBlockDetector
// @version      0.1
// @description  show moved blocks of code while doing PR review
// @author       Michał Albrycht
// @match        https://github.com/*/pull/*
// @grant        none
// @require      https://raw.githubusercontent.com/albrycht/MoveBlockDetector/master/src/fuzzyset.js
// @require      https://raw.githubusercontent.com/albrycht/MoveBlockDetector/master/src/moved_block_detector.js
// @require      https://raw.githubusercontent.com/google/diff-match-patch/master/javascript/diff_match_patch.js
// ==/UserScript==

const ADDED_LINES_SELECTOR = "td.blob-code-addition > button.add-line-comment";
const REMOVED_LINES_SELECTOR = "td.blob-code-deletion > button.add-line-comment";
const REMOVED_DATA_TYPE_ATTR = "deletion";
const ADDED_DATA_TYPE_ATTR = "addition";
const ALL_COLORS = ['#058DC7', '#50B432', '#ED561B', '#DDDF00', '#24CBE5', '#64E572', '#FF9655', '#FFF263', '#6AF9C4',
                    'red', 'orange', 'green', 'blue', 'purple', 'brown'];

function insertDetectedBlockCssClass(){
    const style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = '.detectedMovedBlock { display: block; width: 10px; float: right; position: relative; left: 10px;}';
    document.getElementsByTagName('head')[0].appendChild(style);
}

function insertAfter(newNode, referenceNode) {
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

function getLine(item) {
    const file = item.getAttribute("data-path");
    const text = item.getAttribute("data-original-line").substring(1); //substring(1) to removed leading - or +
    const line_no = parseInt(item.getAttribute("data-line"), 10);
    return new Line(file, line_no, text);
}

function correct_marker_heights(){
    console.log("Correcting heights");
    let markers = document.querySelectorAll(".detectedMovedBlock");

    for (const block_marker of markers) {
        let parent_height = block_marker.parentNode.clientHeight;
        block_marker.style.height = parent_height + "px";
    }
    console.log("Done");
}

function markLine(line, line_in_block_index, detected_block_index, data_type, is_first_line, is_last_line, replace_html_content, alt_msg) {
    const button_selector_prefix = data_type === REMOVED_DATA_TYPE_ATTR ? REMOVED_LINES_SELECTOR : ADDED_LINES_SELECTOR;
    const add_comment_button_selector = button_selector_prefix +`[data-path="${line.file}"][data-line="${line.line_no}"][data-type="${data_type}"]`;
    let add_comment_button_elem = document.querySelector(add_comment_button_selector);
    let parent_node = add_comment_button_elem.parentNode;
    //let parent_height = parent_node.clientHeight;
    let id_prefix = `detected-block-${detected_block_index}-${line_in_block_index}`;
    let oposite_data_type = data_type === REMOVED_DATA_TYPE_ATTR ? ADDED_DATA_TYPE_ATTR : REMOVED_DATA_TYPE_ATTR;
    let block_color = ALL_COLORS[detected_block_index % ALL_COLORS.length];

    let line_content_elem = parent_node.querySelector('.blob-code-inner.blob-code-marker');
    line_content_elem.innerHTML = replace_html_content;

    const block_marker = document.createElement('a');
    block_marker.innerHTML = ' ';
    block_marker.id = `${id_prefix}-${data_type}`;
    block_marker.href = `#${id_prefix}-${oposite_data_type}`;
    block_marker.className = "detectedMovedBlock";
    //block_marker.style.height = parent_height + "px";
    block_marker.style.height = "10px";
    block_marker.style.backgroundColor = block_color;
    block_marker.title = alt_msg;
    insertAfter(block_marker, add_comment_button_elem);

    if (is_first_line) {
        parent_node.style.borderTop = `solid 1px ${block_color}`;
    }
    if (is_last_line) {
        parent_node.style.borderBottom = `solid 1px ${block_color}`;
    }
}

function get_diff_part_as_html(diff_op, text, diff_op_to_skip){
    if (diff_op === diff_op_to_skip){
        return '';
    }
    if (diff_op === 1 || diff_op === -1) {
        return `<span class='x'>${text}</span>`;
    }
    return text;
}



function highlightDetectedBlock(block_index, detected_block) {
    for (const iter of detected_block.lines.entries()) {
        let [line_in_block_index, matching_lines] = iter;
        let removed_line = matching_lines.removed_line;
        let added_line = matching_lines.added_line;
        let match_probability = matching_lines.match_probability;
        let dmp = new diff_match_patch();
        let diff = dmp.diff_main(removed_line.leading_whitespaces + removed_line.trim_text,
                                 added_line.leading_whitespaces + added_line.trim_text);
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
        let alt_msg = `Line match: ${match_probability}. Block match: ${detected_block.weighted_lines_count}`;
        markLine(removed_line, line_in_block_index, block_index, REMOVED_DATA_TYPE_ATTR, is_first_line, is_last_line, removed_line_html, alt_msg);
        markLine(added_line, line_in_block_index, block_index, ADDED_DATA_TYPE_ATTR, is_first_line, is_last_line, added_line_html, alt_msg)
    }
}

function add_detect_moved_blocks_button() {
    let button_container = document.querySelector(".pr-review-tools");
    let existing_button = document.querySelector("#detect_moved_blocks");
    if (existing_button !== null) {
        return
    }
    let details = document.createElement("details");
    details.className = "diffbar-item details-reset details-overlay position-relative text-center";

    let summary = document.createElement("summary");
    summary.className = "btn btn-sm";
    summary.textContent = "Detect moved blocks";
    summary.id = "detect_moved_blocks";
    details.appendChild(summary);

    details.addEventListener('click', function() {main(false);}, false);

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
        await sleep(2000);
    }
}

async function clear_old_block_markers() {
    let detected_blocks_markers = document.querySelectorAll(".detectedMovedBlock");
    for (const detected_blocks_marker of detected_blocks_markers) {
        detected_blocks_marker.parentNode.removeChild(detected_blocks_marker);
    }
}

async function patch_diff_match_patch_lib(){
    // https://github.com/google/diff-match-patch/issues/39
    if (typeof Symbol === 'function') {
        diff_match_patch.Diff.prototype[Symbol.iterator] = function* () {
          yield this[0];
          yield this[1];
        };
    }
}

async function main(wait_for_page_load = true) {
    await patch_diff_match_patch_lib();
    let url_regex = /\/files([^\/].*)?$|\/(commits\/([^\/].*)?)$/g;
    if (!window.location.href.match(url_regex)){
        console.log("Wrong URL - skipping detection of moved blocks");
        return
    }
    await clear_old_block_markers();
    add_detect_moved_blocks_button();
    if (wait_for_page_load) {
        await sleep(1500);
    }
    await expand_large_diffs();
    console.log("Starting detection");
    const added_lines_elems = document.querySelectorAll(ADDED_LINES_SELECTOR);
    const removed_lines_elems = document.querySelectorAll(REMOVED_LINES_SELECTOR);

    let detector = new MovedBlocksDetector(Array.from(removed_lines_elems), Array.from(added_lines_elems), getLine);
    let detected_blocks = detector.detect_moved_blocks();
    if (detected_blocks) {
        insertDetectedBlockCssClass();
    }
    console.log("Highlighting blocks");
    for (const iter of detected_blocks.entries()) {
        let [block_index, detected_block] = iter;
        highlightDetectedBlock(block_index, detected_block);
    }
    correct_marker_heights();
    console.log("Done");
}

(function() {
    'use strict';
    document.addEventListener('pjax:end', main, false);
    main();
})();

// Example PR:
// https://github.com/StarfishStorage/ansible/pull/219/files
// https://github.com/StarfishStorage/starfish/pull/5305
// https://github.com/StarfishStorage/starfish/pull/5313
// https://github.com/albrycht/MoveBlockDetector/pull/1/files
