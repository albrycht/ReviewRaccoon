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


class Line {
    constructor(file, line_no, text) {

        this.file = file;
        if (typeof line_no !== 'number') {
            line_no = parseInt(line_no)
        }
        this.line_no = line_no;
        this.text = text;
        this.trim_hash = hashCode(text.trim())
    }

    is_line_before(line) {
        return (this.file === line.file) && (this.line_no + 1 === line.line_no)
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
  }

  try_extend_with_line(removed_line, added_line){
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
            console.log("Removed line: " + JSON.stringify(removed_line));
            if (removed_line.trim_hash in this.trim_hash_to_array_of_added_lines){
                // TODO verify text not only trim_hash
                let added_lines = this.trim_hash_to_array_of_added_lines[removed_line.trim_hash];
                console.log("Curently_matching_blocks: " + JSON.stringify(currently_matching_blocks));
                for (const added_line of added_lines) {
                    let line_extended_any_block = false;
                    for (let i = currently_matching_blocks.length - 1; i >= 0; i--) { // iterate over list with removing from backward
                        let matching_block = currently_matching_blocks[i];
                        console.log("   Added line: " + JSON.stringify(added_line));
                        console.log("   Matching block: " + JSON.stringify(matching_block));
                        extended = matching_block.try_extend_with_line(removed_line, added_line);
                        console.log("   Extended: " + extended);
                        if (extended) {
                            new_matching_blocks.push(matching_block);
                            line_extended_any_block = true;
                            currently_matching_blocks.splice(i, 1); // remove current element from list
                        }
                    }
                    if (! line_extended_any_block) {
                        console.log("Line did not extend any block");
                        new_matching_blocks.push(new MatchingBlock(removed_line, added_line))
                    }
                }
                console.log("")
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
exports.Block = Block;
exports.MatchingBlock = MatchingBlock;
exports.MovedBlocksDetector = MovedBlocksDetector;
exports.DefaultDict = DefaultDict;
exports.hashCode = hashCode;