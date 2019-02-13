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

const ADDED_LINES_SELECTOR = ".blob-code-addition .add-line-comment";
const REMOVED_LINES_SELECTOR = ".blob-code-deletion .add-line-comment";


function getLine(item) {
    const file = item.getAttribute("data-path");
    const text = item.getAttribute("data-original-line").substring(1); //substring(1) to removed leading - or +
    const line_no = parseInt(item.getAttribute("data-line"), 10);
    return new Line(file, line_no, text)
}

(function() {
    'use strict';
    // TODO load all large diffs
    const added_lines_elems = document.querySelectorAll(ADDED_LINES_SELECTOR);
    const removed_lines_elems = document.querySelectorAll(REMOVED_LINES_SELECTOR);

    let detector = new MovedBlocksDetector(Array.from(removed_lines_elems), Array.from(added_lines_elems), getLine);
    let detected_blocks = detector.detect_moved_blocks();
    console.log("Detected blocks: " + detected_blocks.length);
})();