import json
from collections import defaultdict
from enum import Enum
from textwrap import dedent
from typing import List, Dict

from unidiff import PatchSet

from fuzzyset import FuzzySet
from time_utils import measure_fun_time


def filepath(patched_file):
    """Return target path as this is convinient to use in GitHub"""
    if patched_file.source_file.startswith('a/') and patched_file.target_file.startswith('b/'):
        filepath = patched_file.target_file[2:]
    elif patched_file.source_file.startswith('a/') and patched_file.target_file == '/dev/null':
        filepath = patched_file.source_file[2:]
    elif patched_file.target_file.startswith('b/') and patched_file.source_file == '/dev/null':
        filepath = patched_file.target_file[2:]
    else:
        filepath = patched_file.source_file
    return filepath


def diff_to_added_and_removed_lines(diff_text):
    patch = PatchSet(diff_text)
    added_lines = []
    removed_lines = []
    for patched_file in patch:
        file = filepath(patched_file)
        for hunk in patched_file:
            for line in hunk:
                leading_whitespace, trim_text = split_to_leading_whitespace_and_trim_text(line.value.rstrip('\n'))
                if line.is_added:
                    line_no = line.target_line_no
                    lines_list = added_lines
                elif line.is_removed:
                    line_no = line.source_line_no
                    lines_list = removed_lines
                else:
                    continue
                lines_list.append({
                    'file': file,
                    'line_no': line_no,
                    'trim_text': trim_text,
                    'leading_whitespaces': leading_whitespace,
                })
    return {
        'added_lines': added_lines,
        'removed_lines': removed_lines,
    }


def split_to_leading_whitespace_and_trim_text(text):
    trim_text = text.lstrip() if text else ''
    if trim_text:
        leading_whitespaces = text[0:text.find(trim_text[0])] if text else ''
    else:
        leading_whitespaces = text
    return leading_whitespaces, trim_text


class Line(object):
    def __init__(self, file, line_no, text):
        self.file = file
        self.line_no = int(line_no)
        self.leading_whitespaces, self.trim_text = split_to_leading_whitespace_and_trim_text(text)
        self.trim_text_len = len(self.trim_text)

    @staticmethod
    def from_dict(line_dict):
        line = Line(file=line_dict['file'],
                    line_no=line_dict['line_no'],
                    text=line_dict['leading_whitespaces'] + line_dict['trim_text'])
        return line

    def is_line_before(self, line):
        return self.file == line.file and self.line_no + 1 == line.line_no

    def is_empty(self):
        return self.trim_text == ''

    def __str__(self):
        return f"{self.leading_whitespaces}{self.trim_text}"

    def to_dict(self):
        return {
            "file": self.file,
            "line_no": self.line_no,
            "leading_whitespaces": self.leading_whitespaces,
            "trim_text": self.trim_text,
        }

    def to_json(self):
        return json.dumps(self.to_dict())


class MatchingLine(object):
    def __init__(self, removed_line, added_line, match_probability):
        self.added_line: Line = added_line
        self.removed_line: Line = removed_line
        self.match_probability = match_probability

    def to_dict(self):
        return {
            "added_line": self.added_line.to_dict() if self.added_line else None,
            "removed_line": self.removed_line.to_dict() if self.removed_line else None,
            "match_probability": self.match_probability,
        }

    def to_json(self):
        return json.dumps(self.to_dict())


