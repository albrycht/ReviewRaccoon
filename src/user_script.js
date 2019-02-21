// ==UserScript==
// @name         GitHub PullRequest Move Finder
// @namespace    https://github.com/albrycht/MoveBlockDetector
// @version      0.1
// @description  show moved blocks of code while doing PR review
// @author       Michał Albrycht
// @match        https://github.com/*/pull/*
// @grant        none
// @require      https://raw.githubusercontent.com/albrycht/MoveBlockDetector/master/src/moved_block_detector.js
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
    style.innerHTML = '.detectedMovedBlock { display: block; width: 10px; float: right; position: relative; margin: 0px -10px 0px -20px;}';
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

function markLine(block, line_num, detected_block_index, data_type) {
    const button_selector_prefix = data_type === REMOVED_DATA_TYPE_ATTR ? REMOVED_LINES_SELECTOR : ADDED_LINES_SELECTOR;
    const add_comment_button_selector = button_selector_prefix +`[data-path="${block.file}"][data-line="${line_num}"][data-type="${data_type}"]`;
    let add_comment_button_elem = document.querySelector(add_comment_button_selector);
    let parent_node = add_comment_button_elem.parentNode;
    let parent_height = parent_node.clientHeight;
    let relative_line_num = line_num - block.start_line;
    let id_prefix = `detected-block-${detected_block_index}-${relative_line_num}`;
    let oposite_data_type = data_type === REMOVED_DATA_TYPE_ATTR ? ADDED_DATA_TYPE_ATTR : REMOVED_DATA_TYPE_ATTR;
    let block_color = ALL_COLORS[detected_block_index % ALL_COLORS.length];

    const block_marker = document.createElement('a');
    block_marker.innerHTML = ' ';
    block_marker.id = `${id_prefix}-${data_type}`;
    block_marker.href = `#${id_prefix}-${oposite_data_type}`;
    block_marker.className = "detectedMovedBlock";
    block_marker.style.height = parent_height + "px";
    block_marker.style.backgroundColor = block_color;
    insertAfter(block_marker, add_comment_button_elem);

    if (line_num === block.start_line) {
        parent_node.style.borderTop = `solid 1px ${block_color}`;
    }
    if (line_num === block.end_line) {
        parent_node.style.borderBottom = `solid 1px ${block_color}`;
    }
}

function highlightDetectedBlock(block_index, detected_block) {
    //console.log("Detected block num: " + block_index + "   value: " + detected_block);
    for(let line_num = detected_block.removed_block.start_line; line_num <= detected_block.removed_block.end_line; line_num++){
        markLine(detected_block.removed_block, line_num, block_index, REMOVED_DATA_TYPE_ATTR);
    }
    for(let line_num = detected_block.added_block.start_line; line_num <= detected_block.added_block.end_line; line_num++){
        markLine(detected_block.added_block, line_num, block_index, ADDED_DATA_TYPE_ATTR);
    }
}

function add_detect_moved_blocks_button() {
    let button_container = document.querySelector(".pr-review-tools");
    let details = document.createElement("details");
    details.className = "diffbar-item details-reset details-overlay position-relative text-center";

    let summary = document.createElement("summary");
    summary.className = "btn btn-sm";
    summary.textContent = "Detect moved blocks";
    details.appendChild(summary);

    details.addEventListener('click', function() {main();}, false);

    button_container.appendChild(details);
}

function expand_large_diffs(){
    // TODO fix loading large diffs
    console.log("expand");
    let load_diff_buttons = document.querySelectorAll(".load-diff-button");
    console.log(`Found ${load_diff_buttons.length} not expanded diffs`);
    for (const load_diff_button of load_diff_buttons) {
        console.log("Expanging diff");
        load_diff_button.click();
    }
}

function main() {
    expand_large_diffs();
    const added_lines_elems = document.querySelectorAll(ADDED_LINES_SELECTOR);
    const removed_lines_elems = document.querySelectorAll(REMOVED_LINES_SELECTOR);

    let detector = new MovedBlocksDetector(Array.from(removed_lines_elems), Array.from(added_lines_elems), getLine);
    let detected_blocks = detector.detect_moved_blocks();

    if (detected_blocks) {
        insertDetectedBlockCssClass();
    }

    for (const iter of detected_blocks.entries()) {
        let [block_index, detected_block] = iter;
        highlightDetectedBlock(block_index, detected_block);
    }
}

(function() {
    'use strict';
    document.addEventListener('pjax:end', main, false);
    add_detect_moved_blocks_button();
    main();
})();

// TODO mark indetation change with ⎵ sign?

// Example PR:
// https://github.com/StarfishStorage/ansible/pull/219/files
// https://github.com/albrycht/MoveBlockDetector/pull/1/files
