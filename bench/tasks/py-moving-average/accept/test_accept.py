import unittest

from stats import moving_average


class MovingAverageAcceptance(unittest.TestCase):
    def test_docstring_example(self):
        self.assertEqual(moving_average([1, 2, 3, 4], 2), [1.5, 2.5, 3.5])

    def test_window_equal_to_length(self):
        self.assertEqual(moving_average([2, 4, 6], 3), [4.0])

    def test_window_of_one(self):
        self.assertEqual(moving_average([5, 7], 1), [5.0, 7.0])

    def test_tuples_work_too(self):
        self.assertEqual(moving_average((1, 3, 5), 2), [2.0, 4.0])

    def test_too_few_values(self):
        self.assertEqual(moving_average([1, 2], 3), [])
        self.assertEqual(moving_average([], 1), [])

    def test_invalid_window(self):
        with self.assertRaises(ValueError):
            moving_average([1, 2], 0)


if __name__ == "__main__":
    unittest.main()
