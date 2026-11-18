import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from scheduler import merge_bookings

UTC = timezone.utc


def utc(hour, minute=0):
    return datetime(2025, 11, 2, hour, minute, tzinfo=UTC)


class SchedulerAcceptance(unittest.TestCase):
    def test_fall_back_fold_and_reversed_local_clock(self):
        ny = ZoneInfo("America/New_York")
        start = datetime(2025, 11, 2, 1, 45, tzinfo=ny, fold=0)
        end = datetime(2025, 11, 2, 1, 15, tzinfo=ny, fold=1)
        self.assertEqual(merge_bookings([(start, end)]), [(utc(5, 45), utc(6, 15))])

    def test_fold_must_not_collapse_distinct_instants(self):
        ny = ZoneInfo("America/New_York")
        first = (datetime(2025, 11, 2, 1, 0, tzinfo=ny, fold=0),
                 datetime(2025, 11, 2, 1, 15, tzinfo=ny, fold=0))
        second = (datetime(2025, 11, 2, 1, 0, tzinfo=ny, fold=1),
                  datetime(2025, 11, 2, 1, 15, tzinfo=ny, fold=1))
        self.assertEqual(merge_bookings([second, first]),
                         [(utc(5), utc(5, 15)), (utc(6), utc(6, 15))])

    def test_zones_nesting_touching_and_input_preservation(self):
        east = timezone(timedelta(hours=2))
        bookings = [(utc(8), utc(10)), (utc(6), utc(9)),
                    (utc(7).astimezone(east), utc(7, 30).astimezone(east)),
                    (utc(10), utc(11)), (utc(12), utc(13))]
        before = list(bookings)
        self.assertEqual(merge_bookings(iter(bookings)),
                         [(utc(6), utc(11)), (utc(12), utc(13))])
        self.assertEqual(bookings, before)
        result = merge_bookings([(utc(8).astimezone(east), utc(9).astimezone(east))])
        self.assertIs(result[0][0].tzinfo, UTC)
        self.assertIs(result[0][1].tzinfo, UTC)

    def test_spring_forward_uses_elapsed_time(self):
        ny = ZoneInfo("America/New_York")
        start = datetime(2025, 3, 9, 1, 30, tzinfo=ny)
        end = datetime(2025, 3, 9, 3, 30, tzinfo=ny)
        result = merge_bookings([(start, end)])
        self.assertEqual(result[0][1] - result[0][0], timedelta(hours=1))

    def test_invalid_intervals_even_inside_another(self):
        for pair in [(utc(7), utc(7)), (utc(8), utc(7)),
                     (datetime(2025, 11, 2, 7), utc(8)),
                     (utc(7), datetime(2025, 11, 2, 8))]:
            with self.subTest(pair=pair):
                with self.assertRaises(ValueError):
                    merge_bookings([(utc(5), utc(10)), pair])
        ny = ZoneInfo("America/New_York")
        with self.assertRaises(ValueError):
            merge_bookings([(datetime(2025, 11, 2, 1, 15, tzinfo=ny, fold=1),
                             datetime(2025, 11, 2, 1, 45, tzinfo=ny, fold=0))])
        self.assertEqual(merge_bookings([]), [])
