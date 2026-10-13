import json
import time
import unittest
from pathlib import Path

from detector import MovedBlocksDetector, split_to_leading_whitespace_and_trim_text

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "alignment_benchmark_cases.json"


def _make_line_dict(raw_line):
    leading_whitespace, trim_text = split_to_leading_whitespace_and_trim_text(
        raw_line["text"]
    )
    return {
        "file": raw_line["file"],
        "line_no": raw_line["line_no"],
        "trim_text": trim_text,
        "leading_whitespaces": leading_whitespace,
    }


def _blocks_signature(blocks):
    return [
        (
            block.file_removed,
            block.first_removed_line.line_no,
            block.last_removed_line.line_no,
            block.file_added,
            block.first_added_line.line_no,
            block.last_added_line.line_no,
            round(block.weighted_lines_count, 5),
        )
        for block in blocks
    ]


class AlignmentBenchmarkFixtureTest(unittest.TestCase):
    def test_alignment_fixture_suite_is_deterministic_and_fast_enough(self):
        with FIXTURE_PATH.open() as fixture_file:
            cases = json.load(fixture_file)

        total_duration = 0.0
        for case in cases:
            removed_lines = [_make_line_dict(line) for line in case["removed"]]
            added_lines = [_make_line_dict(line) for line in case["added"]]
            min_lines_count = case.get("min_lines_count", 2)

            detector = MovedBlocksDetector.from_changed_lines(
                removed_lines, added_lines, detector_mode="alignment"
            )
            start = time.perf_counter()
            first_result = detector.detect_moved_blocks(min_lines_count=min_lines_count)
            duration = time.perf_counter() - start
            total_duration += duration

            detector = MovedBlocksDetector.from_changed_lines(
                removed_lines, added_lines, detector_mode="alignment"
            )
            second_result = detector.detect_moved_blocks(min_lines_count=min_lines_count)

            self.assertEqual(
                len(first_result),
                case["expected_blocks"],
                f"Unexpected block count for fixture '{case['name']}'",
            )
            self.assertEqual(
                _blocks_signature(first_result),
                _blocks_signature(second_result),
                f"Non-deterministic output for fixture '{case['name']}'",
            )
            self.assertLess(
                duration,
                1.0,
                f"Fixture '{case['name']}' took too long ({duration:.4f}s)",
            )

        self.assertLess(total_duration, 8.0)

