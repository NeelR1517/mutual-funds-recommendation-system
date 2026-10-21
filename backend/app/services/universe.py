"""Fund universe: candidates, categories, NAVs and quality filters."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from ..config import MIN_OBS, MIN_YEARS
from .mfapi import fetch_scheme

BROAD_INDEX = r"nifty\s*(50\b|100\b|next\s*50|500)|sensex|bse\s*(500|sensex)|midcap\s*150|smallcap\s*250|nifty\s*(large|mid|small)\s*cap|total\s*market"
SECTOR_INDEX = r"bank\b|it\b|pharma|auto\b|fmcg|consumption|infra|manufactur|energy|psu|defence|healthcare|tech|metal|realty|esg|momentum|quality|value|dividend|low\s*vol|alpha|equal\s*weight|sector|thematic|housing|insurance|financial|services"
NOT_A_FUND = r"\betf\b|exchange traded|fund of funds|\bfof\b|fmp|fixed maturity|closed?\s*ended|interval|1099|regular plan"
INTERNATIONAL = r"\bus\b|u\.s\.|overseas|global|world|international|china|japan|europe|emerging|asia|nasdaq|s&p|dow|ftse|hang seng|greater china|america|brazil|russia|canada|australia"


def classify(name: str, raw_category: str | None) -> str | None:
    text = f"{name} {raw_category}".lower()

    if re.search(NOT_A_FUND, text) or re.search(INTERNATIONAL, text):
        return None
    if "index" in text or re.search(r"nifty|sensex|bse\s*\d", text):
        broad = re.search(BROAD_INDEX, text) and not re.search(SECTOR_INDEX, text)
        return "index" if broad else None
    if re.search(r"large\s*(&|and)\s*mid", text):
        return None
    if re.search(r"small\s*cap|smallcap", text):
        return "small"
    if re.search(r"mid\s*cap|midcap", text):
        return "mid"
    if re.search(r"flexi\s*cap|flexicap", text):
        return "flexi"
    if re.search(r"large\s*cap|largecap|bluechip|frontline|top\s*100", text):
        return "large"

    raw = str(raw_category).lower()
    if "small cap fund" in raw:
        return "small"
    if "mid cap fund" in raw:
        return "mid"
    if "flexi cap fund" in raw:
        return "flexi"
    if "large cap fund" in raw:
        return "large"
    return None


def candidate_schemes(master: pd.DataFrame) -> pd.DataFrame:
    names = master["schemeName"].str.lower()
    mask = (
        names.str.contains(r"\bdirect\b")
        & names.str.contains("growth")
        & ~names.str.contains(r"idcw|dividend|bonus|payout|reinvest")
    )
    return master[mask].copy()


def _fetch_meta(code: int) -> dict | None:
    try:
        meta = fetch_scheme(code)["meta"]
    except Exception:
        return None
    return {
        "code": code,
        "name": meta.get("scheme_name", ""),
        "amc": meta.get("fund_house", ""),
        "category_raw": meta.get("scheme_category"),
    }


def load_funds(candidates: pd.DataFrame) -> pd.DataFrame:
    with ThreadPoolExecutor(max_workers=24) as pool:
        rows = [row for row in pool.map(_fetch_meta, candidates["schemeCode"]) if row]

    if not rows:
        raise RuntimeError("No scheme metadata could be loaded.")

    funds = pd.DataFrame(rows)
    funds["category"] = [
        classify(name, raw) for name, raw in zip(funds["name"], funds["category_raw"])
    ]
    return funds[funds["category"].notna()].reset_index(drop=True)


def _nav_frame(code: int) -> pd.DataFrame | None:
    try:
        rows = fetch_scheme(code).get("data") or []
    except Exception:
        return None
    if not rows:
        return None

    frame = pd.DataFrame(rows)
    frame["code"] = code
    frame["date"] = pd.to_datetime(frame["date"], format="%d-%m-%Y", errors="coerce")
    frame["nav"] = pd.to_numeric(frame["nav"], errors="coerce")
    return frame[["code", "date", "nav"]]


def load_navs(codes: list[int]) -> pd.DataFrame:
    frames = []
    for code in codes:
        frame = _nav_frame(code)
        if frame is not None:
            frames.append(frame)

    if not frames:
        raise RuntimeError("No NAV data could be loaded.")

    navs = pd.concat(frames, ignore_index=True)
    navs = navs.dropna(subset=["nav"])
    navs = navs[navs["nav"] > 0]
    navs = navs.drop_duplicates(["code", "date"]).sort_values(["code", "date"])
    return navs.reset_index(drop=True)


def quality_filter(
    funds: pd.DataFrame, navs: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    stats = navs.groupby("code").agg(
        first=("date", "min"),
        last=("date", "max"),
        n_obs=("nav", "size"),
    )
    stats["years"] = (stats["last"] - stats["first"]).dt.days / 365.25

    latest = stats["last"].max()
    keep = stats[
        (stats["last"] >= latest - pd.Timedelta(days=10))
        & (stats["years"] >= MIN_YEARS)
        & (stats["n_obs"] >= MIN_OBS)
    ].index

    funds = funds[funds["code"].isin(keep)].merge(stats.reset_index(), on="code")
    return funds.reset_index(drop=True), navs[navs["code"].isin(keep)].reset_index(
        drop=True
    )


def monthly_returns(navs: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    wide = navs.pivot_table(index="date", columns="code", values="nav").sort_index()
    monthly_nav = wide.resample("ME").last()
    returns = monthly_nav.pct_change(fill_method=None)
    return monthly_nav, returns
