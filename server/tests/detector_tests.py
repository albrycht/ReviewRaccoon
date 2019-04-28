import unittest

from detector import Line, IndentationType, MatchingBlock


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
