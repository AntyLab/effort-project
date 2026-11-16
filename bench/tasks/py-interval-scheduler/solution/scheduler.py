"""Merge bookings into occupied intervals (Python 3.9+).

merge_bookings(bookings) takes an iterable of (start, end) aware datetime pairs.
Compare instants, not local clock readings, including datetime.fold during DST.
Every end must be strictly after its start; naive endpoints and nonpositive
intervals raise ValueError. Return a new list of (start, end) pairs in UTC,
sorted by start. Overlapping or touching intervals are coalesced transitively.
Do not mutate the input or its datetimes. An empty input returns [].
"""
from datetime import timezone


def merge_bookings(bookings):
    normalized = []
    for start, end in bookings:
        if start.utcoffset() is None or end.utcoffset() is None:
            raise ValueError("endpoints must be aware")
        start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
        if end <= start:
            raise ValueError("end must follow start")
        normalized.append((start, end))
    normalized.sort()
    merged = []
    for start, end in normalized:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged
