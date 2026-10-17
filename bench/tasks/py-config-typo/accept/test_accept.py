import unittest

import settings
from client import retry_delays


class RetryDelaysAcceptance(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(retry_delays(), [1.5, 2.25, 3.375])

    def test_overrides_take_precedence(self):
        self.assertEqual(retry_delays({"retry_backoff": 2, "max_retries": 4}), [2, 4, 8, 16])
        self.assertEqual(retry_delays({"retry_backoff": 1.1}), [1.1, 1.21, 1.331])

    def test_zero_retries(self):
        self.assertEqual(retry_delays({"max_retries": 0}), [])

    def test_defaults_are_not_mutated(self):
        retry_delays({"retry_backoff": 3})
        self.assertEqual(settings.DEFAULTS["retry_backoff"], 1.5)
        self.assertEqual(retry_delays(), [1.5, 2.25, 3.375])


if __name__ == "__main__":
    unittest.main()
