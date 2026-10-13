import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher

from detector import Line, MatchingBlock, MatchingLine, diff_to_added_and_removed_lines
from time_utils import measure_fun_time

logger = logging.getLogger(__name__)

_WHITESPACE_RE = re.compile(r"\s+")
_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[^\sA-Za-z0-9_]")


@dataclass(frozen=True)
class StreamToken:
    token: str
    line: Line


@dataclass
class AlignmentCandidate:
    removed_file: str
    added_file: str
    removed_start: int
    removed_end: int
    added_start: int
    added_end: int
    score: float
    matched_pairs: list[tuple[int, int]]


class LocalAlignmentMovedBlocksDetector:
    # Runtime guard: max DP matrix cells per removed/added file pair.
    # Increase -> higher recall on very large moves, but slower and more memory-hungry.
    # Decrease -> faster/safer runtime, but large file-pairs may be skipped early.
    # Practical range: ~500_000 to 10_000_000.
    MAX_ALIGNMENT_CELLS_PER_PAIR = 2_000_000

    # Max local alignments extracted per file pair before stopping.
    # Increase -> finds more secondary/fragmented moves, but may add noisy candidates.
    # Decrease -> cleaner/faster output, but can miss additional moved fragments.
    # Practical range: 3 to 20.
    MAX_ALIGNMENT_CANDIDATES_PER_PAIR = 8

    # Minimum Smith-Waterman best score to accept a candidate.
    # Increase -> better precision, lower recall (short/edited moves dropped).
    # Decrease -> better recall, but more weak/accidental matches.
    # Practical range: 4.0 to 20.0.
    MIN_ALIGNMENT_SCORE = 8.0

    # Minimum count of matched token pairs in traceback.
    # Increase -> suppresses tiny/noisy alignments, but misses short valid moves.
    # Decrease -> catches short moves, but increases false positives.
    # Practical range: 2 to 12.
    MIN_TOKEN_MATCHES = 4

    # Per-line similarity threshold when building final block line pairs.
    # Increase -> stricter line acceptance, cleaner blocks with fewer edited lines.
    # Decrease -> keeps more heavily edited lines, but can admit weak line links.
    # Practical range: 0.20 to 0.80.
    MIN_LINE_SIMILARITY = 0.32

    # Gap penalty for insertions/deletions in alignment (must stay <= 0).
    # More negative -> discourages gaps, favors contiguous matches.
    # Closer to 0 -> tolerates reflow/insertions, but can over-bridge unrelated text.
    # Practical range: -2.0 to -0.1.
    GAP_PENALTY = -0.6

    # Penalty for token mismatch on diagonal transition (must stay <= 0).
    # More negative -> stricter token equality, higher precision/lower recall.
    # Closer to 0 -> accepts edited tokens more easily, but noisier matches.
    # Practical range: -3.0 to -0.1.
    MISMATCH_PENALTY = -0.9

    # Reward for exact token match on diagonal transition (> 0).
    # Increase -> exact token runs dominate scoring; can overshadow edits.
    # Decrease -> less preference for exact runs; may need lower MIN_ALIGNMENT_SCORE.
    # Practical range: 0.5 to 5.0.
    MATCH_SCORE = 2.0

    def __init__(self, removed_lines_dicts, added_lines_dicts):
        self.removed_lines_by_file = self._group_lines_by_file(removed_lines_dicts)
        self.added_lines_by_file = self._group_lines_by_file(added_lines_dicts)
        self.removed_streams = {
            file_name: self._build_stream(lines)
            for file_name, lines in self.removed_lines_by_file.items()
        }
        self.added_streams = {
            file_name: self._build_stream(lines)
            for file_name, lines in self.added_lines_by_file.items()
        }
        self._line_similarity_cache: dict[tuple[str, str], float] = {}

    @staticmethod
    def _group_lines_by_file(lines_dicts):
        lines_by_file = defaultdict(list)
        for line_dict in lines_dicts:
            line = Line.from_dict(line_dict)
            lines_by_file[line.file].append(line)
        for line_list in lines_by_file.values():
            line_list.sort(key=lambda line: line.line_no)
        return lines_by_file

    @staticmethod
    def _normalize_text(text):
        return _WHITESPACE_RE.sub(" ", text.strip())

    def _build_stream(self, lines):
        stream_tokens = []
        for line in lines:
            normalized_text = self._normalize_text(line.trim_text)
            if not normalized_text:
                continue
            for token in _TOKEN_RE.findall(normalized_text):
                stream_tokens.append(StreamToken(token=token, line=line))
        return stream_tokens

    @staticmethod
    def from_diff(diff_text):
        parsed = diff_to_added_and_removed_lines(diff_text)
        return LocalAlignmentMovedBlocksDetector(
            parsed["removed_lines"], parsed["added_lines"]
        )

    @staticmethod
    def _ranges_overlap(start1, end1, start2, end2):
        return not (end1 < start2 or end2 < start1)

    @measure_fun_time()
    def _extract_alignment_candidates_for_file_pair(self, removed_file, added_file):
        removed_stream = self.removed_streams.get(removed_file, [])
        added_stream = self.added_streams.get(added_file, [])
        if not removed_stream or not added_stream:
            return []

        blocked_removed_indexes = set()
        blocked_added_indexes = set()
        candidates: list[AlignmentCandidate] = []

        for _ in range(self.MAX_ALIGNMENT_CANDIDATES_PER_PAIR):
            active_removed_indexes = [
                idx
                for idx in range(len(removed_stream))
                if idx not in blocked_removed_indexes
            ]
            active_added_indexes = [
                idx for idx in range(len(added_stream)) if idx not in blocked_added_indexes
            ]

            if not active_removed_indexes or not active_added_indexes:
                break

            cells_count = len(active_removed_indexes) * len(active_added_indexes)
            if cells_count > self.MAX_ALIGNMENT_CELLS_PER_PAIR:
                logger.info(
                    "Skipping alignment for file-pair %s -> %s because %s cells exceed %s",
                    removed_file,
                    added_file,
                    cells_count,
                    self.MAX_ALIGNMENT_CELLS_PER_PAIR,
                )
                break

            score_matrix, traceback_matrix, best_score, best_position = (
                self._build_smith_waterman_matrices(
                    removed_stream,
                    added_stream,
                    active_removed_indexes,
                    active_added_indexes,
                )
            )

            if best_score < self.MIN_ALIGNMENT_SCORE:
                break

            matched_pairs = self._traceback_matched_pairs(
                score_matrix,
                traceback_matrix,
                best_position,
                removed_stream,
                added_stream,
                active_removed_indexes,
                active_added_indexes,
            )
            if len(matched_pairs) < self.MIN_TOKEN_MATCHES:
                break

            removed_line_numbers = [
                removed_stream[removed_idx].line.line_no
                for removed_idx, _ in matched_pairs
            ]
            added_line_numbers = [
                added_stream[added_idx].line.line_no for _, added_idx in matched_pairs
            ]

            candidate = AlignmentCandidate(
                removed_file=removed_file,
                added_file=added_file,
                removed_start=min(removed_line_numbers),
                removed_end=max(removed_line_numbers),
                added_start=min(added_line_numbers),
                added_end=max(added_line_numbers),
                score=best_score,
                matched_pairs=matched_pairs,
            )
            candidates.append(candidate)

            for removed_idx, added_idx in matched_pairs:
                blocked_removed_indexes.add(removed_idx)
                blocked_added_indexes.add(added_idx)

        return candidates

    def _build_smith_waterman_matrices(
        self,
        removed_stream,
        added_stream,
        active_removed_indexes,
        active_added_indexes,
    ):
        rows_count = len(active_removed_indexes) + 1
        cols_count = len(active_added_indexes) + 1
        score_matrix = [[0.0] * cols_count for _ in range(rows_count)]
        traceback_matrix = [[0] * cols_count for _ in range(rows_count)]
        best_score = 0.0
        best_position = (0, 0)

        for row_index in range(1, rows_count):
            removed_token = removed_stream[active_removed_indexes[row_index - 1]].token
            for col_index in range(1, cols_count):
                added_token = added_stream[active_added_indexes[col_index - 1]].token
                similarity_score = (
                    self.MATCH_SCORE
                    if removed_token == added_token
                    else self.MISMATCH_PENALTY
                )
                diagonal_score = (
                    score_matrix[row_index - 1][col_index - 1] + similarity_score
                )
                up_score = score_matrix[row_index - 1][col_index] + self.GAP_PENALTY
                left_score = score_matrix[row_index][col_index - 1] + self.GAP_PENALTY
                best_cell_score = max(0.0, diagonal_score, up_score, left_score)

                score_matrix[row_index][col_index] = best_cell_score
                if best_cell_score == 0:
                    traceback_matrix[row_index][col_index] = 0
                elif best_cell_score == diagonal_score:
                    traceback_matrix[row_index][col_index] = 1
                elif best_cell_score == up_score:
                    traceback_matrix[row_index][col_index] = 2
                else:
                    traceback_matrix[row_index][col_index] = 3

                if best_cell_score > best_score:
                    best_score = best_cell_score
                    best_position = (row_index, col_index)

        return score_matrix, traceback_matrix, best_score, best_position

    def _traceback_matched_pairs(
        self,
        score_matrix,
        traceback_matrix,
        best_position,
        removed_stream,
        added_stream,
        active_removed_indexes,
        active_added_indexes,
    ):
        row_index, col_index = best_position
        matched_pairs_reversed = []

        while row_index > 0 and col_index > 0 and score_matrix[row_index][col_index] > 0:
            move = traceback_matrix[row_index][col_index]
            if move == 1:
                removed_idx = active_removed_indexes[row_index - 1]
                added_idx = active_added_indexes[col_index - 1]
                if removed_stream[removed_idx].token == added_stream[added_idx].token:
                    matched_pairs_reversed.append((removed_idx, added_idx))
                row_index -= 1
                col_index -= 1
            elif move == 2:
                row_index -= 1
            elif move == 3:
                col_index -= 1
            else:
                break

        return list(reversed(matched_pairs_reversed))

    def _line_similarity(self, removed_line, added_line):
        removed_text = self._normalize_text(removed_line.trim_text)
        added_text = self._normalize_text(added_line.trim_text)
        cache_key = (removed_text, added_text)
        cached_similarity = self._line_similarity_cache.get(cache_key)
        if cached_similarity is not None:
            return cached_similarity
        similarity = SequenceMatcher(a=removed_text, b=added_text).ratio()
        self._line_similarity_cache[cache_key] = similarity
        return similarity

    def _candidate_to_block(self, candidate):
        removed_stream = self.removed_streams.get(candidate.removed_file, [])
        added_stream = self.added_streams.get(candidate.added_file, [])
        if not removed_stream or not added_stream:
            return None, 0.0

        line_pair_weights = defaultdict(int)
        ordered_line_pairs: list[tuple[Line, Line, float]] = []
        last_line_pair_key = None
        for removed_idx, added_idx in candidate.matched_pairs:
            removed_line = removed_stream[removed_idx].line
            added_line = added_stream[added_idx].line
            line_pair_weights[(removed_line.line_no, added_line.line_no)] += 1

            pair_key = (removed_line.line_no, added_line.line_no)
            if pair_key == last_line_pair_key:
                continue
            last_line_pair_key = pair_key
            overlap_bonus = min(1.0, line_pair_weights[pair_key] / 4.0)
            similarity = self._line_similarity(removed_line, added_line)
            match_probability = max(
                0.0,
                min(1.0, similarity * 0.75 + overlap_bonus * 0.25),
            )
            if match_probability < self.MIN_LINE_SIMILARITY:
                continue
            ordered_line_pairs.append((removed_line, added_line, match_probability))

        if not ordered_line_pairs:
            return None, 0.0

        block = MatchingBlock.from_line(
            ordered_line_pairs[0][0],
            ordered_line_pairs[0][1],
            ordered_line_pairs[0][2],
        )
        block.lines = [
            MatchingLine(removed_line, added_line, match_probability)
            for removed_line, added_line, match_probability in ordered_line_pairs
        ]
        block.first_removed_line = ordered_line_pairs[0][0]
        block.first_added_line = ordered_line_pairs[0][1]
        block.last_removed_line = ordered_line_pairs[-1][0]
        block.last_added_line = ordered_line_pairs[-1][1]
        block.removed_lines_numbers = {line.line_no for line, _, _ in ordered_line_pairs}
        block.added_lines_numbers = {line.line_no for _, line, _ in ordered_line_pairs}

        removed_line_best_scores = {}
        added_line_best_scores = {}
        unique_pair_keys = set()
        char_count = 0
        weighted_chars_count = 0.0
        for removed_line, added_line, match_probability in ordered_line_pairs:
            removed_score = removed_line_best_scores.get(removed_line.line_no, 0.0)
            if not removed_line.is_empty() and match_probability > removed_score:
                removed_line_best_scores[removed_line.line_no] = match_probability
            added_score = added_line_best_scores.get(added_line.line_no, 0.0)
            if not added_line.is_empty() and match_probability > added_score:
                added_line_best_scores[added_line.line_no] = match_probability

            pair_key = (removed_line.line_no, added_line.line_no)
            if pair_key in unique_pair_keys:
                continue
            unique_pair_keys.add(pair_key)
            pair_char_count = removed_line.trim_text_len + added_line.trim_text_len
            char_count += pair_char_count
            weighted_chars_count += pair_char_count * match_probability

        # Count informative lines symmetrically so one-to-many reflow can pass
        # min-lines filtering without inflating repeated line pairs.
        block.not_empty_lines = max(
            len(removed_line_best_scores), len(added_line_best_scores)
        )
        block.weighted_lines_count = float(block.not_empty_lines)
        block.char_count = char_count
        block.weighted_chars_count = weighted_chars_count
        block.match_density = (
            block.weighted_chars_count / block.char_count if block.char_count else 0.0
        )
        return block, candidate.score + block.weighted_chars_count

    @measure_fun_time()
    def _select_non_overlapping_blocks(self, scored_blocks):
        selected_blocks = []
        selected_ranges = []

        scored_blocks.sort(
            key=lambda pair: (
                -pair[1],
                -(pair[0].last_removed_line.line_no - pair[0].first_removed_line.line_no),
                -(pair[0].last_added_line.line_no - pair[0].first_added_line.line_no),
                pair[0].file_removed,
                pair[0].file_added,
                pair[0].first_removed_line.line_no,
                pair[0].first_added_line.line_no,
            )
        )

        for block, score in scored_blocks:
            has_conflict = False
            block_removed_range = (
                block.file_removed,
                block.first_removed_line.line_no,
                block.last_removed_line.line_no,
            )
            block_added_range = (
                block.file_added,
                block.first_added_line.line_no,
                block.last_added_line.line_no,
            )

            for selected in selected_ranges:
                selected_removed_range = selected["removed"]
                selected_added_range = selected["added"]
                removed_conflict = (
                    block_removed_range[0] == selected_removed_range[0]
                    and self._ranges_overlap(
                        block_removed_range[1],
                        block_removed_range[2],
                        selected_removed_range[1],
                        selected_removed_range[2],
                    )
                )
                added_conflict = (
                    block_added_range[0] == selected_added_range[0]
                    and self._ranges_overlap(
                        block_added_range[1],
                        block_added_range[2],
                        selected_added_range[1],
                        selected_added_range[2],
                    )
                )
                if removed_conflict or added_conflict:
                    has_conflict = True
                    break
            if has_conflict:
                continue

            selected_blocks.append((block, score))
            selected_ranges.append({"removed": block_removed_range, "added": block_added_range})

        selected_blocks.sort(
            key=lambda pair: (
                pair[0].file_removed,
                pair[0].first_removed_line.line_no,
                pair[0].file_added,
                pair[0].first_added_line.line_no,
            )
        )
        return [block for block, _ in selected_blocks]

    def _filter_out_small_blocks(self, matching_blocks, min_lines_count):
        return [
            block
            for block in matching_blocks
            if block.weighted_lines_count >= min_lines_count and block.char_count >= 20
        ]

    @measure_fun_time()
    def detect_moved_blocks(self, min_lines_count=None):
        if min_lines_count is None:
            min_lines_count = 2

        scored_blocks = []
        removed_files = sorted(self.removed_lines_by_file.keys())
        added_files = sorted(self.added_lines_by_file.keys())
        for removed_file in removed_files:
            for added_file in added_files:
                candidates = self._extract_alignment_candidates_for_file_pair(
                    removed_file, added_file
                )
                for candidate in candidates:
                    block, block_score = self._candidate_to_block(candidate)
                    if block is None:
                        continue
                    scored_blocks.append((block, block_score))

        selected_blocks = self._select_non_overlapping_blocks(scored_blocks)
        filtered_blocks = self._filter_out_small_blocks(selected_blocks, min_lines_count)
        logger.info(
            "Alignment detector found %s blocks (%s filtered)",
            len(filtered_blocks),
            len(selected_blocks) - len(filtered_blocks),
        )
        return filtered_blocks
