let assert = require('assert');
const c = require('../src/moved_block_detector');

describe('Line', function() {
  it('line_end is set to line_start', function() {
    const file = "some_file";
    const line_1 = new c.Line(file, 12, "some_text");
    const line_2 = new c.Line(file, 13, "some_text2");
    assert.strictEqual(line_1.is_line_before(line_2), true)
  });

  it('calculating leading whitespaces', function() {
    const line = new c.Line("file", 12, "    some_text   ");
    assert.strictEqual(line.leading_whitespaces, "    ");
    assert.strictEqual(line.trim_text, "some_text")
  });

  it('calculate indentation change', function() {
    let line_removed = new c.Line("file", 12, "    some_text   ");
    let line_added = new c.Line("file2", 100, "         some_text   ");
    let indentation = line_removed.calculate_indentation_change(line_added);
    assert.strictEqual(indentation.indent_type, c.IndentationType.ADDED);
    assert.strictEqual(indentation.whitespace, "     ");

    // now the other way (from added to removed)
    indentation = line_added.calculate_indentation_change(line_removed);
    assert.strictEqual(indentation.indent_type, c.IndentationType.REMOVED);
    assert.strictEqual(indentation.whitespace, "     ");

    // now the other way (from added to removed)
    line_removed = new c.Line("file", 12, "    def _build_id_from_environ():");
    line_added = new c.Line("file2", 100, "def _build_id_from_environ():");
    indentation = line_added.calculate_indentation_change(line_removed);
    assert.strictEqual(indentation.indent_type, c.IndentationType.ADDED);
    assert.strictEqual(indentation.whitespace, "    ")
  });

  it('lines are matching with changed indentation', function() {
    let line_removed = new c.Line("file", 12, "    some_text");
    let line_added = new c.Line("file2", 100, "         some_text   ");
    let indentation = line_removed.calculate_indentation_change(line_added);
    assert.strictEqual(indentation.indent_type, c.IndentationType.ADDED);
    assert.strictEqual(indentation.whitespace, "     ");
    let lines_are_matching = c.Line.lines_match_with_changed_indentation(line_removed, line_added, indentation);
    assert.strictEqual(lines_are_matching, true);

    line_removed = new c.Line("file", 12, "    some_text");
    line_added = new c.Line("file2", 100, " some_text");
    indentation = line_removed.calculate_indentation_change(line_added);
    assert.strictEqual(indentation.indent_type, c.IndentationType.REMOVED);
    assert.strictEqual(indentation.whitespace, "   ");
    lines_are_matching = c.Line.lines_match_with_changed_indentation(line_removed, line_added, indentation);
    assert.strictEqual(lines_are_matching, true);

    line_removed = new c.Line("file", 12, "    some_text");
    line_added = new c.Line("file2", 100, "    some_text");
    indentation = line_removed.calculate_indentation_change(line_added);
    assert.strictEqual(indentation.indent_type, c.IndentationType.ADDED);
    assert.strictEqual(indentation.whitespace, "");
    lines_are_matching = c.Line.lines_match_with_changed_indentation(line_removed, line_added, indentation);
    assert.strictEqual(lines_are_matching, true);
  });
});

