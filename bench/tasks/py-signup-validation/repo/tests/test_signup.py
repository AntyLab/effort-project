import unittest

from signup import ValidationError, create_user


class CreateUserTest(unittest.TestCase):
    def test_valid_form(self):
        self.assertEqual(
            create_user({"username": "ada_l", "email": "ada@example.com", "age": "36"}),
            {"username": "ada_l", "email": "ada@example.com", "age": 36},
        )

    def test_short_username_is_rejected(self):
        with self.assertRaises(ValidationError) as caught:
            create_user({"username": "ab", "email": "ada@example.com"})
        self.assertEqual(caught.exception.field, "username")


if __name__ == "__main__":
    unittest.main()
