"""A minimal line-based unified diff.

unified_diff(before, after, context=3) takes lists of newline-free strings and a
nonnegative integer context. Return '' for identical lists; otherwise return
one string with --- before and +++ after headers, @@ -old +new @@ hunk headers,
and lines prefixed with space, - or +, each terminated by \n. Do not mutate
inputs. Use a longest common subsequence, minimizing deleted plus added lines.
During LCS reconstruction, keep equal lines; if skipping either side leaves
equal LCS lengths, delete from before first. Group changes into hunks with up
to context unchanged lines on either side; merge hunks whose context touches
or overlaps (an unchanged gap of at most 2*context lines).
Ranges are 1-based start,count, omit ,1, and use start,0 for an empty side,
where start is the number of lines before that insertion/deletion point.
Empty lines are real lines. Inputs always end at line boundaries, so no
'No newline' markers are needed. Negative context raises ValueError.
"""


def unified_diff(before, after, context=3):
    if context < 0:
        raise ValueError("context must be nonnegative")
    n, m = len(before), len(after)
    lengths = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            lengths[i][j] = (1 + lengths[i + 1][j + 1] if before[i] == after[j]
                             else max(lengths[i + 1][j], lengths[i][j + 1]))
    operations = []
    i = j = 0
    while i < n or j < m:
        if i < n and j < m and before[i] == after[j]:
            operations.append((" ", before[i]))
            i += 1
            j += 1
        elif i < n and (j == m or lengths[i + 1][j] >= lengths[i][j + 1]):
            operations.append(("-", before[i]))
            i += 1
        else:
            operations.append(("+", after[j]))
            j += 1
    changes = [index for index, (tag, _) in enumerate(operations) if tag != " "]
    if not changes:
        return ""
    groups = []
    first = last = changes[0]
    for index in changes[1:]:
        if index - last - 1 > 2 * context:
            groups.append((first, last))
            first = index
        last = index
    groups.append((first, last))
    old = [0]
    new = [0]
    for tag, _ in operations:
        old.append(old[-1] + (tag != "+"))
        new.append(new[-1] + (tag != "-"))

    def span(offset, count):
        start = offset + 1 if count else offset
        return str(start) if count == 1 else f"{start},{count}"

    lines = ["--- before", "+++ after"]
    for first, last in groups:
        start = max(0, first - context)
        stop = min(len(operations), last + context + 1)
        lines.append(f"@@ -{span(old[start], old[stop] - old[start])} "
                     f"+{span(new[start], new[stop] - new[start])} @@")
        lines.extend(tag + value for tag, value in operations[start:stop])
    return "\n".join(lines) + "\n"