class MatchingBlock(object):

    def __init__(self):
        self.lines: List[MatchingLine] = []
        self.first_removed_line = None
        self.first_added_line = None
        self.last_removed_line = None
        self.last_added_line = None
        self.not_empty_lines = 0
        self.weighted_lines_count = 0
        self.weighted_chars_count = 0
        self.char_count = 0
        self.match_density = 0
        self.added_lines_numbers = set()
        self.removed_lines_numbers = set()

    @classmethod
    def from_line(cls, removed_line, added_line, match_probability=1):
        block = MatchingBlock()
        block.lines = [MatchingLine(removed_line, added_line, match_probability)]
        block.first_removed_line = removed_line
        block.first_added_line = added_line
        block.last_removed_line = removed_line
        block.last_added_line = added_line
        block.not_empty_lines = 0 if removed_line.is_empty() else 1
        block.weighted_lines_count = 0 if removed_line.is_empty() else match_probability
        block.char_count = removed_line.trim_text_len + added_line.trim_text_len
        block.weighted_chars_count = (removed_line.trim_text_len + added_line.trim_text_len) * match_probability
        block.match_density = block.weighted_chars_count / block.char_count
        block.added_lines_numbers.add(added_line.line_no)
        block.removed_lines_numbers.add(removed_line.line_no)
        return block

    def try_extend_with_line(self, removed_line, added_line, match_probability=1):
        if (self.last_removed_line.is_line_before(removed_line)
                and self.last_added_line.is_line_before(added_line)):
            self.lines.append(MatchingLine(removed_line, added_line, match_probability))
            self.last_removed_line = removed_line
            self.last_added_line = added_line
            self.not_empty_lines += 0 if removed_line.is_empty() else 1
            self.weighted_lines_count += 0 if removed_line.is_empty() else match_probability
            self.char_count += removed_line.trim_text_len + added_line.trim_text_len
            self.weighted_chars_count += (removed_line.trim_text_len + added_line.trim_text_len) * match_probability
            self.match_density = self.weighted_chars_count / self.char_count
            self.added_lines_numbers.add(added_line.line_no)
            self.removed_lines_numbers.add(removed_line.line_no)
            return True
        return False

    def extend_with_empty_added_line(self, next_added_line):
        self.lines.append(MatchingLine(None, next_added_line, 0))
        self.last_added_line = next_added_line

    def extend_with_empty_removed_line(self, next_removed_line):
        self.lines.append(MatchingLine(next_removed_line, None, 0))
        self.last_removed_line = next_removed_line
        assert next_removed_line is not None

    def clear_empty_lines_at_end(self):
        last_index = None
        for i in range(len(self.lines)-1, 0, -1):
            matching_lines = self.lines[i]
            if matching_lines.removed_line is None or matching_lines.added_line is None:
                self.last_removed_line = None
                self.last_added_line = None
            else:
                last_index = i
                break
        if last_index is None:
            return None
        self.lines = self.lines[:last_index+1]
        # now we need to correct last_removed_line and last_added_line
        for i in range(len(self.lines)-1, 0, -1):
            if self.last_added_line is not None and self.last_removed_line is not None:
                break

            matching_lines = self.lines[i]
            if matching_lines.removed_line is not None and self.last_removed_line is None:
                self.last_removed_line = matching_lines.removed_line

            if matching_lines.added_line is not None and self.last_added_line is None:
                self.last_added_line = matching_lines.added_line
        assert self.last_removed_line is not None and self.last_added_line is not None
        return self

    def line_count(self):
        return self.not_empty_lines

    # def char_count(self):
    #     count = 0
    #     for matching_line in self.lines:
    #         added_length = len(matching_line.added_line.trim_text) if matching_line.added_line else 0
    #         removed_length = len(matching_line.removed_line.trim_text) if matching_line.removed_line else 0
    #         count += max(added_length, removed_length)
    #     return count

    def get_filter_sort_tuple_for_remove(self):
        return (self.last_removed_line.file,
                self.lines[0].removed_line.line_no,
                -self.last_removed_line.line_no,
                -self.weighted_lines_count)

    def get_filter_sort_tuple_for_add(self):
        return (self.last_removed_line.file,
                self.lines[0].added_line.line_no,
                -self.last_added_line.line_no,
                -self.weighted_lines_count)

    @property
    def file_removed(self):
        return self.last_removed_line.file

    @property
    def file_added(self):
        return self.last_added_line.file

    # @property
    # def first_removed_line(self):
    #     return self.lines[0].removed_line
    #
    # @property
    # def first_added_line(self):
    #     return self.lines[0].added_line

    def __str__(self):
        return dedent(f"""Block(
        removed_file: {self.last_removed_line.file}
        added_file: {self.last_added_line.file}
        removed_lines: {self.lines[0].removed_line.line_no}-{self.last_removed_line.line_no}
        added_lines: {self.lines[0].added_line.line_no}-{self.last_added_line.line_no}
        );\n""")

    def __repr__(self):
        return str(self)

    def to_dict(self):
        return {
            "lines": [line.to_dict() for line in self.lines]
        }

    def to_json(self):
        return json.dumps(self.to_dict())


