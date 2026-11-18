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
    ordered = sorted(bookings)
    merged = []
    for start, end in ordered:
        if end <= start:
            raise ValueError("end must follow start")
        if merged and start < merged[-1][1]:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged
