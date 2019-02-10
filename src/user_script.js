// ==UserScript==
// @name         GitHub PullRequest Move Finder
// @namespace    http://detectmovedblocks.com/
// @version      0.1
// @description  show moved blocks of code while doing PR review
// @author       Michał Albrycht
// @match        https://github.com/*/pull/*/files
// @grant        none
// ==/UserScript==

const ADDED_LINES_SELECTOR = ".blob-code-addition .add-line-comment";
const REMOVED_LINES_SELECTOR = ".blob-code-deletion .add-line-comment";




let added_file_to_line_to_text = new DefaultDict(Object);
let removed_file_to_line_to_text = new DefaultDict(Object);
let trim_hash_to_array_of_added_lines = new DefaultDict(Array);
let removed_text_to_array_of_files = new DefaultDict(Array); // TODO do not need both added and removed

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

    for (let line of Array.from(added_lines_elems).map(getLine)) {
        added_file_to_line_to_text[line.file][line.line_no] = line;
        trim_hash_to_array_of_added_lines[line.trim_hash].push(line)
    }
    for (let line of Array.from(removed_lines_elems).map(getLine)) {
        removed_file_to_line_to_text[line.file][line.line_no] = line;
        removed_text_to_array_of_files[line.trim_hash].push(line)
    }

    let blocks = [];
    let currently_matching_block = null;

    for (const file_name of Object.keys(removed_file_to_line_to_text)) {
        for (const line_no of Object.keys(removed_file_to_line_to_text[file_name])) {
            let removed_line = removed_file_to_line_to_text[file_name][line_no];
            //console.log(JSON.stringify(removed_obj))
            if (removed_line.trim_hash in trim_hash_to_array_of_added_lines){
                // TODO verify text not only trim_hash
                let added_lines = trim_hash_to_array_of_added_lines[removed_line.trim_hash];
                if (!currently_matching_block) {
                    currently_matching_block = new MatchingBlock(file_name, line_no, added_lines)
                } else {
                    const extened_block = currently_matching_block.try_extend_with_line(removed_line)
                    if (extened_block) {
                        console.log("Added line to existing block: " + removed_line.line_no)
                    } else {
                        console.log("Closing old block starting new");
                        blocks.push(currently_matching_block);
                        currently_matching_block = new MatchingBlock(file_name, line_no, added_lines)
                    }
                }
            } else {
                if (currently_matching_block) {
                    blocks.push(currently_matching_block)
                }
                currently_matching_block = null;
                console.log("---")
            }
        }
    }
})();

// TODO test - remove single line - add it multipled many times one after another