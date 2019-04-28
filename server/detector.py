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


class MatchingLine(object):
    def __init__(self, removed_line, added_line, match_probability):
        self.added_line = added_line
        self.removed_line = removed_line
        self.match_probability = match_probability


class MatchingBlock(object):
    def __init__(self, removed_line, added_line, match_probability=1):
        self.lines = [MatchingLine(removed_line, added_line, match_probability)]
        self.last_removed_line = removed_line
        self.last_added_line = added_line
        self.indentation = removed_line.calculate_indentation_change(added_line)
        self.not_empty_lines = 0 if removed_line.is_empty() else 1
        self.weighted_lines_count = 0 if removed_line.is_empty() else match_probability

    def try_extend_with_line(self, removed_line, added_line, match_probability=1):
        if not Line.lines_match_with_changed_indentation(removed_line, added_line, self.indentation):
            return False

        if (self.last_removed_line.is_line_before(removed_line)
                and self.last_added_line.is_line_before(added_line)):
            self.lines.append(MatchingLine(removed_line, added_line, match_probability))
            self.last_removed_line = removed_line
            self.last_added_line = added_line
            self.not_empty_lines += 0 if removed_line.is_empty() else 1
            self.weighted_lines_count += 0 if removed_line.is_empty() else match_probability
            return True
        return False

    def extend_with_empty_added_line(self, next_added_line):
        self.lines.append(MatchingLine(None, next_added_line, 0))
        self.last_added_line = next_added_line

    def extend_with_empty_removed_line(self, next_removed_line):
        self.lines.append(MatchingLine(next_removed_line, None, 0))
        self.last_removed_line = next_removed_line

    def clear_empty_lines_at_end(self):
        last_index = None
        for i in range(start=len(self.lines)-1, stop=0, step=-1):
            matching_lines = self.lines[i]
            if (matching_lines.removed_line is None or matching_lines.removed_line.trim_text == '')\
               (matching_lines.added_line is None or matching_lines.added_line.trim_text == ''):
                self.last_removed_line = None
                self.last_added_line = None
            else:
                last_index = i
                break

        self.lines = self.lines[:last_index+1]
        # now we need to correct last_removed_line and last_added_line
        for i in range(start=len(self.lines)-1, stop=0, step=-1):
            if self.last_added_line is not None and self.last_removed_line is not None:
                break

            matching_lines = self.lines[i]
            if matching_lines.removed_line is not None and self.last_removed_line is None:
                self.last_removed_line = matching_lines.removed_line

            if matching_lines.added_line is not None and self.last_added_line is None:
                self.last_added_line = matching_lines.added_line

    def line_count(self):
        return self.not_empty_lines

    def char_count(self):
        count = 0
        for matching_line in self.lines:
            added_length = matching_line.added_line.trim_text.length if matching_line.added_line else 0
            removed_length = matching_line.removed_line.trim_text.length if matching_line.removed_line else 0
            count += max(added_length, removed_length)
        return count

    def __str__(self):
        return f"Block(\n\
        removed_file: {self.last_removed_line.file}\
        added_file: {self.last_added_line.file}\
        removed_lines: {self.lines[0].removed_line.line_no} -{self.last_removed_line.line_no}\
        added_lines: {self.lines[0].added_line.line_no} -{self.last_added_line.line_no}\
        );\n"
