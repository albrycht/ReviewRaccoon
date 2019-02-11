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
        this.trim_text = text.trim();
        this.leading_whitespaces = text.substr(0, text.indexOf(this.trim_text.charAt(0)) - 1);
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



class Block {
    constructor(file, start_line, end_line=null) {
        this.file = file;
        this.start_line = start_line;
        this.end_line = end_line || start_line;
    }

    can_extend_with_line(line) {
        return (this.file === line.file) && (this.end_line + 1 === line.line_no);
    }

    extend() {
        this.end_line += 1;
    }
}

class MatchingBlock {
  constructor(removed_line, added_line) {
      this.removed_block = new Block(removed_line.file, removed_line.line_no);
      this.added_block = new Block(added_line.file, added_line.line_no);
      this.indentation = removed_line.calculate_indentation_change(added_line)
  }

  try_extend_with_line(removed_line, added_line){
      if (!Line.lines_match_with_changed_indentation(removed_line, added_line, this.indentation)) {
          return false;
      }
      if (this.removed_block.can_extend_with_line(removed_line)
              && this.added_block.can_extend_with_line(added_line)) {
          this.removed_block.extend();
          this.added_block.extend();
          return true;
      }
      return false;
  }
}

class MovedBlocksDetector {
    constructor(removed_lines_raw, added_lines_raw, raw_line_to_obj_func){
        this.removed_lines = [];
        this.trim_hash_to_array_of_added_lines = new DefaultDict(Array);

        for (let line of Array.from(added_lines_raw).map(raw_line_to_obj_func)) {
            this.trim_hash_to_array_of_added_lines[line.trim_hash].push(line)
        }
        for (let line of Array.from(removed_lines_raw).map(raw_line_to_obj_func)) {
            this.removed_lines.push(line);
        }
    }

    detect_moved_blocks() {
        let detected_blocks = [];
        let currently_matching_blocks = [];
        let new_matching_blocks = [];
        let extended = false;

        for (const removed_line of this.removed_lines) {
            if (removed_line.trim_hash in this.trim_hash_to_array_of_added_lines){
                let added_lines = this.trim_hash_to_array_of_added_lines[removed_line.trim_hash];
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
                    if (! line_extended_any_block) {
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
        return detected_blocks;
    }
}

exports.Line = Line;
exports.Indentation = Indentation;
exports.IndentationType = IndentationType;
exports.Block = Block;
exports.MatchingBlock = MatchingBlock;
exports.MovedBlocksDetector = MovedBlocksDetector;
exports.DefaultDict = DefaultDict;
exports.hashCode = hashCode;