class MovedBlocksDetector(object):
    def __init__(self, removed_lines_dicts, added_lines_dicts):
        self.removed_lines = []
        self.trim_text_to_array_of_added_lines = defaultdict(list)
        self.added_file_name_to_line_no_to_line = defaultdict(dict)
        self.removed_file_name_to_line_no_to_line = defaultdict(dict)
        self.added_lines_fuzzy_set = FuzzySet()

        for added_line_dict in added_lines_dicts:
            line = Line.from_dict(added_line_dict)
            self.trim_text_to_array_of_added_lines[line.trim_text].append(line)
            self.added_lines_fuzzy_set.add(line.trim_text)
            self.added_file_name_to_line_no_to_line[line.file][line.line_no] = line

        for removed_line_dict in removed_lines_dicts:
            line = Line.from_dict(removed_line_dict)
            self.removed_lines.append(line)
            self.removed_file_name_to_line_no_to_line[line.file][line.line_no] = line

    @staticmethod
    def from_diff(diff_text):
        parsed = diff_to_added_and_removed_lines(diff_text)
        return MovedBlocksDetector(parsed['removed_lines'], parsed['added_lines'])

    @measure_fun_time()
    def filter_out_block_inside_other_blocks(self, filtered_blocks: List[MatchingBlock]):
        filtered_blocks.sort(key=lambda fb: fb.get_filter_sort_tuple_for_remove())

        last_matching_block = None
        for matching_block in filtered_blocks:
            if last_matching_block is None:
                last_matching_block = matching_block
                continue
            if matching_block.last_removed_line.file == last_matching_block.last_removed_line.file \
                    and matching_block.first_removed_line.line_no >= last_matching_block.first_removed_line.line_no \
                    and matching_block.last_removed_line.line_no <= last_matching_block.last_removed_line.line_no:
                if matching_block.weighted_lines_count < last_matching_block.weighted_lines_count\
                   and matching_block.removed_lines_numbers.issubset(last_matching_block.removed_lines_numbers):
                    matching_block.remove_part_is_inside_larger_block = True
            else:
                last_matching_block = matching_block

        filtered_blocks.sort(key=lambda fb: fb.get_filter_sort_tuple_for_add())
        ok_blocks = []
        last_matching_block = None
        for matching_block in filtered_blocks:
            if getattr(matching_block, "remove_part_is_inside_larger_block", False): # TODO getattr was used to act like in javascript - rewrite it without getattr
                continue
            if last_matching_block is None:
                last_matching_block = matching_block
                ok_blocks.append(matching_block)
                continue
            if matching_block.last_added_line.file == last_matching_block.last_added_line.file \
                    and matching_block.first_added_line.line_no >= last_matching_block.first_added_line.line_no \
                    and matching_block.last_added_line.line_no <= last_matching_block.last_added_line.line_no\
                    and matching_block.weighted_lines_count < last_matching_block.weighted_lines_count\
                    and not matching_block.added_lines_numbers.issubset(last_matching_block.added_lines_numbers):
                pass
            else:
                last_matching_block = matching_block
                ok_blocks.append(matching_block)

        return ok_blocks

    def _filter_out_small_blocks(self, matching_blocks, min_lines_count):
        return [block for block in matching_blocks if block.weighted_lines_count >= min_lines_count and block.char_count >= 20]

    def _clear_not_matching_lines_at_end_and_filter_out_empty_blocks(self, matching_blocks):
        filtered_blocks = []
        for matching_block in matching_blocks:
            block_without_empty_end = matching_block.clear_empty_lines_at_end()
            if block_without_empty_end is not None:
                filtered_blocks.append(matching_block)
        return filtered_blocks

    def merge_blocks(self, block1, block2):
        new_block = MatchingBlock()
        new_block.lines.extend(block1.lines)
        new_block.lines.extend(block2.lines)
        # TODO what about lines between those 2 blocks?
        new_block.first_added_line = block1.first_added_line or block2.first_added_line
        new_block.first_removed_line = block1.first_removed_line or block2.first_removed_line
        new_block.last_added_line = block2.last_added_line or block1.last_added_line
        new_block.last_removed_line = block2.last_removed_line or block1.last_removed_line
        new_block.weighted_lines_count = block1.weighted_lines_count + block2.weighted_lines_count
        new_block.not_empty_lines = block1.not_empty_lines + block2.not_empty_lines
        new_block.char_count = block1.char_count + block2.char_count
        new_block.weighted_chars_count = block1.weighted_chars_count + block2.weighted_chars_count
        new_block.match_density = new_block.weighted_chars_count / new_block.char_count
        new_block.added_lines_numbers = block1.added_lines_numbers | block2.added_lines_numbers
        new_block.removed_lines_numbers = block1.removed_lines_numbers | block2.removed_lines_numbers
        return new_block

    @measure_fun_time()
    def join_nearby_blocks(self, matching_blocks: List[MatchingBlock], max_space_between=2):
        max_space_between += 1  # if we want to allow 2 lines between blocks difference between line numbers is 3
        blocks_grouped_by_files: Dict[tuple, List[MatchingBlock]] = defaultdict(list)
        for block in matching_blocks:
            blocks_grouped_by_files[(block.file_removed, block.file_added)].append(block)
        blocks_after_merge: List[MatchingBlock] = []

        merged_blocks = 0
        for block_list in blocks_grouped_by_files.values():
            loops_made = 0
            block_list.sort(key=lambda block: (block.first_removed_line.line_no, -block.match_density))
            indexes_of_merged_blocks = set()
            merged_blocks_list = []
            for i in range(len(block_list)):
                block = block_list[i]
                for j in range(i+1, len(block_list)):
                    loops_made += 1
                    next_block = block_list[j]
                    if next_block.first_removed_line.line_no - block.last_removed_line.line_no > max_space_between:
                        break
                    elif (next_block.first_removed_line.line_no > block.last_removed_line.line_no
                            and next_block.first_added_line.line_no - block.last_added_line.line_no <= max_space_between
                            and next_block.first_added_line.line_no > block.last_added_line.line_no):
                        block = self.merge_blocks(block, next_block)
                        merged_blocks += 1
                        indexes_of_merged_blocks.add(i)
                        indexes_of_merged_blocks.add(j)
                if i in indexes_of_merged_blocks:
                    merged_blocks_list.append(block)
            for i in range(len(block_list)):
                if i not in indexes_of_merged_blocks:
                    blocks_after_merge.append(block_list[i])
            blocks_after_merge.extend(merged_blocks_list)
        return blocks_after_merge

    @measure_fun_time()
    def filter_blocks(self, matching_blocks, min_lines_count=None):
        if min_lines_count is None:
            min_lines_count = 2
        filtered_blocks = self._filter_out_small_blocks(matching_blocks, min_lines_count)
        filtered_blocks = self._clear_not_matching_lines_at_end_and_filter_out_empty_blocks(filtered_blocks)
        return self.filter_out_block_inside_other_blocks(filtered_blocks)

    def extend_matching_blocks_with_empty_added_lines_if_possible(self, currently_matching_blocks):
        for matching_block in currently_matching_blocks:
            while True:
                last_line = matching_block.last_added_line
                next_added_line = self.added_file_name_to_line_no_to_line[last_line.file].get(last_line.line_no + 1)
                if next_added_line and next_added_line.trim_text == '':
                    matching_block.extend_with_empty_added_line(next_added_line)
                else:
                    break

    def extend_matching_blocks_with_empty_removed_lines_if_possible(self, currently_matching_blocks: List[MatchingBlock]):
        extended_blocks = []
        not_extended_blocks = []
        for matching_block in currently_matching_blocks:
            last_line = matching_block.last_removed_line
            next_removed_line = self.removed_file_name_to_line_no_to_line[last_line.file].get(last_line.line_no + 1)
            if next_removed_line and next_removed_line.trim_text == '':
                matching_block.extend_with_empty_removed_line(next_removed_line)
                extended_blocks.append(matching_block)
            else:
                not_extended_blocks.append(matching_block)

        return extended_blocks, not_extended_blocks

    @measure_fun_time()
    def detect_moved_blocks(self, min_lines_count=None) -> List[MatchingBlock]:
        detected_blocks: List[MatchingBlock] = []
        currently_matching_blocks = []
        new_matching_blocks = []

        for removed_line in self.removed_lines:
            if removed_line.trim_text:
                min_match_score = 0.5 if len(removed_line.trim_text) > 2 else 0.35
                fuzzy_matching_pairs = self.added_lines_fuzzy_set.get(
                    removed_line.trim_text, default=None, exact_match_only=False, min_match_score=min_match_score
                )
                # iterate over currently_matching_blocks and try to extend them with empty lines
                self.extend_matching_blocks_with_empty_added_lines_if_possible(currently_matching_blocks)
            else:
                fuzzy_matching_pairs = [[1, '']]

            if not fuzzy_matching_pairs:
                continue

            for fuzz_pair in fuzzy_matching_pairs:
                match_probability, text = fuzz_pair
                added_lines = self.trim_text_to_array_of_added_lines[text]
                for added_line in added_lines:
                    line_extended_any_block = False
                    already_added = set()
                    for i, matching_block in enumerate(currently_matching_blocks):
                        if i in already_added:
                            continue
                        extended = matching_block.try_extend_with_line(removed_line, added_line, match_probability)
                        if extended:
                            new_matching_blocks.append(matching_block)
                            line_extended_any_block = True
                            already_added.add(i)

                    if not line_extended_any_block and removed_line.trim_text != '':
                        new_matching_blocks.append(MatchingBlock.from_line(removed_line, added_line, match_probability))
                    currently_matching_blocks = [matching_block for i, matching_block in
                                                 enumerate(currently_matching_blocks) if i not in already_added]

            if removed_line.trim_text == '':
                extended_blocks, not_extended_blocks = \
                    self.extend_matching_blocks_with_empty_removed_lines_if_possible(currently_matching_blocks)
                new_matching_blocks.extend(extended_blocks)
                currently_matching_blocks = not_extended_blocks

            for matching_block in currently_matching_blocks:
                detected_blocks.append(matching_block)

            currently_matching_blocks = new_matching_blocks
            new_matching_blocks = []

        for matching_block in currently_matching_blocks:
            detected_blocks.append(matching_block)

        detected_blocks = self.join_nearby_blocks(detected_blocks)
        filtered_blocks = self.filter_blocks(detected_blocks, min_lines_count)
        print(f'Detected {len(filtered_blocks)} blocks ({len(detected_blocks) - len(filtered_blocks)} filtered)')
        return filtered_blocks
