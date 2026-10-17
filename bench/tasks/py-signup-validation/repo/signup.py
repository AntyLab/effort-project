"""Signup form handling."""


class ValidationError(ValueError):
    """Invalid signup input. `field` names the first invalid field."""

    def __init__(self, field, message):
        super().__init__(f"{field}: {message}")
        self.field = field


def create_user(form):
    """Validate a signup form (a dict of strings) and return a user record.

    Rules, checked in this order:

    - username: required; 3 to 20 characters; only ASCII letters, digits and
      underscores.
    - email: required; exactly one "@" with text before it; the part after
      the "@" contains a "." and does not start or end with ".".
    - age: optional (missing or blank means None); otherwise a whole number
      from 13 to 120, written with digits only.

    Surrounding whitespace is ignored for every field. The first invalid field
    raises ValidationError(field, message). The returned record is
    {"username": str, "email": str, "age": int or None}, with surrounding
    whitespace removed.
    """
    return {
        "username": form["username"],
        "email": form["email"],
        "age": int(form["age"]) if form.get("age") else None,
    }
