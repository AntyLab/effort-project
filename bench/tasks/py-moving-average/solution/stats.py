"""Small statistics helpers."""


def moving_average(values, window):
    """Return the mean of every full window of `window` consecutive values.

    >>> moving_average([1, 2, 3, 4], 2)
    [1.5, 2.5, 3.5]

    Returns [] when there are fewer values than `window`.
    Raises ValueError if window is less than 1.
    """
    if window < 1:
        raise ValueError("window must be at least 1")
    return [sum(values[i:i + window]) / window for i in range(len(values) - window + 1)]
