import unittest
from datetime import datetime, timezone
from scheduler import merge_bookings


def at(hour):
    return datetime(2025, 1, 1, hour, tzinfo=timezone.utc)


class SchedulerTest(unittest.TestCase):
    def test_nested_booking_does_not_shorten_occupied_time(self):
        self.assertEqual(merge_bookings([(at(9), at(15)), (at(10), at(11)),
                                         (at(14), at(16))]), [(at(9), at(16))])

    def test_touching_bookings_join(self):
        self.assertEqual(merge_bookings([(at(9), at(10)), (at(10), at(11))]),
                         [(at(9), at(11))])
