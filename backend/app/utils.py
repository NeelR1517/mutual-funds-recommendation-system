"""Small serialization helpers."""

import math

import pandas as pd


def num(value) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def integer(value) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(value)


def date_str(value) -> str | None:
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).date().isoformat()
