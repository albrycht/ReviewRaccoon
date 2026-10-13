import unittest

from detector import MovedBlocksDetector, split_to_leading_whitespace_and_trim_text


def make_line_dict(file_name, line_no, text):
    leading_whitespace, trim_text = split_to_leading_whitespace_and_trim_text(text)
    return {
        "file": file_name,
        "line_no": line_no,
        "trim_text": trim_text,
        "leading_whitespaces": leading_whitespace,
    }


class AlignmentMovedBlocksDetectorTest(unittest.TestCase):
    def test_detects_moved_block_with_small_modifications(self):
        removed_lines = [
            make_line_dict("removed.py", 1, "alpha beta gamma one"),
            make_line_dict("removed.py", 2, "delta epsilon zeta two"),
            make_line_dict("removed.py", 3, "eta theta iota three"),
        ]
        added_lines = [
            make_line_dict("added.py", 20, "prefix should not match"),
            make_line_dict("added.py", 21, "alpha beta gamma one!"),
            make_line_dict("added.py", 22, "delta epsilon zeta two!"),
            make_line_dict("added.py", 23, "eta theta iota three!"),
        ]

        detector = MovedBlocksDetector.from_changed_lines(
            removed_lines, added_lines, detector_mode="alignment"
        )
        blocks = detector.detect_moved_blocks(min_lines_count=2)

        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].first_removed_line.line_no, 1)
        self.assertEqual(blocks[0].last_removed_line.line_no, 3)
        self.assertEqual(blocks[0].first_added_line.line_no, 21)
        self.assertEqual(blocks[0].last_added_line.line_no, 23)

    def test_detects_reflow_from_one_line_to_two_lines(self):
        removed_lines = [
            make_line_dict("removed.py", 1, "alpha beta gamma delta epsilon zeta"),
            make_line_dict("removed.py", 2, "tail marker line"),
        ]
        added_lines = [
            make_line_dict("added.py", 10, "alpha beta gamma"),
            make_line_dict("added.py", 11, "delta epsilon zeta"),
            make_line_dict("added.py", 12, "tail marker line"),
        ]

        detector = MovedBlocksDetector.from_changed_lines(
            removed_lines, added_lines, detector_mode="alignment"
        )
        blocks = detector.detect_moved_blocks(min_lines_count=2)

        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].first_removed_line.line_no, 1)
        self.assertEqual(blocks[0].last_removed_line.line_no, 2)
        self.assertEqual(blocks[0].first_added_line.line_no, 10)
        self.assertEqual(blocks[0].last_added_line.line_no, 12)
        self.assertGreaterEqual(blocks[0].line_count(), 2)

    def test_overlap_resolution_prefers_higher_confidence_block(self):
        removed_lines = [
            make_line_dict("src.py", 1, "one alpha"),
            make_line_dict("src.py", 2, "two beta"),
            make_line_dict("src.py", 3, "three gamma"),
            make_line_dict("src.py", 4, "four delta"),
        ]
        added_lines = [
            make_line_dict("dst_full.py", 10, "one alpha"),
            make_line_dict("dst_full.py", 11, "two beta"),
            make_line_dict("dst_full.py", 12, "three gamma"),
            make_line_dict("dst_full.py", 13, "four delta"),
            make_line_dict("dst_partial.py", 30, "one alpha"),
            make_line_dict("dst_partial.py", 31, "two beta"),
            make_line_dict("dst_partial.py", 32, "three gamma"),
        ]

        detector = MovedBlocksDetector.from_changed_lines(
            removed_lines, added_lines, detector_mode="alignment"
        )
        blocks = detector.detect_moved_blocks(min_lines_count=2)

        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0].file_added, "dst_full.py")
        self.assertEqual(blocks[0].first_removed_line.line_no, 1)
        self.assertEqual(blocks[0].last_removed_line.line_no, 4)

