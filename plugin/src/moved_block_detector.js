try {
    require('./fuzzyset');
} catch (ex) {
    // do nothing
}

class DefaultDict {
  constructor(defaultInit) {
    return new Proxy({}, {
      get: (target, name) => name in target ?
        target[name] :
        (target[name] = typeof defaultInit === 'function' ?
          new defaultInit().valueOf() :
          defaultInit)
    })
  }
}

function hashCode(str){
    let hash = 0, i, char;
    if (str.length === 0) return hash;
    for (i = 0; i < str.length; i++) {
        char = str.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

const IndentationType = Object.freeze({
    ADDED: Symbol("added"),
    REMOVED: Symbol("removed")
});

class Indentation {
    constructor(whitespace, indent_type) {
        this.whitespace = whitespace;
        this.indent_type = indent_type;
    }
}


class Line {
    constructor(file, line_no, text) {

        this.file = file;
        if (typeof line_no !== 'number') {
            line_no = parseInt(line_no)
        }
        this.line_no = line_no;
        this.trim_text = text ? text.ltrim() : '';
        this.leading_whitespaces = text ? text.substr(0, text.indexOf(this.trim_text.charAt(0))) : '';
        this.trim_hash = hashCode(this.trim_text)
    }

    is_line_before(line) {
        return (this.file === line.file) && (this.line_no + 1 === line.line_no)
    }

    calculate_indentation_change(destination_line) {
        const length_diff = this.leading_whitespaces.length - destination_line.leading_whitespaces.length;
        if ( length_diff > 0) {
            return new Indentation(this.leading_whitespaces.substring(0, length_diff), IndentationType.REMOVED)
        }
        return new Indentation(destination_line.leading_whitespaces.substring(0, -length_diff), IndentationType.ADDED)
    }

    static lines_match_with_changed_indentation(removed_line, added_line, indetation) {
        if (removed_line.trim_text === '' || added_line.trim_text === ''){
            return true
        }
        if (indetation.indent_type === IndentationType.REMOVED) {
            return removed_line.leading_whitespaces === indetation.whitespace + added_line.leading_whitespaces;
        }
        if (indetation.indent_type === IndentationType.ADDED) {
            return indetation.whitespace + removed_line.leading_whitespaces === added_line.leading_whitespaces;
        }
        throw "Invalid indentation type: " + indetation.indent_type;
    }

    is_empty() {
        return this.trim_text === ''
    }

    toString(){
        return `${this.leading_whitespaces}${this.trim_text}`
    }
}

class MatchingLine {
    constructor(removed_line, added_line, match_probability) {
        this.added_line = added_line;
        this.removed_line = removed_line;
        this.match_probability = match_probability;
    }
}

class MatchingBlock {
    constructor(removed_line, added_line, match_probability) {
        this.lines = [new MatchingLine(removed_line, added_line, match_probability)];
        this.last_removed_line = removed_line;
        this.last_added_line = added_line;
        this.indentation = removed_line.calculate_indentation_change(added_line);
        this.not_empty_lines = removed_line.is_empty() ? 0 : 1;
        this.weighted_lines_count = removed_line.is_empty() ? 0 : match_probability;

    }

    try_extend_with_line(removed_line, added_line, match_probability){
        if (!Line.lines_match_with_changed_indentation(removed_line, added_line, this.indentation)) {
            return false;
        }
        if (this.last_removed_line.is_line_before(removed_line)
            && this.last_added_line.is_line_before(added_line)) {
            this.lines.push(new MatchingLine(removed_line, added_line, match_probability));
            this.last_removed_line = removed_line;
            this.last_added_line = added_line;
            this.not_empty_lines += removed_line.is_empty() ? 0 : 1;
            this.weighted_lines_count += removed_line.is_empty() ? 0 : match_probability;
            return true;
        }
        return false;
    }

    extend_with_empty_added_line(next_added_line){
        this.lines.push(new MatchingLine(null, next_added_line, 0));
        this.last_added_line = next_added_line;
    }

    extend_with_empty_removed_line(next_removed_line){
        this.lines.push(new MatchingLine(next_removed_line, null, 0));
        this.last_removed_line = next_removed_line;
    }

    clear_empty_lines_at_end(){
        let last_index = null;
        for (let i = this.lines.length - 1; i >= 0; i--) {
            let matching_lines = this.lines[i];
            if ((!matching_lines.removed_line || matching_lines.removed_line.trim_text === '')
                && (!matching_lines.added_line || matching_lines.added_line.trim_text === '')) {
                this.lines.splice(i, 1);
                this.last_removed_line = null;
                this.last_added_line = null;
            } else {
                last_index = i;
                break
            }
        }

        for (let i = last_index; i >= 0; i--) {
            if (this.last_added_line !== null && this.last_removed_line !== null) {
                break
            }
            let matching_lines = this.lines[i];
            if (matching_lines.removed_line !== null && this.last_removed_line === null) {
                this.last_removed_line = matching_lines.removed_line;
            }
            if (matching_lines.added_line !== null && this.last_added_line === null) {
                this.last_added_line = matching_lines.added_line;
            }
        }
    }

    get line_count() {
        return this.not_empty_lines
    }

    get char_count() {
        let sum = 0;
        for (let matching_line of this.lines) {
            let added_length = matching_line.added_line ? matching_line.added_line.trim_text.length : 0;
            let removed_length = matching_line.removed_line ? matching_line.removed_line.trim_text.length : 0;
            sum += Math.max(added_length, removed_length);
        }
        return sum;
    }

    toString(){
        return `Block(\n
           removed_file: ${this.last_removed_line.file}
           added_file: ${this.last_added_line.file}
           removed_lines: ${this.lines[0].removed_line.line_no}-${this.last_removed_line.line_no}
           added_lines: ${this.lines[0].added_line.line_no}-${this.last_added_line.line_no}
           );\n`
    }
}

class MovedBlocksDetector {
    constructor(removed_lines_raw, added_lines_raw, raw_line_to_obj_func){
        this.removed_lines = [];
        this.trim_hash_to_array_of_added_lines = new DefaultDict(Array);
        this.trim_text_to_array_of_added_lines = new DefaultDict(Array);
        this.added_file_name_to_line_no_to_line = new DefaultDict(Object);
        this.removed_file_name_to_line_no_to_line = new DefaultDict(Object);
        this.added_lines_fuzzy_set = FuzzySet();

        for (let line of Array.from(added_lines_raw).map(raw_line_to_obj_func)) {
            this.trim_hash_to_array_of_added_lines[line.trim_hash].push(line);
            this.trim_text_to_array_of_added_lines[line.trim_text].push(line);
            this.added_lines_fuzzy_set.add(line.trim_text);
            this.added_file_name_to_line_no_to_line[line.file][line.line_no] = line;
        }
        for (let line of Array.from(removed_lines_raw).map(raw_line_to_obj_func)) {
            this.removed_lines.push(line);
            this.removed_file_name_to_line_no_to_line[line.file][line.line_no] = line;
        }
    }

    filter_out_block_inside_other_blocks(filtered_blocks){
         // sort by 3 fields:  start line_no ASC, end line_no DESC, weighted_lines_count DESC
        filtered_blocks.sort(function (a, b) {
            let a_file = a.last_removed_line.file;
            let b_file = b.last_removed_line.file;
            if (a_file !== b_file) {
                return a_file < b_file ? -1 : 1
            }
            return a.lines[0].removed_line.line_no - b.lines[0].removed_line.line_no  // start line ASCENDING
                || b.last_removed_line.line_no - a.last_removed_line.line_no  // end line DESCENDING
                || b.weighted_lines_count - a.weighted_lines_count;  // weighted_lines_count DESCENDING
        });

        let last_matching_block = null;
        for (const matching_block of filtered_blocks) {
            if (last_matching_block === null) {
                last_matching_block = matching_block;
                continue
            }
            if (matching_block.last_removed_line.file === last_matching_block.last_removed_line.file
                && matching_block.lines[0].removed_line.line_no >= last_matching_block.lines[0].removed_line.line_no
                && matching_block.last_removed_line.line_no <= last_matching_block.last_removed_line.line_no
                ) {
                    if (matching_block.weighted_lines_count < last_matching_block.weighted_lines_count) {
                        matching_block.remove_part_is_inside_larger_block = true;
                    }
            } else {
                last_matching_block = matching_block;
            }
        }

        // sort by 3 fields:  start line_no ASC, end line_no DESC, weighted_lines_count DESC
        filtered_blocks.sort(function (a, b) {
            let a_file = a.last_added_line.file;
            let b_file = b.last_added_line.file;
            if (a_file !== b_file) {
                return a_file < b_file ? -1 : 1
            }
            return a.lines[0].added_line.line_no - b.lines[0].added_line.line_no  // start line ASCENDING
                || b.last_added_line.line_no - a.last_added_line.line_no  // end line DESCENDING
                || b.weighted_lines_count - a.weighted_lines_count;  // weighted_lines_count DESCENDING
        });

        let ok_blocks = [];
        last_matching_block = null;
        for (const matching_block of filtered_blocks) {
            if (last_matching_block === null) {
                last_matching_block = matching_block;
                ok_blocks.push(matching_block);
                continue
            }
            if (matching_block.last_added_line.file === last_matching_block.last_added_line.file
                && matching_block.lines[0].added_line.line_no >= last_matching_block.lines[0].added_line.line_no
                && matching_block.last_added_line.line_no <= last_matching_block.last_added_line.line_no
                ) {
                    if (matching_block.remove_part_is_inside_larger_block) {
                         //pass
                    } else {
                        ok_blocks.push(matching_block)
                    }
            } else {
                last_matching_block = matching_block;
                ok_blocks.push(matching_block)
            }
        }
        return ok_blocks;
    }

    filter_blocks(matching_blocks) {
        let filtered_blocks = [];
        for (const matching_block of matching_blocks) {
            if (matching_block.weighted_lines_count >= 2 && matching_block.char_count >= 30) {
                matching_block.clear_empty_lines_at_end();
                filtered_blocks.push(matching_block)
            }
        }

        return this.filter_out_block_inside_other_blocks(filtered_blocks);
    }

    extend_matching_blocks_with_empty_added_lines_if_possible(currently_matching_blocks){
        for (const matching_block of currently_matching_blocks) {
            while (true) {
                let last_line = matching_block.last_added_line;
                let next_added_line = this.added_file_name_to_line_no_to_line[last_line.file][last_line.line_no + 1];
                if (next_added_line && next_added_line.trim_text === '') {
                    matching_block.extend_with_empty_added_line(next_added_line);
                } else {
                    break;
                }
            }
        }
    }

    extend_matching_blocks_with_empty_removed_lines_if_possible(currently_matching_blocks){
        let extended_blocks = [];
        for (let i = currently_matching_blocks.length - 1; i >= 0; i--) { // iterate over list with removing from backward
            let matching_block = currently_matching_blocks[i];
            let block_extended = false;
            let last_line = matching_block.last_removed_line;
            let next_removed_line = this.removed_file_name_to_line_no_to_line[last_line.file][last_line.line_no + 1];
            if (next_removed_line && next_removed_line.trim_text === '') {
                matching_block.extend_with_empty_removed_line(next_removed_line);
                block_extended = true;
                currently_matching_blocks.splice(i, 1); // remove current element from list
                extended_blocks.push(matching_block);
            }
        }
        return extended_blocks;
    }

    detect_moved_blocks() {
        let detected_blocks = [];
        let currently_matching_blocks = [];
        let new_matching_blocks = [];
        let extended = false;

        for (const removed_line of this.removed_lines) {
            let fuzzy_matching_pairs = this.added_lines_fuzzy_set.get(removed_line.trim_text, null, 0.5);
            if (removed_line.trim_text === '') {
                fuzzy_matching_pairs = [[1, '']];
            } else {
                // iterate over currently_matching_blocks and try to extend them with empty lines
                this.extend_matching_blocks_with_empty_added_lines_if_possible(currently_matching_blocks)
            }

            if (fuzzy_matching_pairs === null){
                continue
            }

            for (const fuzz_pair of fuzzy_matching_pairs) {
                let [match_probability, text] = fuzz_pair;
                let added_lines = this.trim_text_to_array_of_added_lines[text];
                for (const added_line of added_lines) {
                    let line_extended_any_block = false;
                    for (let i = currently_matching_blocks.length - 1; i >= 0; i--) { // iterate over list with removing from backward
                        let matching_block = currently_matching_blocks[i];
                        extended = matching_block.try_extend_with_line(removed_line, added_line, match_probability);
                        if (extended) {
                            new_matching_blocks.push(matching_block);
                            line_extended_any_block = true;
                            currently_matching_blocks.splice(i, 1); // remove current element from list
                        }
                    }
                    if (!line_extended_any_block && removed_line.trim_text !== '') {
                        new_matching_blocks.push(new MatchingBlock(removed_line, added_line, match_probability))
                    }
                }
            }
            if (removed_line.trim_text === '') {
                let extended_blocks = this.extend_matching_blocks_with_empty_removed_lines_if_possible(currently_matching_blocks);
                new_matching_blocks.push(...extended_blocks);
            }

            for (const matching_block of currently_matching_blocks) {
                detected_blocks.push(matching_block)
            }
            currently_matching_blocks = new_matching_blocks;
            new_matching_blocks = [];
        }
        for (const matching_block of currently_matching_blocks) {
            detected_blocks.push(matching_block)
        }

        let filtered_blocks = this.filter_blocks(detected_blocks);
        console.log(`Detected ${filtered_blocks.length} blocks (${detected_blocks.length - filtered_blocks.length} filtered)`);
        // console.log(`Blocks: ${filtered_blocks}`);
        return filtered_blocks;
    }
}

if (exports !== undefined && exports !== null) {	
    exports.Line = Line;	
    exports.Indentation = Indentation;	
    exports.IndentationType = IndentationType;	
    exports.MatchingBlock = MatchingBlock;
    exports.MovedBlocksDetector = MovedBlocksDetector;	
    exports.DefaultDict = DefaultDict;	
    exports.hashCode = hashCode;	
} 
