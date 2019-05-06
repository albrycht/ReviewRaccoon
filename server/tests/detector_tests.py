import unittest

from detector import Line, IndentationType, MatchingBlock, MovedBlocksDetector


class LineTest(unittest.TestCase):
    def test_is_line_before(self):
        file = 'some_file'
        line_1 = Line(file, 12, "some_text")
        line_2 = Line(file, 13, "some_text2")
        self.assertTrue(line_1.is_line_before(line_2))

    def test_calculating_leading_whitespaces(self):
        line = Line("file", 12, "    some_text   ")
        self.assertEqual(line.leading_whitespaces, "    ")
        self.assertEqual(line.trim_text, "some_text   ")

    def test_calculate_indentation_change(self):
        line_removed = Line("file", 12, "    some_text   ")
        line_added = Line("file2", 100, "         some_text   ")
        indentation = line_removed.calculate_indentation_change(line_added)
        self.assertEqual(indentation.indent_type, IndentationType.ADDED)
        self.assertEqual(indentation.whitespace, "     ")

        # now the other way (from added to removed)
        indentation = line_added.calculate_indentation_change(line_removed)
        self.assertEqual(indentation.indent_type, IndentationType.REMOVED)
        self.assertEqual(indentation.whitespace, "     ")

        line_removed = Line("file", 12, "    def _build_id_from_environ():")
        line_added = Line("file2", 100, "def _build_id_from_environ():")
        indentation = line_added.calculate_indentation_change(line_removed)
        self.assertEqual(indentation.indent_type, IndentationType.ADDED)
        self.assertEqual(indentation.whitespace, "    ")

    def test_lines_are_maching_with_changed_indentation(self):
        line_removed = Line("file", 12, "    some_text")
        line_added = Line("file2", 100, "         some_text   ")
        indentation = line_removed.calculate_indentation_change(line_added)
        self.assertEqual(indentation.indent_type, IndentationType.ADDED)
        self.assertEqual(indentation.whitespace, "     ")
        lines_are_matching = Line.lines_match_with_changed_indentation(line_removed, line_added, indentation)
        self.assertEqual(lines_are_matching, True)

        line_removed = Line("file", 12, "    some_text")
        line_added = Line("file2", 100, " some_text")
        indentation = line_removed.calculate_indentation_change(line_added)
        self.assertEqual(indentation.indent_type, IndentationType.REMOVED)
        self.assertEqual(indentation.whitespace, "   ")
        lines_are_matching = Line.lines_match_with_changed_indentation(line_removed, line_added, indentation)
        self.assertEqual(lines_are_matching, True)

        line_removed = Line("file", 12, "    some_text")
        line_added = Line("file2", 100, "    some_text")
        indentation = line_removed.calculate_indentation_change(line_added)
        self.assertEqual(indentation.indent_type, IndentationType.ADDED)
        self.assertEqual(indentation.whitespace, "")
        lines_are_matching = Line.lines_match_with_changed_indentation(line_removed, line_added, indentation)
        self.assertEqual(lines_are_matching, True)

    def test_extend_matching_block_with_new_line(self):
        file1 = "some_file"
        file2 = "some_file2"
        removed_line_1 = Line(file1, 2, "some_text")
        added_line_1 = Line(file2, 12, "some_text")
        matching_block = MatchingBlock(removed_line_1, added_line_1)
        removed_line_2 = Line(file1, 3, "some_text2")
        added_line_2 = Line(file2, 13, "some_text2")
        extended = matching_block.try_extend_with_line(removed_line_2, added_line_2)
        self.assertEqual(extended, True)
        self.assertEqual(matching_block.last_removed_line.line_no, 3)
        self.assertEqual(matching_block.last_added_line.line_no, 13)
        self.assertEqual(len(matching_block.lines), 2)
    
        # now try expanding one more time with the same lines - it should not succeed
        extended = matching_block.try_extend_with_line(removed_line_2, added_line_2)
        self.assertEqual(extended, False)
        self.assertEqual(matching_block.last_removed_line.line_no, 3)
        self.assertEqual(matching_block.last_added_line.line_no, 13)
        self.assertEqual(len(matching_block.lines), 2)

    def test_extend_matching_block_with_new_line_v2(self):
        removed_line_1 = Line("file_with_removed_lines", 1, "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1")
        added_line_1 = Line("file_with_added_lines", 12, "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1")
        matching_block = MatchingBlock(removed_line_1, added_line_1)
        removed_line_2 = Line("file_with_removed_lines", 2, "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2")
        added_line_2 = Line("file_with_added_lines", 13, "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2")
        extended = matching_block.try_extend_with_line(removed_line_2, added_line_2)
        self.assertEqual(extended, True)
        self.assertEqual(matching_block.last_removed_line.line_no, 2)
        self.assertEqual(matching_block.last_added_line.line_no, 13)
        self.assertEqual(len(matching_block.lines), 2)


class ChangedLines(object):
    def __init__(self,file, line_no_to_text):
        super()
        self.file = file
        self.line_no_to_text = line_no_to_text

    def to_array(self):
        result = []
        for line_no, text in self.line_no_to_text.items():
            result.append(Line(self.file, int(line_no), self.line_no_to_text[line_no]))
        return result

    def to_lines_dicts(self):
        result = []
        for line_no, text in self.line_no_to_text.items():
            result.append({
                'file': self.file,
                'line_no': line_no,
                'trim_text': text,  # we do not need to split text into trim_text and whitespace
                                    # because it is parsed again in Line constructor
                'leading_whitespaces': ''
            })
        return result


def no_op(x):
    return x


class MovedBlocksDetectorTest(unittest.TestCase):
    def test_simple_1_moved_block(self):

        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
        })

        added_lines = ChangedLines("file_with_added_lines", {
            10: "-------------------------------------------",
            11: "-------------------------------------------",
            12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            15: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            16: "-------------------------------------------",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 12)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 4)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 15)
        self.assertEqual(detected_blocks[0].line_count(), 4)
        self.assertEqual(detected_blocks[0].char_count(), 4 * 43)

    def test_move_block_to_2_parts_in_2_files(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
            6: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
            7: "7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7",
            8: "8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8",
            9: "9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9",
        })

        added_lines_1 = ChangedLines("file_with_added_lines_1", {
            10: "-------------------------------------------",
            13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            15: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
        })

        added_lines_2 = ChangedLines("file_with_added_lines_2", {
            10: "-------------------------------------------",
            14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            15: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            16: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
            17: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
            18: "-------------------------------------------",
        })
        added_lines = added_lines_1.to_lines_dicts() + added_lines_2.to_lines_dicts()
        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines)
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 2)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 2)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 13)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 4)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 15)
        self.assertEqual(detected_blocks[0].line_count(), 3)
        self.assertEqual(detected_blocks[0].char_count(), 3 * 43)

        self.assertEqual(detected_blocks[1].lines[0].removed_line.line_no, 3)
        self.assertEqual(detected_blocks[1].lines[0].added_line.line_no, 14)
        self.assertEqual(detected_blocks[1].last_removed_line.line_no, 6)
        self.assertEqual(detected_blocks[1].last_added_line.line_no, 17)
        self.assertEqual(detected_blocks[1].line_count(), 4)
        self.assertEqual(detected_blocks[1].char_count(), 4 * 43)
