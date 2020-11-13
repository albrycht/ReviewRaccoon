import unittest

from detector import Line, MatchingBlock, MovedBlocksDetector, \
    split_to_leading_whitespace_and_trim_text


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

    def test_extend_matching_block_with_new_line(self):
        file1 = "some_file"
        file2 = "some_file2"
        removed_line_1 = Line(file1, 2, "some_text")
        added_line_1 = Line(file2, 12, "some_text")
        matching_block = MatchingBlock.from_line(removed_line_1, added_line_1)
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
        matching_block = MatchingBlock.from_line(removed_line_1, added_line_1)
        removed_line_2 = Line("file_with_removed_lines", 2, "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2")
        added_line_2 = Line("file_with_added_lines", 13, "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2")
        extended = matching_block.try_extend_with_line(removed_line_2, added_line_2)
        self.assertEqual(extended, True)
        self.assertEqual(matching_block.last_removed_line.line_no, 2)
        self.assertEqual(matching_block.last_added_line.line_no, 13)
        self.assertEqual(len(matching_block.lines), 2)


class ChangedLines(object):
    def __init__(self, file, line_no_to_text):
        super()
        self.file = file
        self.line_no_to_text = line_no_to_text

    def to_lines_dicts(self):
        result = []
        for line_no, text in self.line_no_to_text.items():
            leading_whitespace, trim_text = split_to_leading_whitespace_and_trim_text(text)
            result.append({
                'file': self.file,
                'line_no': line_no,
                'trim_text': trim_text,
                'leading_whitespaces': leading_whitespace,
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

    def test_detect_block_with_changed_indentation(self):
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
            12: "   1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            13: "   2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            14: "   3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            15: "   4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            16: "-------------------------------------------",
        })
    
        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts());
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 12)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 4)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 15)
        self.assertEqual(detected_blocks[0].line_count(), 4)
        self.assertEqual(detected_blocks[0].char_count(), 4 * 43)
        
    def test_do_not_merge_block_with_inconsistent_changed_indentation(self):
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
            12: "   1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            13: "   2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            14: "      3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            15: "      4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            16: "-------------------------------------------",
        })
    
        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].first_removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].first_added_line.line_no, 12)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 4)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 15)
        self.assertEqual(detected_blocks[0].line_count(), 4)
        self.assertEqual(detected_blocks[0].char_count(), 4 * 43)

    def test_remove_lines_add_it_many_times(self):
        removed_file = "file_with_removed_lines"
        added_file = "file_with_added_lines"
        removed_lines = ChangedLines(removed_file, {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
        })

        added_lines = ChangedLines(added_file, {
            10: "-------------------------------------------",
            11: "-------------------------------------------",
            12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            14: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            15: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            16: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            17: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 3)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 2)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 12)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 13)
        self.assertEqual(detected_blocks[0].line_count(), 2)

        self.assertEqual(detected_blocks[1].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[1].last_removed_line.line_no, 2)
        self.assertEqual(detected_blocks[1].lines[0].added_line.line_no, 14)
        self.assertEqual(detected_blocks[1].last_added_line.line_no, 15)
        self.assertEqual(detected_blocks[1].line_count(), 2)

        self.assertEqual(detected_blocks[2].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[2].last_removed_line.line_no, 2)
        self.assertEqual(detected_blocks[2].lines[0].added_line.line_no, 16)
        self.assertEqual(detected_blocks[2].last_added_line.line_no, 17)
        self.assertEqual(detected_blocks[2].line_count(), 2)

    def test_filer_out_small_blocks(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1",
            2: "2 2 2",
        })

        added_lines = ChangedLines("file_with_added_lines", {
            11: "1 1 1",
            12: "2 2 2",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 0)

    def test_small_changes_are_allowed_in_moved_block(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
        })

        added_lines = ChangedLines("file_with_added_lines", {
            11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1--",
            12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2--",
            13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3--",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].line_count(), 3)

    def test_check_starfish_ansible_code_moved(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
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
        })

        added_lines = ChangedLines("file_with_added_lines", {
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
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)

        # for (detected_block of detected_blocks) {
        #   line0 = detected_block.lines[0];
        #   console.log(`Removed: ${line0.removed_line.line_no}-${detected_block.last_removed_line.line_no}   ` +
        #               `Added: ${line0.added_line.line_no}-${detected_block.last_added_line.line_no}`);
        # }
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 4)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 19)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 17)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 32)
        self.assertEqual(detected_blocks[0].line_count(), 15)

    def test_whitespace_line_do_not_break_matching_block(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "   ",
            5: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            6: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
        })

        added_lines = ChangedLines("file_with_added_lines", {
            10: "-------------------------------------------",
            11: "-------------------------------------------",
            12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            13: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            14: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            15: "   ",
            16: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            17: "-------------------------------------------",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 5)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 12)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 16)
        self.assertEqual(detected_blocks[0].line_count(), 4)
        self.assertEqual(detected_blocks[0].char_count(), 4 * 43)
        
    def test_matching_block_should_contain_at_least_2_not_empty_lines(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "   ",
            3: "   ",
        })
    
        added_lines = ChangedLines("file_with_added_lines", {
            12: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            13: "   ",
            14: "   ",
        })
    
        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 0)

    def test_empty_lines_do_not_break_matching_block(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
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
        })

        added_lines = ChangedLines("file_with_added_lines", {
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
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts());
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 13)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 11)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 23)
        self.assertEqual(len(detected_blocks[0].lines), 13)

    def test_adding_empty_lines_do_not_break_matching_block(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
        })

        added_lines = ChangedLines("file_with_added_lines", {
            11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            14: "   ",
            15: "",
            16: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            17: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 5)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 11)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 17)
        self.assertEqual(len(detected_blocks[0].lines), 7)
        self.assertEqual(detected_blocks[0].line_count(), 5)

    def test_removing_empty_lines_do_not_break_matching_block(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "   ",
            5: "",
            6: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            7: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5"
        })

        added_lines = ChangedLines("file_with_added_lines", {
            11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            14: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            15: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 7)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 11)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 15)
        self.assertEqual(len(detected_blocks[0].lines), 7)
        self.assertEqual(detected_blocks[0].line_count(), 5)

    def test_join_block_with_removed_lines_between(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
            6: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
            7: "7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7",
            8: "8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8",
            
        })

        added_lines = ChangedLines("file_with_added_lines", {
            11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            14: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
            15: "7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7",
            16: "8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 8)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 11)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 16)
        self.assertEqual(len(detected_blocks[0].lines), 6)  # fix (lines between blocks)
        self.assertEqual(detected_blocks[0].line_count(), 6)


    def test_remove_empty_lines_from_end_of_a_block(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
            6: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
        })

        added_lines = ChangedLines("file_with_added_lines", {
            11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            14: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            15: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
            16: "",
            17: "",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 5)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 11)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 15)
        self.assertEqual(len(detected_blocks[0].lines), 5)
        self.assertEqual(detected_blocks[0].line_count(), 5)

    def test_do_not_detect_blocks_that_are_inside_other_larger_blocks(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            5: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            6: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            7: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            8: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            9: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
        })

        added_lines = ChangedLines("file_with_added_lines", {
            11: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            12: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            13: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            14: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            15: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            16: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            17: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            18: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            19: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 9)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 11)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 19)
        self.assertEqual(len(detected_blocks[0].lines), 9)
        self.assertEqual(detected_blocks[0].line_count(), 9)

    def test_do_not_detect_blocks_that_are_inside_other_larger_blocks_VER_2(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
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
        })
    
        added_lines = ChangedLines("file_with_added_lines", {
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
        })
    
        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].lines[0].removed_line.line_no, 12)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 27)
        self.assertEqual(detected_blocks[0].lines[0].added_line.line_no, 54)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 69)
        self.assertEqual(len(detected_blocks[0].lines), 16)
        self.assertEqual(detected_blocks[0].line_count(), 14)

    def test_schedule_not_detected(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: '[',
            2: '  {',
            3: '    "name": "Volume Stats",',
            4: '    "report_id": "stats",',
            5: '    "report_sql_filename": "stats.sql",',
            6: '    "redash_query_sql_filename": "stats_redash_query.sql",',
            7: '    "schedule": 43200,',
            8: '    "dashboard": "Volume Global Analytics"',
            9: '  },',
            10: '  {',
            11: '    "name": "Growth of Volume over Time",',
            12: '    "report_id": "growth_of_volume_over_time",',
        })
        added_lines = ChangedLines("file_with_added_lines", {
            1: '[',
            2: '  {',
            3: '    "name": "Volume Stats",',
            4: '    "report_id": "stats",',
            5: '    "redash_query_sql_filename": "Volume_Global_Analytics/stats_redash_query.sql",',
            6: '    "schedule": 43200',
            7: '  },',
            8: '  {',
            9: '    "name": "Growth of Volume over Time",',
            10: '    "report_id": "growth_of_volume_over_time",',
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 1)
        self.assertEqual(detected_blocks[0].first_removed_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_removed_line.line_no, 12)
        self.assertEqual(detected_blocks[0].first_added_line.line_no, 1)
        self.assertEqual(detected_blocks[0].last_added_line.line_no, 10)
        self.assertEqual(detected_blocks[0].lines[5].removed_line.trim_text, '"schedule": 43200,')
        for line in detected_blocks[0].lines:
            print("---------")
            print(f"Removed line({line.removed_line.line_no}): {line.removed_line.trim_text}")
            print(f"Added line({line.added_line.line_no}): {line.added_line.trim_text}")

    def test_smaller_overlapping_block_is_better(self):
        removed_lines = ChangedLines("file_with_removed_lines", {
            1: "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1",
            2: "2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2",
            3: "3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3 3",
            4: "4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4 4",
            5: "5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5 5",
            6: "6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6 6",
            7: "7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 1 1 1 1 1",   # <- notice 1 1 1 at the end
            8: "8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 1 1 1 1 1",
            9: "9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 1 1 1 1 1",
        })
        added_lines1 = ChangedLines("file_with_added_lines", {
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

        added_lines2 = ChangedLines("file_with_added_lines2", {
            7: "7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 7 1 1 1 1 1",
            8: "8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 8 1 1 1 1 1",
            9: "9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 1 1 1 1 1",
        })

        detector = MovedBlocksDetector(removed_lines.to_lines_dicts(), added_lines1.to_lines_dicts() + added_lines2.to_lines_dicts())
        detected_blocks = detector.detect_moved_blocks()
        self.assertEqual(len(detected_blocks), 2)
        # self.assertEqual(detected_blocks[0].first_removed_line.line_no, 1)
        # self.assertEqual(detected_blocks[0].last_removed_line.line_no, 12)
        # self.assertEqual(detected_blocks[0].first_added_line.line_no, 1)
        # self.assertEqual(detected_blocks[0].last_added_line.line_no, 10)