import unittest
from textdiff import unified_diff


class TextDiffTest(unittest.TestCase):
    def test_insertion_keeps_matching_suffix(self):
        self.assertEqual(unified_diff(["a", "b"], ["a", "x", "b"], 1),
                         "--- before\n+++ after\n@@ -1,2 +1,3 @@\n a\n+x\n b\n")

    def test_empty_old_range(self):
        self.assertEqual(unified_diff([], ["new"], 0),
                         "--- before\n+++ after\n@@ -0,0 +1 @@\n+new\n")
