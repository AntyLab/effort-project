import itertools
import re
import unittest
from textdiff import unified_diff


class TextDiffAcceptance(unittest.TestCase):
    def test_zero_context_ranges_at_start_end_and_empty(self):
        cases = [([], ["a"], "@@ -0,0 +1 @@\n+a\n"),
                 (["a"], [], "@@ -1 +0,0 @@\n-a\n"),
                 (["a"], ["a", "b"], "@@ -1,0 +2 @@\n+b\n"),
                 (["a", "b"], ["a"], "@@ -2 +1,0 @@\n-b\n"),
                 (["a"], ["b"], "@@ -1 +1 @@\n-a\n+b\n")]
        for before, after, expected in cases:
            with self.subTest(before=before, after=after):
                self.assertEqual(unified_diff(before, after, 0),
                                 "--- before\n+++ after\n" + expected)
        self.assertEqual(unified_diff([], []), "")
        self.assertEqual(unified_diff(["", "a"], ["", "a"]), "")
        with self.assertRaises(ValueError):
            unified_diff([], [], -1)

    def test_touching_context_merges_but_larger_gap_splits(self):
        self.assertEqual(unified_diff(["a", "b", "c", "d"], ["A", "b", "c", "D"], 1),
                         "--- before\n+++ after\n@@ -1,4 +1,4 @@\n-a\n+A\n b\n c\n-d\n+D\n")
        self.assertEqual(unified_diff(["a", "b", "c", "d", "e"],
                                     ["A", "b", "c", "d", "E"], 1),
                         "--- before\n+++ after\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n"
                         "@@ -4,2 +4,2 @@\n d\n-e\n+E\n")

    def test_lcs_tie_deletes_first_and_blank_lines_survive(self):
        self.assertEqual(unified_diff(["a", "b"], ["b", "a"], 0),
                         "--- before\n+++ after\n@@ -1 +0,0 @@\n-a\n@@ -2,0 +2 @@\n+a\n")
        self.assertEqual(unified_diff(["", "x", ""], ["", "y", ""], 1),
                         "--- before\n+++ after\n@@ -1,3 +1,3 @@\n \n-x\n+y\n \n")

    def assert_applies_minimally(self, before, after, context):
        original = list(before), list(after)
        output = unified_diff(before, after, context)
        self.assertEqual((before, after), original)
        if before == after:
            self.assertEqual(output, "")
            return
        self.assertTrue(output.endswith("\n"))
        lines = output.splitlines()
        self.assertEqual(lines[:2], ["--- before", "+++ after"])
        result = []
        cursor = edits = index = 0
        index = 2
        while index < len(lines):
            match = re.fullmatch(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", lines[index])
            self.assertIsNotNone(match)
            a, ac, b, bc = match.groups()
            ac, bc = int(ac or 1), int(bc or 1)
            start = int(a) - (ac != 0)
            self.assertGreaterEqual(start, cursor)
            result.extend(before[cursor:start])
            cursor = start
            self.assertEqual(len(result), int(b) - (bc != 0))
            old_count = new_count = 0
            index += 1
            while index < len(lines) and not lines[index].startswith("@@ "):
                tag, value = lines[index][0], lines[index][1:]
                self.assertIn(tag, " +-")
                if tag != "+":
                    self.assertLess(cursor, len(before))
                    self.assertEqual(before[cursor], value)
                    cursor += 1
                    old_count += 1
                if tag != "-":
                    result.append(value)
                    new_count += 1
                edits += tag != " "
                index += 1
            self.assertEqual((old_count, new_count), (ac, bc))
        result.extend(before[cursor:])
        self.assertEqual(result, after)
        # Independent oracle: enumerate subsequences rather than another DP.
        subsequences = {tuple(before[i] for i in range(len(before)) if mask & (1 << i))
                        for mask in range(1 << len(before))}
        longest = max(len(seq) for mask in range(1 << len(after))
                      if (seq := tuple(after[i] for i in range(len(after))
                                       if mask & (1 << i))) in subsequences)
        self.assertEqual(edits, len(before) + len(after) - 2 * longest)

    def test_repeated_lines_need_a_longest_subsequence(self):
        for context in (0, 1, 3):
            self.assert_applies_minimally(["a", "a", "a"], ["a", "b", "a", "a"], context)

    def test_small_repeated_inputs_apply_with_minimum_edits(self):
        samples = [[]] + [list(values) for n in range(1, 4)
                          for values in itertools.product(["a", "b"], repeat=n)]
        for i, before in enumerate(samples):
            for j, after in enumerate(samples):
                with self.subTest(before=before, after=after):
                    self.assert_applies_minimally(before, after, (i + j) % 3)
