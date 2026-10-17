"""Signup form handling."""

import re

USERNAME = re.compile(r"[A-Za-z0-9_]{3,20}")
DIGITS = re.compile(r"[0-9]+")


class ValidationError(ValueError):
    """Invalid signup input. `field` names the first invalid field."""

    def __init__(self, field, message):
        super().__init__(f"{field}: {message}")
        self.field = field


def _clean(form, field):
    value = form.get(field)
    return value.strip() if isinstance(value, str) else ""


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
    username = _clean(form, "username")
    if not USERNAME.fullmatch(username):
        raise ValidationError("username", "use 3 to 20 ASCII letters, digits or underscores")

    email = _clean(form, "email")
    local, at, domain = email.partition("@")
    if not at or not local or "@" in domain or "." not in domain or domain.startswith(".") or domain.endswith("."):
        raise ValidationError("email", "enter a valid email address")

    age = None
    raw_age = _clean(form, "age")
    if raw_age:
        if not DIGITS.fullmatch(raw_age) or not 13 <= int(raw_age) <= 120:
            raise ValidationError("age", "enter a whole number from 13 to 120")
        age = int(raw_age)

    return {"username": username, "email": email, "age": age}