describe('MatchingBlock', function() {
  it('extend MatchingBlock block with new line', function() {
    const file1 = "some_file";
    const file2 = "some_file2";
    const removed_line_1 = new c.Line(file1, 2, "some_text");
    const added_line_1 = new c.Line(file2, 12, "some_text");
    const matching_block = new c.MatchingBlock(removed_line_1, added_line_1);
    const removed_line_2 = new c.Line(file1, 3, "some_text2");
    const added_line_2 = new c.Line(file2, 13, "some_text2");
    let extended = matching_block.try_extend_with_line(removed_line_2, added_line_2);
    assert.strictEqual(extended, true);
    assert.strictEqual(matching_block.last_removed_line.line_no, 3);
    assert.strictEqual(matching_block.last_added_line.line_no, 13);
    assert.strictEqual(matching_block.lines.length, 2);

    // now try expanding one more time with the same lines - it should not succeed
    extended = matching_block.try_extend_with_line(removed_line_2, added_line_2);
    assert.strictEqual(extended, false);
    assert.strictEqual(matching_block.last_removed_line.line_no, 3);
    assert.strictEqual(matching_block.last_added_line.line_no, 13);
    assert.strictEqual(matching_block.lines.length, 2);
  });

  it('extend MatchingBlock block with new line ver 2', function() {
    const removed_line_1 = new c.Line("file_with_removed_lines", 1, "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1");
    const added_line_1 = new c.Line("file_with_added_lines", 12, "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1");
    const matching_block = new c.MatchingBlock(removed_line_1, added_line_1);
    const removed_line_2 = new c.Line("file_with_removed_lines", 2, "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2");
    const added_line_2 = new c.Line("file_with_added_lines", 13, "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2");
    let extended = matching_block.try_extend_with_line(removed_line_2, added_line_2);
    assert.strictEqual(extended, true);
    assert.strictEqual(matching_block.last_removed_line.line_no, 2);
    assert.strictEqual(matching_block.last_added_line.line_no, 13);
    assert.strictEqual(matching_block.lines.length, 2);
  });
});

class ChangedLines {
  constructor(file, line_no_to_text){
    this.file = file;
    this.line_no_to_text = line_no_to_text;
  }

  to_array() {
    let result = [];
    for (const line_no of Object.keys(this.line_no_to_text)) {
      result.push(new c.Line(this.file, parseInt(line_no), this.line_no_to_text[line_no]))
    }
    return result;
  }
}

function no_op(x) {
  return x;
}

