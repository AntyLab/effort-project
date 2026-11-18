import copy
import unittest
from resolver import ResolutionError, resolve


class ResolverAcceptance(unittest.TestCase):
    def test_diamond_needs_backtracking_and_discards_abandoned_dependencies(self):
        catalog = {
            "app": {"2.0.0": {"a": "", "z": "", "unused": ""},
                    "1.0.0": {"a": "", "z": "==1.0.0"}},
            "a": {"1.0.0": {"shared": ">=1.0.0,<2.0.0"},
                  "2.0.0": {"shared": ">=2.0.0"}},
            "z": {"1.0.0": {"shared": "<2.0.0"},
                  "2.0.0": {"shared": ">=3.0.0"}},
            "shared": {"1.5.0": {}, "2.0.0": {}},
            "unused": {"1.0.0": {"missing": ""}},
            "irrelevant": {"9.0.0": {"irrelevant": ""}},
        }
        original = copy.deepcopy(catalog)
        self.assertEqual(resolve(catalog, {"app": ""}),
                         [("shared", "1.5.0"), ("a", "1.0.0"),
                          ("z", "1.0.0"), ("app", "1.0.0")])
        self.assertEqual(catalog, original)

    def test_cycle_is_rejected_but_a_lower_acyclic_version_is_usable(self):
        catalog = {"a": {"2.0.0": {"b": ""}, "1.0.0": {}},
                   "b": {"1.0.0": {"a": ""}}}
        self.assertEqual(resolve(catalog, {"a": ""}), [("a", "1.0.0")])
        for roots in [{"a": ">=2.0.0"}, {"missing": ""}]:
            with self.subTest(roots=roots):
                with self.assertRaises(ResolutionError):
                    resolve(catalog, roots)
        with self.assertRaises(ResolutionError):
            resolve({"a": {"1.0.0": {"a": ""}}}, {"a": ""})

    def test_all_operators_and_numeric_highest_version(self):
        catalog = {"lib": {v: {} for v in ["1.2.9", "1.9.0", "1.10.0", "2.0.0"]}}
        for constraint, version in [(">1.9.0, <=1.10.0", "1.10.0"),
                                    ("==1.2.9", "1.2.9"), (">=1.0.0,<2.0.0", "1.10.0"),
                                    (">=1.2.9,<1.9.0", "1.2.9"), ("", "2.0.0")]:
            with self.subTest(constraint=constraint):
                self.assertEqual(resolve(catalog, {"lib": constraint}), [("lib", version)])
        with self.assertRaises(ResolutionError):
            resolve(catalog, {"lib": ">2.0.0"})

    def test_topological_order_uses_alphabetically_first_ready_name(self):
        catalog = {"z": {"1.0.0": {"b": ""}}, "b": {"1.0.0": {}},
                   "a": {"1.0.0": {}}, "c": {"1.0.0": {"a": ""}}}
        roots = {"z": "", "c": ""}
        saved = dict(roots)
        self.assertEqual(resolve(catalog, roots),
                         [("a", "1.0.0"), ("b", "1.0.0"),
                          ("c", "1.0.0"), ("z", "1.0.0")])
        self.assertEqual(roots, saved)
        self.assertEqual(resolve(catalog, {}), [])

    def test_unsatisfiable_shared_requirements_are_not_overwritten(self):
        catalog = {"a": {"1.0.0": {"lib": "<2.0.0"}},
                   "b": {"1.0.0": {"lib": ">=2.0.0"}},
                   "lib": {"1.0.0": {}, "2.0.0": {}}}
        with self.assertRaises(ResolutionError):
            resolve(catalog, {"a": "", "b": ""})
