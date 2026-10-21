"""mfapi.in access with local caching, plus return helpers."""

from __future__ import annotations

import gzip
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from scipy.optimize import brentq

from ..config import API_URL, MASTER_PATH, RAW_DIR, REFRESH_DAYS


def get_json(url: str, tries: int = 4):
    for attempt in range(tries):
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return response.json()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(1 + attempt)


def _fresh(path: Path, days: int = REFRESH_DAYS) -> bool:
    return path.exists() and (time.time() - path.stat().st_mtime) < days * 86400


def fetch_master() -> pd.DataFrame:
    if _fresh(MASTER_PATH):
        return pd.read_pickle(MASTER_PATH)

    master = pd.DataFrame(get_json(API_URL))
    MASTER_PATH.parent.mkdir(parents=True, exist_ok=True)
    master.to_pickle(MASTER_PATH)
    return master


def fetch_scheme(code: int) -> dict:
    path = RAW_DIR / f"{code}.json.gz"
    if path.exists():
        with gzip.open(path, "rt") as file:
            return json.load(file)

    data = get_json(f"{API_URL}/{code}")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt") as file:
        json.dump(data, file)
    return data


def xirr(flows: list[tuple[pd.Timestamp, float]]) -> float:
    if len(flows) < 2:
        return float("nan")

    start = flows[0][0]
    years = np.array([(day - start).days / 365.25 for day, _ in flows])
    amounts = np.array([amount for _, amount in flows])

    try:
        return brentq(lambda rate: np.sum(amounts / (1 + rate) ** years), -0.999, 5)
    except ValueError:
        return float("nan")


def sip_xirr(nav: pd.Series) -> float:
    nav = nav.dropna()
    if nav.empty:
        return float("nan")

    nav = nav[nav.index >= nav.index.max() - pd.DateOffset(months=60)]
    if len(nav) < 12:
        return float("nan")

    units = 0.0
    flows: list[tuple[pd.Timestamp, float]] = []

    for month in pd.date_range(nav.index.min(), nav.index.max(), freq="MS"):
        available = nav.index[nav.index >= month]
        if len(available) == 0:
            continue
        day = available[0]
        units += 1 / nav.loc[day]
        flows.append((day, -1.0))

    flows.append((nav.index[-1], units * nav.iloc[-1]))
    return xirr(flows)
