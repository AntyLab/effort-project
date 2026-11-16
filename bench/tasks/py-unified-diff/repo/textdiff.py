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
    if before == after:
        return ""
    lines = ["--- before", "+++ after",
             f"@@ -1,{len(before)} +1,{len(after)} @@"]
    for index in range(max(len(before), len(after))):
        if index < len(before) and index < len(after) and before[index] == after[index]:
            lines.append(" " + before[index])
        else:
            if index < len(before):
                lines.append("-" + before[index])
            if index < len(after):
                lines.append("+" + after[index])
    return "\n".join(lines) + "\n"
