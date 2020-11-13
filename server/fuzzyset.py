import re
import math
import operator
import collections
import unittest

__version__ = (0, 0, 11)

_non_word_re = re.compile(r'[^\w, ]+')

__all__ = ('FuzzySet',)


class FuzzySet(object):
    def __init__(self, iterable=(), gram_size_lower=2, gram_size_upper=3):
        self.exact_set = {}
        self.match_dict = collections.defaultdict(list)
        self.items = {}
        self.gram_size_lower = gram_size_lower
        self.gram_size_upper = gram_size_upper
        for i in range(gram_size_lower, gram_size_upper + 1):
            self.items[i] = []
        for value in iterable:
            self.add(value)

    def add(self, value):
        lvalue = value.lower()
        if lvalue in self.exact_set:
            return False
        for i in range(self.gram_size_lower, self.gram_size_upper + 1):
            self.__add(value, i)

    def __add(self, value, gram_size):
        lvalue = value.lower()
        items = self.items[gram_size]
        idx = len(items)
        items.append(0)
        grams = _gram_counter(lvalue, gram_size)
        norm = math.sqrt(sum(x**2 for x in grams.values()))
        for gram, occ in grams.items():
            self.match_dict[gram].append((idx, occ))
        items[idx] = (norm, lvalue)
        self.exact_set[lvalue] = value

    def __getitem__(self, value):
        return self._getitem(value, exact_match_only=True, min_match_score=0.5)

    def _getitem(self, value, exact_match_only, min_match_score):
        lvalue = value.lower()
        exact_match = self.exact_set.get(lvalue)
        if exact_match_only and exact_match:
            return [(1, exact_match)]
        for i in range(self.gram_size_upper, self.gram_size_lower - 1, -1):
            results = self.__get(value, i, min_match_score)
            if exact_match:
                assert exact_match in [row for val, row in results]
            if results:
                return results
        raise KeyError(value)
    def __get(self, value, gram_size, min_match_score=0.5):
        lvalue = value.lower()
        matches = collections.defaultdict(float)
        grams = _gram_counter(lvalue, gram_size)
        items = self.items[gram_size]
        norm = math.sqrt(sum(x**2 for x in grams.values()))

        for gram, occ in grams.items():
            for idx, other_occ in self.match_dict.get(gram, ()):
                matches[idx] += occ * other_occ

        if not matches:
            return None

        # cosine similarity
        results = [(match_score / (norm * items[idx][0]), items[idx][1])
                   for idx, match_score in matches.items()]
        results.sort(reverse=True, key=operator.itemgetter(0))

        return [(score, self.exact_set[lval]) for score, lval in results
                if score >= min_match_score]

    def get(self, key, default=None, exact_match_only=True, min_match_score=0.5):
        try:
            return self._getitem(key, exact_match_only, min_match_score)
        except KeyError:
            return default

    def __nonzero__(self):
        return bool(self.exact_set)

    def __len__(self):
        return len(self.exact_set)


def _gram_counter(value, gram_size=2):
    result = collections.defaultdict(int)
    for value in _iterate_grams(value, gram_size):
        result[value] += 1
    return result


def _iterate_grams(value, gram_size=2):
    simplified = '-' + value + '-'
    len_diff = gram_size - len(simplified)
    if len_diff > 0:
        value += '-' * len_diff
    for i in range(len(simplified) - gram_size + 1):
        yield simplified[i:i + gram_size]


class FuzzySetTest(unittest.TestCase):

    def get_from_set(self, fuzzy_set, search_term, expected_rows, exact_match_only=False, min_match_score=0.5):
        rows = fuzzy_set.get(search_term, [], exact_match_only=exact_match_only, min_match_score=min_match_score)
        vals = [val for _, val in rows]
        self.assertEqual(expected_rows, vals)

    def test_simple(self):
        rows = [
            "Ala ma kota",
            "Ala ma psa",
            "Zuzia ma psa",
            "Zuzia ma kanarka"
        ]
        fuzzy_set = FuzzySet(rows)
        self.get_from_set(fuzzy_set, "ia ma psa", ["Zuzia ma psa", "Ala ma psa"])

    def test_fuzzy_set_return_all_matching_rows_even_when_exact_match_is_there(self):
        rows = [
            "Ala ma kota",
            "Ala ma kota.",
        ]
        fuzzy_set = FuzzySet(rows)
        self.get_from_set(fuzzy_set, "Ala ma kota", ["Ala ma kota"], exact_match_only=True)
        self.get_from_set(fuzzy_set, "Ala ma kota", ["Ala ma kota", "Ala ma kota."], exact_match_only=False)

    def test_fuzzy_set_works_well_for_short_words(self):
        rows = [
            "}",
            "{,",
            ",{",
            "a",
            "b",
            "c",
            "xyz",
            "xyzabc",
        ]
        fuzzy_set = FuzzySet(rows)
        self.get_from_set(fuzzy_set, "}", ["}"])
        self.get_from_set(fuzzy_set, "{", ["{,", ",{"], min_match_score=0.35)
        self.get_from_set(fuzzy_set, "{", [], min_match_score=0.5)
        self.get_from_set(fuzzy_set, "ab", [], min_match_score=0.5)
        self.get_from_set(fuzzy_set, "ab", ["a", "b"], min_match_score=0.35)
        self.get_from_set(fuzzy_set, "ab", ["a", "b"], min_match_score=0.35)
        self.get_from_set(fuzzy_set, "xy", ["xyz"], min_match_score=0.35)
        # TODO conclusion - use 0.35 for 1 or 2 sign words and 0.5 or more for rest
