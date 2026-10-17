import unittest

from signup import ValidationError, create_user

VALID = {"username": "ada_l", "email": "ada@example.com", "age": "36"}


class SignupAcceptance(unittest.TestCase):
    def assertInvalid(self, form, field):
        with self.assertRaises(ValidationError) as caught:
            create_user(form)
        self.assertEqual(caught.exception.field, field)
        self.assertIsInstance(caught.exception, ValueError)

    def test_valid_form(self):
        self.assertEqual(create_user(VALID), {"username": "ada_l", "email": "ada@example.com", "age": 36})

    def test_surrounding_whitespace_is_removed(self):
        self.assertEqual(
            create_user({"username": "  ada_l ", "email": " ada@example.com\t", "age": " 36 "}),
            {"username": "ada_l", "email": "ada@example.com", "age": 36},
        )

    def test_age_is_optional(self):
        self.assertIsNone(create_user({"username": "ada_l", "email": "ada@example.com"})["age"])
        self.assertIsNone(create_user({**VALID, "age": ""})["age"])
        self.assertIsNone(create_user({**VALID, "age": "   "})["age"])

    def test_username_rules(self):
        for username in ["ab", "a" * 21, "has space", "dash-name", "", "   ", "émile"]:
            with self.subTest(username=username):
                self.assertInvalid({**VALID, "username": username}, "username")
        self.assertInvalid({"email": "ada@example.com"}, "username")
        for username in ["abc", "a" * 20, "A_1"]:
            with self.subTest(username=username):
                self.assertEqual(create_user({**VALID, "username": username})["username"], username)

    def test_email_rules(self):
        for email in ["", "ada.example.com", "ada@@example.com", "a@b@c.com", "@example.com", "ada@",
                      "ada@example", "ada@.example.com", "ada@example.com."]:
            with self.subTest(email=email):
                self.assertInvalid({**VALID, "email": email}, "email")
        self.assertInvalid({"username": "ada_l"}, "email")
        self.assertEqual(create_user({**VALID, "email": "a@b.co"})["email"], "a@b.co")

    def test_age_rules(self):
        for age in ["12", "121", "abc", "13.5", "-20", "4 2", "1e2"]:
            with self.subTest(age=age):
                self.assertInvalid({**VALID, "age": age}, "age")
        for age, expected in [("13", 13), ("120", 120)]:
            with self.subTest(age=age):
                self.assertEqual(create_user({**VALID, "age": age})["age"], expected)

    def test_first_invalid_field_wins(self):
        self.assertInvalid({"username": "x", "email": "bad", "age": "1"}, "username")
        self.assertInvalid({"username": "ada_l", "email": "bad", "age": "1"}, "email")


if __name__ == "__main__":
    unittest.main()
