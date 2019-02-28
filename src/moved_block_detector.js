const fuzzyset = require('./fuzzyset');

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
        this.trim_text = text ? text.trim() : '';
        this.leading_whitespaces = text ? text.substr(0, text.indexOf(this.trim_text.charAt(0)) - 1) : '';
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
        if (removed_line.trim_text !== added_line.trim_text) {
            return false;
        }

        if (indetation.indent_type === IndentationType.REMOVED) {
            return removed_line.leading_whitespaces === indetation.whitespace + added_line.leading_whitespaces;
        }
        if (indetation.indent_type === IndentationType.ADDED) {
            return indetation.whitespace + removed_line.leading_whitespaces === added_line.leading_whitespaces;
        }
        throw "Invalid indentation type: " + indetation.indent_type;
    }
}

class MatchingLine {
    constructor(removed_line, added_line) {
        this.added_line = added_line;
        this.removed_line = removed_line;
    }

    can_be_extended_with_lines(removed_line, added_line) {
        return this.removed_line.is_line_before(removed_line) && this.added_line.is_line_before(added_line)
    }
}

class MatchingBlock {
    constructor(removed_line, added_line) {
        this.lines = [new MatchingLine(removed_line, added_line)];
        this.last_removed_line = removed_line;
        this.last_added_line = added_line;
        this.indentation = removed_line.calculate_indentation_change(added_line);
    }

    try_extend_with_line(removed_line, added_line){
        if (!Line.lines_match_with_changed_indentation(removed_line, added_line, this.indentation)) {
            return false;
        }
        if (this.last_removed_line.is_line_before(removed_line)
            && this.last_added_line.is_line_before(added_line)) {
            this.lines.push(new MatchingLine(removed_line, added_line));
            this.last_removed_line = removed_line;
            this.last_added_line = added_line;
            return true;
        }
        return false;
    }

    get line_count() {
        return this.lines.length;
    }

    get char_count() {
        let sum = 0;
        for (let matching_line of this.lines) {
            sum += Math.max(matching_line.added_line.trim_text.length,
                            matching_line.removed_line.trim_text.length);
        }
        return sum;
    }
}

class MovedBlocksDetector {
    constructor(removed_lines_raw, added_lines_raw, raw_line_to_obj_func){
        this.removed_lines = [];
        this.trim_hash_to_array_of_added_lines = new DefaultDict(Array);
        this.trim_text_to_array_of_added_lines = new DefaultDict(Array);
        this.added_lines_fuzzy_set = FuzzySet();

        for (let line of Array.from(added_lines_raw).map(raw_line_to_obj_func)) {
            this.trim_hash_to_array_of_added_lines[line.trim_hash].push(line);
            this.trim_text_to_array_of_added_lines[line.trim_text].push(line);
            this.added_lines_fuzzy_set.add(line.trim_text);
        }
        for (let line of Array.from(removed_lines_raw).map(raw_line_to_obj_func)) {
            this.removed_lines.push(line);
        }
    }

    filter_blocks(matching_blocks) {
        let filtered_blocks = [];
        for (const matching_block of matching_blocks) {
            if (matching_block.line_count >= 3 || matching_block.char_count >= 30) {
                filtered_blocks.push(matching_block)
            }
        }
        return filtered_blocks;
    }

    detect_moved_blocks() {
        let detected_blocks = [];
        let currently_matching_blocks = [];
        let new_matching_blocks = [];
        let extended = false;

        for (const removed_line of this.removed_lines) {
            let fuzzy_matching_pairs = this.added_lines_fuzzy_set.get(removed_line.trim_text, null, 0.5);

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
                        extended = matching_block.try_extend_with_line(removed_line, added_line);
                        if (extended) {
                            new_matching_blocks.push(matching_block);
                            line_extended_any_block = true;
                            currently_matching_blocks.splice(i, 1); // remove current element from list
                        }
                    }
                    if (!line_extended_any_block) {
                        new_matching_blocks.push(new MatchingBlock(removed_line, added_line))
                    }
                }
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
        return this.filter_blocks(detected_blocks);
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
