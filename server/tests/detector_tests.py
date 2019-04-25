import unittest

from detector import Line, IndentationType


class MyTest(unittest.TestCase):
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
