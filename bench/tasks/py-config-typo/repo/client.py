"""Retry scheduling for the HTTP client (network code omitted in this fixture)."""

from settings import DEFAULTS


def retry_delays(overrides=None):
    """Return the delay in seconds before each retry.

    The delay before retry n (1-based) is retry_backoff ** n, rounded to three
    decimals, for n = 1 .. max_retries. Keys in `overrides` take precedence
    over DEFAULTS.
    """
    config = {**DEFAULTS, **(overrides or {})}
    return [round(config["retry_backof"] ** n, 3) for n in range(1, config["max_retries"] + 1)]
