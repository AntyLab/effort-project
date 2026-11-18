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
    constraints = {name: [constraint] for name, constraint in requirements.items()}

    def order(selected):
        remaining = set(selected)
        result = []
        while remaining:
            ready = [name for name in remaining
                     if not (set(catalog[name][selected[name]]) & remaining)]
            if not ready:
                return None
            name = min(ready)
            remaining.remove(name)
            result.append((name, selected[name]))
        return result

    def search(selected, required):
        if any(not all(matches(version, c) for c in required[name])
               for name, version in selected.items()):
            return None
        pending = sorted(set(required) - set(selected))
        if not pending:
            return order(selected)
        name = pending[0]
        for version in sorted(catalog.get(name, {}), key=version_key, reverse=True):
            if not all(matches(version, c) for c in required[name]):
                continue
            next_required = {key: list(values) for key, values in required.items()}
            for dependency, constraint in catalog[name][version].items():
                next_required.setdefault(dependency, []).append(constraint)
            result = search({**selected, name: version}, next_required)
            if result is not None:
                return result
        return None

    result = search({}, constraints)
    if result is None:
        raise ResolutionError("no compatible acyclic selection")
    return result