describe('MovedBlocksDetector', function() {
  it('simple 1 moved block', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      10: "-------------------------------------------",
      11: "-------------------------------------------",
      12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      15: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      16: "-------------------------------------------",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 12);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 4);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 15);
    assert.strictEqual(detected_blocks[0].line_count, 4);
    assert.strictEqual(detected_blocks[0].char_count, 4 * 43);
  });

  it('move block to 2 parts in 2 files', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
      6: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
      7: "7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7",
      8: "8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8",
      9: "9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9",
    });

    let added_lines_1 = new ChangedLines("file_with_added_lines_1", {
      10: "-------------------------------------------",
      13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      15: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
    });

    let added_lines_2 = new ChangedLines("file_with_added_lines_2", {
      10: "-------------------------------------------",
      14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      15: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      16: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
      17: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
      18: "-------------------------------------------",
    });
    let added_lines = added_lines_1.to_array().concat(added_lines_2.to_array());
    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines, no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 2);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 2);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 13);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 4);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 15);
    assert.strictEqual(detected_blocks[0].line_count, 3);
    assert.strictEqual(detected_blocks[0].char_count, 3 * 43);

    assert.strictEqual(detected_blocks[1].lines[0].removed_line.line_no, 3);
    assert.strictEqual(detected_blocks[1].lines[0].added_line.line_no, 14);
    assert.strictEqual(detected_blocks[1].last_removed_line.line_no, 6);
    assert.strictEqual(detected_blocks[1].last_added_line.line_no, 17);
    assert.strictEqual(detected_blocks[1].line_count, 4);
    assert.strictEqual(detected_blocks[1].char_count, 4 * 43);
  });

  it('detect block with changed indentation', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      10: "-------------------------------------------",
      11: "-------------------------------------------",
      12: "   1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      13: "   2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      14: "   3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      15: "   4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      16: "-------------------------------------------",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 12);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 4);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 15);
    assert.strictEqual(detected_blocks[0].line_count, 4);
    assert.strictEqual(detected_blocks[0].char_count, 4 * 43);
  });

  it('do not merge block with inconsistent changed indentation', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      10: "-------------------------------------------",
      11: "-------------------------------------------",
      12: "   1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      13: "   2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      14: "      3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      15: "      4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      16: "-------------------------------------------",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 2);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 12);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 2);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 13);
    assert.strictEqual(detected_blocks[0].line_count, 2);
    assert.strictEqual(detected_blocks[0].char_count, 2 * 43);

    assert.strictEqual(detected_blocks[1].lines[0].removed_line.line_no, 3);
    assert.strictEqual(detected_blocks[1].lines[0].added_line.line_no, 14);
    assert.strictEqual(detected_blocks[1].last_removed_line.line_no, 4);
    assert.strictEqual(detected_blocks[1].last_added_line.line_no, 15);
    assert.strictEqual(detected_blocks[1].line_count, 2);
    assert.strictEqual(detected_blocks[1].char_count, 2 * 43);
  });

  it('remove lines add it many times', function() {
    let removed_file = "file_with_removed_lines";
    let added_file = "file_with_added_lines";
    let removed_lines = new ChangedLines(removed_file, {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
    });

    let added_lines = new ChangedLines(added_file, {
      10: "-------------------------------------------",
      11: "-------------------------------------------",
      12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      14: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      15: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      16: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      17: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 3);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 2);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 12);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 13);
    assert.strictEqual(detected_blocks[0].line_count, 2);

    assert.strictEqual(detected_blocks[1].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[1].last_removed_line.line_no, 2);
    assert.strictEqual(detected_blocks[1].lines[0].added_line.line_no, 14);
    assert.strictEqual(detected_blocks[1].last_added_line.line_no, 15);
    assert.strictEqual(detected_blocks[1].line_count, 2);

    assert.strictEqual(detected_blocks[2].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[2].last_removed_line.line_no, 2);
    assert.strictEqual(detected_blocks[2].lines[0].added_line.line_no, 16);
    assert.strictEqual(detected_blocks[2].last_added_line.line_no, 17);
    assert.strictEqual(detected_blocks[2].line_count, 2);
  });

  it('filer out small blocks', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1",
      2: "2 2 2",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1",
      12: "2 2 2",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 0);
  });

  it('at least 2 lines to detect single moved block', function() {
    // now check that even single line block can be detected if it is long enough
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 0);


    // And now increase number of moved lines to 2
    removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
    });

    added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
    });

    detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
  });

  it('small changes are allowed in moved block', function() {
    // now check that even single line block can be detected if it is long enough
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1--",
      12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2--",
      13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3--",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].line_count, 3);
  });

  it('check Starfish ansible code moved', function() {
    // now check that even single line block can be detected if it is long enough
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "  - name: add ubuntu toolchain test PPA with gcc-7",
      2: "    apt_repository: repo='ppa:ubuntu-toolchain-r/test'",
      3: "",
      4: "  - name: install Starfish-compiled Pythons",
      5: "    apt: name={{ item }} state=latest update_cache=true allow_unauthenticated=true",
      6: "    with_items:",
      7: "      # when installing Python module which requires compilation step, Python will use the same",
      8: "      # compiler command as the one use to compile Python. On Ubuntu Python is compiled with gcc-7, so",
      9: "      # gcc-7 is needed, otherwise packages requiring compilation won't install (e.g. cryptography).",
      10: "      - gcc-7",
      11: "      - sf-python27",
      12: "      - sf-python36",
      13: "      - sf-python36-shared",
      14: "",
      15: "  - name: create symlink /usr/local/bin/python3.6",
      16: "    file:",
      17: "      src: /opt/starfish/python3.6/bin/python3.6",
      18: "      dest: /usr/local/bin/python3.6",
      19: "      state: link",
      21: "",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "    - name: add Starfish misc repo",
      12: "      apt_repository:",
      13: "        repo: \"deb https://starfishstorage.bintray.com/starfish_misc_apt {{ ansible_distribution_release }} non-free\"",
      14: "        state: present",
      15: "        filename: starfish-misc",
      16: "",
      17: "    - name: install Starfish-compiled Pythons",
      18: "      apt: name={{ item }} state=latest update_cache=true",
      19: "      with_items:",
      20: "        # when installing Python module which requires compilation step, Python will use the same",
      21: "        # compiler command as the one use to compile Python. On Ubuntu Python is compiled with gcc-7, so",
      22: "        # gcc-7 is needed, otherwise packages requiring compilation won't install (e.g. cryptography).",
      23: "        - gcc-7",
      24: "        - sf-python27",
      25: "        - sf-python36",
      26: "        - sf-python36-shared",
      27: "",
      28: "    - name: create symlink /usr/local/bin/python3.6",
      29: "      file:",
      30: "        src: /opt/starfish/python3.6/bin/python3.6",
      31: "        dest: /usr/local/bin/python3.6",
      32: "        state: link",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);

    for (let detected_block of detected_blocks) {
      let line0 = detected_block.lines[0];
      console.log(`Removed: ${line0.removed_line.line_no}-${detected_block.last_removed_line.line_no}   ` +
                  `Added: ${line0.added_line.line_no}-${detected_block.last_added_line.line_no}`);
    }
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 4);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 19);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 17);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 32);
    assert.strictEqual(detected_blocks[0].line_count, 15);
  });

  it('whitespace line do not break matching block', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "   ",
      5: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      6: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      10: "-------------------------------------------",
      11: "-------------------------------------------",
      12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      15: "   ",
      16: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      17: "-------------------------------------------",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 5);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 12);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 16);
    assert.strictEqual(detected_blocks[0].line_count, 4);
    assert.strictEqual(detected_blocks[0].char_count, 4 * 43);
  });

  it('matching block should contain at least 2 not empty lines', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "   ",
      3: "   ",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      13: "   ",
      14: "   ",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 0);
  })

  it('empty lines do not break matching block', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "    def _sort_services(services, order):",
      2: "        assert order in (PARALLEL_START_ORDER, PARALLEL_STOP_ORDER), \\",
      3: "            f\"Unknown operation order: {order}, only PARALLEL_START_ORDER and PARALLEL_STOP_ORDER are supported\"",
      4: "",
      5: "        priorities = {sname: priority for priority, sname in enumerate(ALL_SERVICE_NAMES)}",
      6: "",
      7: "        result = list(services)",
      8: "        result.sort(key=priorities.get)",
      9: "",
      10: "        if order == PARALLEL_STOP_ORDER:",
      11: "            result.reverse()",
      12: "",
      13: "        return result",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "def sort_services(services, order):",
      12: "    assert order in (PARALLEL_START_ORDER, PARALLEL_STOP_ORDER), \\",
      13: "        f\"Unknown operation order: {order}, only PARALLEL_START_ORDER and PARALLEL_STOP_ORDER are supported\"",
      14: "",
      15: "    priorities = {sname: priority for priority, sname in enumerate(ALL_SERVICE_NAMES)}",
      16: "",
      17: "    result = list(services)",
      18: "    result.sort(key=priorities.get)",
      19: "",
      20: "    if order == PARALLEL_STOP_ORDER:",
      21: "        result.reverse()",
      22: "",
      23: "    return result",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 13);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 11);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 23);
    assert.strictEqual(detected_blocks[0].lines.length, 13);
  });

  it('adding empty lines do not break matching block', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      14: "   ",
      15: "",
      16: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      17: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 5);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 11);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 17);
    assert.strictEqual(detected_blocks[0].lines.length, 7);
    assert.strictEqual(detected_blocks[0].line_count, 5);
  });

  it('removing empty lines do not break matching block', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "   ",
      5: "",
      6: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      7: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      14: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      15: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 7);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 11);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 15);
    assert.strictEqual(detected_blocks[0].lines.length, 7);
    assert.strictEqual(detected_blocks[0].line_count, 5);
  });

  it('remove empty lines from end of a block', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
      6: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      14: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
      15: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
      16: "",
      17: "",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 5);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 11);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 15);
    assert.strictEqual(detected_blocks[0].lines.length, 5);
    assert.strictEqual(detected_blocks[0].line_count, 5);
  });

  it('do not detect blocks that are inside other larger blocks', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      4: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      5: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      6: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      7: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      8: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      9: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      14: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      15: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      16: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
      17: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
      18: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
      19: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 1);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 9);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 11);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 19);
    assert.strictEqual(detected_blocks[0].lines.length, 9);
    assert.strictEqual(detected_blocks[0].line_count, 9);
  });

  it('do not detect blocks that are inside other larger blocks VER 2', function() {
    let removed_lines = new ChangedLines("file_with_removed_lines", {
      11: "        })",
      12: "        api_factory = self.installation.api_factory",
      13: "        config_obj = self.installation.get_config_obj()",
      14: "",
      15: "        for service_name, default_port, api_cls in self.services_info:",
      16: "            service_url = get_service_url(config_obj, default_port, service_name)",
      17: "            service_url = replace_in_service_url(service_url, host=host_ip)",
      18: "            service_api = api_factory._create_api(api_cls, service_url)",
      19: "            service_status = service_api.check_status()",
      20: "            self.assertEqual(service_status.status['status'], 'UP')",
      21: "",
      22: "        for service_name, default_port, api_cls in self.services_info:",
      23: "            service_url = get_service_url(config_obj, default_port, service_name)",
      24: "            service_url = replace_in_service_url(service_url, host='localhost')",
      25: "            service_api = api_factory._create_api(api_cls, service_url)",
      26: "            service_status = service_api.check_status()",
      27: "            self.assertEqual(service_status.status['status'], 'UP')",
      28: "",
      29: "        # Stop system without simulation to avoid potential problems in next running test.",
      30: "        self._stop_system(allow_simulate=False)",
    });

    let added_lines = new ChangedLines("file_with_added_lines", {
      51: "            'agent.initial_scan': False",
      52: "        }):",
      53: "",
      54: "            api_factory = self.installation.api_factory",
      55: "            config_obj = self.installation.get_config_obj()",
      56: "",
      57: "            for service_name, default_port, api_cls in self.services_info:",
      58: "                service_url = get_service_url(config_obj, default_port, service_name)",
      59: "                service_url = replace_in_service_url(service_url, host=host_ip)",
      60: "                service_api = api_factory._create_api(api_cls, service_url)",
      61: "                service_status = service_api.check_status()",
      62: "                self.assertEqual(service_status.status['status'], 'UP')",
      63: "",
      64: "            for service_name, default_port, api_cls in self.services_info:",
      65: "                service_url = get_service_url(config_obj, default_port, service_name)",
      66: "                service_url = replace_in_service_url(service_url, host='localhost')",
      67: "                service_api = api_factory._create_api(api_cls, service_url)",
      68: "                service_status = service_api.check_status()",
      69: "                self.assertEqual(service_status.status['status'], 'UP')",
    });

    let detector = new c.MovedBlocksDetector(removed_lines.to_array(), added_lines.to_array(), no_op);
    let detected_blocks = detector.detect_moved_blocks();
    assert.strictEqual(detected_blocks.length, 1);
    assert.strictEqual(detected_blocks[0].lines[0].removed_line.line_no, 12);
    assert.strictEqual(detected_blocks[0].last_removed_line.line_no, 27);
    assert.strictEqual(detected_blocks[0].lines[0].added_line.line_no, 54);
    assert.strictEqual(detected_blocks[0].last_added_line.line_no, 69);
    assert.strictEqual(detected_blocks[0].lines.length, 16);
    assert.strictEqual(detected_blocks[0].line_count, 14);
  });
});
