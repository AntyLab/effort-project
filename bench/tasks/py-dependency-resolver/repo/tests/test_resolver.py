import unittest
from resolver import resolve


class ResolverTest(unittest.TestCase):
    def test_numeric_versions_and_dependency_first(self):
        catalog = {"app": {"1.0.0": {"lib": ">=1.0.0"}},
                   "lib": {"1.9.0": {}, "1.10.0": {}}}
        self.assertEqual(resolve(catalog, {"app": ""}),
                         [("lib", "1.10.0"), ("app", "1.0.0")])

    def test_new_constraint_can_force_an_earlier_choice_down(self):
        catalog = {"a": {"1.0.0": {}, "2.0.0": {}},
                   "z": {"1.0.0": {"a": "<2.0.0"}}}
        self.assertEqual(resolve(catalog, {"z": "", "a": ""}),
                         [("a", "1.0.0"), ("z", "1.0.0")])
