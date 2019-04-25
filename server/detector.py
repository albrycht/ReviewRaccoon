from enum import Enum


class IndentationType(Enum):
    ADDED = 1
    REMOVED = 2


class Indentation(object):
    def __init__(self, whitespace, indent_type):
        self.whitespace = whitespace
        self.indent_type = indent_type


class Line(object):
    def __init__(self, file, line_no, text):
        self.file = file
        self.line_no = int(line_no)
        self.trim_text = text.lstrip() if text else ''
        self.leading_whitespaces = text[0:text.find(self.trim_text[0])] if text else ''

    @staticmethod
    def from_dict(line_dict):
        line = Line(file=line_dict['file'],
                    line_no=line_dict['line_no'],
                    text=line_dict['leading_whitespaces'] + line_dict['trim_text'])
        assert line.trim_text == line_dict['trim_text']
        assert line.leading_whitespaces == line_dict['leading_whitespaces']
        return line

    def is_line_before(self, line):
        return self.file == line.file and self.line_no + 1 == line.line_no

    def calculate_indentation_change(self, destination_line):
        length_diff = len(self.leading_whitespaces) - len(destination_line.leading_whitespaces)
        if length_diff > 0:
            return Indentation(self.leading_whitespaces[:length_diff], IndentationType.REMOVED)
        return Indentation(destination_line.leading_whitespaces[:-length_diff], IndentationType.ADDED)

    @staticmethod
    def lines_match_with_changed_indentation(removed_line, added_line, indetation):
        if removed_line.trim_text == '' or added_line.trim_text == '':
            return True
        if indetation.indent_type == IndentationType.REMOVED:
            return removed_line.leading_whitespaces == indetation.whitespace + added_line.leading_whitespaces
        if indetation.indent_type == IndentationType.ADDED:
            return indetation.whitespace + removed_line.leading_whitespaces == added_line.leading_whitespaces
        raise ValueError("Invalid indentation type: " + indetation.indent_type)

    def is_empty(self):
        return self.trim_text == ''

    def __str__(self):
        return f"{self.leading_whitespaces}{self.trim_text}"
