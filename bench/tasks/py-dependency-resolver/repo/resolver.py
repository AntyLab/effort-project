"""Resolve a small package catalog without changing the inputs.

resolve(catalog, requirements) returns [(name, version), ...], dependencies before
users; choose the alphabetically first ready package at each output position.
catalog maps names to {version: {dependency_name: constraint}}. requirements maps
root names to constraints. Versions are three nonnegative decimal integers
(major.minor.patch), compared numerically. Constraints are comma-separated >=,
>, <=, <, or == clauses; an empty string accepts any version. Inputs follow this
syntax. Only packages reachable from roots are included, with one version each.
Use deterministic highest-first resolution: select the alphabetically first
currently unselected required package, try versions in descending order, and
reconsider choices when later constraints or dependency cycles prevent a full
resolution. A lower version may remove an incompatible or cyclic dependency.
Raise ResolutionError if no complete acyclic selection satisfies every root and
selected dependency, including missing packages. Empty requirements returns [].
"""
import re


class ResolutionError(ValueError):
    pass


def version_key(version):
    return tuple(int(part) for part in version.split("."))


def matches(version, constraint):
    actual = version_key(version)
    for clause in constraint.split(","):
        if not clause.strip():
            continue
        operator, wanted = re.fullmatch(r"\s*(>=|<=|==|>|<)\s*(\d+\.\d+\.\d+)\s*", clause).groups()
        expected = version_key(wanted)
        if not {">=": actual >= expected, ">": actual > expected,
                "<=": actual <= expected, "<": actual < expected,
                "==": actual == expected}[operator]:
            return False
    return True


def resolve(catalog, requirements):
    selected = {}

    def visit(name, constraint):
        if name in selected:
            return
        candidates = sorted(catalog.get(name, {}), reverse=True)
        version = next((v for v in candidates if matches(v, constraint)), None)
        if version is None:
            raise ResolutionError(name)
        selected[name] = version
        for dependency, required in catalog[name][version].items():
            visit(dependency, required)

    for name, constraint in requirements.items():
        visit(name, constraint)
    return list(selected.items())
