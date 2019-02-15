// ==UserScript==
// @name         GitHub PullRequest Move Finder
// @namespace    https://github.com/albrycht/MoveBlockDetector
// @version      0.1
// @description  show moved blocks of code while doing PR review
// @author       Michał Albrycht
// @match        https://github.com/*/pull/*/files
// @grant        none
// @require      https://raw.githubusercontent.com/albrycht/MoveBlockDetector/master/src/moved_block_detector.js
// ==/UserScript==

const ADDED_LINES_SELECTOR = "td.blob-code-addition > button.add-line-comment";
const REMOVED_LINES_SELECTOR = "td.blob-code-deletion > button.add-line-comment";
const REMOVED_DATA_TYPE_ATTR = "deletion"
const ADDED_DATA_TYPE_ATTR = "addition"
const ALL_COLORS = ['#058DC7', '#50B432', '#ED561B', '#DDDF00', '#24CBE5', '#64E572', '#FF9655', '#FFF263', '#6AF9C4',
                    'red', 'orange', 'green', 'blue', 'purple', 'brown'];

function insertDetectedBlockCssClass(){
    var style = document.createElement('style');
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
    const button_selector_prefix = data_type == REMOVED_DATA_TYPE_ATTR ? REMOVED_LINES_SELECTOR : ADDED_LINES_SELECTOR
    const add_comment_button_selector = button_selector_prefix +`[data-path="${block.file}"][data-line="${line_num}"][data-type="${data_type}"]`
    let add_comment_button_elem = document.querySelector(add_comment_button_selector);
    let parent_node = add_comment_button_elem.parentNode;
    let parent_height = parent_node.clientHeight;
    let relative_line_num = line_num - block.start_line;
    let id_prefix = `detected-block-${detected_block_index}-${relative_line_num}`
    let oposite_data_type = data_type == REMOVED_DATA_TYPE_ATTR ? ADDED_DATA_TYPE_ATTR : REMOVED_DATA_TYPE_ATTR;
    let block_color = ALL_COLORS[detected_block_index % ALL_COLORS.length];

    var block_marker = document.createElement('a');
    block_marker.innerHTML = ' ';
    block_marker.id = `${id_prefix}-${data_type}`;
    block_marker.href = `#${id_prefix}-${oposite_data_type}`;
    block_marker.className = "detectedMovedBlock";
    block_marker.style.height = parent_height + "px";
    block_marker.style.backgroundColor = block_color;
    insertAfter(block_marker, add_comment_button_elem);

    if (line_num == block.start_line) {
        parent_node.style.borderTop = `solid 1px ${block_color}`;
    };

    if (line_num == block.end_line) {
        parent_node.style.borderBottom = `solid 1px ${block_color}`;
    };
}

function highlightDetectedBlock(block_index, detected_block) {
    // TODO moved detected blocks filtering to MovedBlocksDetector class
    //console.log("Detected block num: " + block_index + "   value: " + detected_block);
    if (detected_block.removed_block.end_line - detected_block.removed_block.start_line + 1 < 3 ) {
        // Block is smaller then 3 lines - ignore
        return
    }
    for(let line_num = detected_block.removed_block.start_line; line_num <= detected_block.removed_block.end_line; line_num++){
        markLine(detected_block.removed_block, line_num, block_index, REMOVED_DATA_TYPE_ATTR);
    }
    for(let line_num = detected_block.added_block.start_line; line_num <= detected_block.added_block.end_line; line_num++){
        markLine(detected_block.added_block, line_num, block_index, ADDED_DATA_TYPE_ATTR);
    }
}

(function() {
    'use strict';
    // TODO load all large diffs javascript:(function(){[].forEach.call(document.querySelectorAll(".load-diff-button"),function(a){a.click()})})();
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
})();

// TODO detected block on non removed files (size of block = 1) on https://github.com/StarfishStorage/ansible/pull/219/files
// TODO mark indetation change with ⎵ sign?
// TODO test that last lines of file which are in matching block are added to detected blocks
