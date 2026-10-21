"""Return, risk, consistency and benchmark-relative metrics."""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from ..config import RISK_FREE
from .mfapi import sip_xirr


def max_drawdowns(navs: pd.DataFrame) -> pd.Series:
    ordered = navs.sort_values(["code", "date"])
    peak = ordered.groupby("code")["nav"].cummax()
    drawdown = ordered["nav"] / peak - 1
    return drawdown.groupby(ordered["code"]).min()


def benchmark_returns(returns: pd.DataFrame, funds: pd.DataFrame) -> pd.Series:
    def composite(pattern: str, exclude: str | None = None) -> pd.Series:
        codes = [
            code
            for code, name in zip(funds["code"], funds["name"])
            if re.search(pattern, name, re.IGNORECASE)
            and not (exclude and re.search(exclude, name, re.IGNORECASE))
        ]
        if not codes:
            return pd.Series(np.nan, index=returns.index)
        return returns[codes].mean(axis=1)

    nifty50 = composite(r"nifty\s*50\b", r"next\s*50")
    nifty500 = composite(r"nifty\s*500")
    midcap150 = composite(r"midcap\s*150")
    smallcap250 = composite(r"smallcap\s*250")

    return nifty500.fillna(0.5 * nifty50 + 0.3 * midcap150 + 0.2 * smallcap250).fillna(
        nifty50
    )


def _fund_metrics(
    code: int,
    monthly: pd.Series,
    nav: pd.Series,
    benchmark: pd.Series,
    drawdown: float,
) -> dict | None:
    r = monthly.dropna()
    n = len(r)
    if n < 12:
        return None

    def cagr(values: pd.Series) -> float:
        return (1 + values).prod() ** (12 / len(values)) - 1

    r3 = r.iloc[-36:]
    r12 = r.iloc[-12:]
    c3 = cagr(r3)
    c5 = cagr(r.iloc[-60:]) if n >= 60 else np.nan
    vol = r3.std() * np.sqrt(12)
    downside = r3[r3 < 0].std() * np.sqrt(12)
    rolling12 = (1 + r).rolling(12).apply(np.prod, raw=True).dropna() - 1

    aligned = benchmark.reindex(r3.index).dropna()
    if len(aligned) > 12:
        beta = np.cov(r3.loc[aligned.index], aligned)[0, 1] / np.var(aligned)
        market_cagr = cagr(aligned)
        alpha = c3 - (RISK_FREE + beta * (market_cagr - RISK_FREE))
    else:
        beta = np.nan
        alpha = np.nan

    return {
        "code": code,
        "cagr_1y": cagr(r12),
        "cagr_3y": c3,
        "cagr_5y": c5,
        "vol_3y": vol,
        "sharpe_3y": (c3 - RISK_FREE) / vol if vol > 0 else np.nan,
        "sortino_3y": (c3 - RISK_FREE) / downside if downside > 0 else np.nan,
        "max_drawdown": drawdown,
        "calmar_3y": c3 / abs(drawdown)
        if pd.notna(drawdown) and drawdown < 0
        else np.nan,
        "positive_months": (r3 > 0).mean(),
        "consistency": (rolling12 > 0).mean() if len(rolling12) else np.nan,
        "sip_xirr": sip_xirr(nav),
        "momentum_12m": (1 + r12).prod() - 1,
        "beta": beta,
        "alpha": alpha,
    }


def compute_metrics(
    funds: pd.DataFrame,
    returns: pd.DataFrame,
    monthly_nav: pd.DataFrame,
    navs: pd.DataFrame,
    market: pd.Series,
) -> pd.DataFrame:
    drawdowns = max_drawdowns(navs)
    rows = []

    for code in funds["code"]:
        row = _fund_metrics(
            code,
            returns[code],
            monthly_nav[code],
            market,
            drawdowns.get(code, np.nan),
        )
        if row:
            rows.append(row)

    if not rows:
        raise ValueError("No fund had enough history to compute metrics.")

    return funds.merge(pd.DataFrame(rows), on="code")
