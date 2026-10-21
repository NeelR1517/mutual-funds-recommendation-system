"""Category-relative scoring and top-pool selection."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import BASE_QUOTA, CATEGORIES, SCORE_WEIGHTS, TOP_N

METRIC_LABELS = {
    "cagr_3y": "3-year CAGR",
    "cagr_5y": "5-year CAGR",
    "sip_xirr": "SIP XIRR",
    "sharpe_3y": "3-year Sharpe",
    "sortino_3y": "3-year Sortino",
    "calmar_3y": "3-year Calmar",
    "consistency": "Rolling 1-year consistency",
    "max_drawdown": "Maximum drawdown",
    "momentum_12m": "12-month momentum",
}


def score_funds(metrics: pd.DataFrame) -> pd.DataFrame:
    weights = pd.Series(SCORE_WEIGHTS)
    percentiles = metrics.groupby("category")[list(SCORE_WEIGHTS)].rank(pct=True)
    available = percentiles.notna().mul(weights, axis=1).sum(axis=1)

    scored = metrics.copy()
    scored["score"] = (
        (percentiles * weights).sum(axis=1) / available.replace(0, np.nan) * 100
    )
    scored["n_metrics"] = percentiles.notna().sum(axis=1)
    return scored.sort_values("score", ascending=False).reset_index(drop=True)


def select_top(metrics: pd.DataFrame) -> pd.DataFrame:
    picked = [
        metrics[metrics["category"] == category].head(BASE_QUOTA)
        for category in CATEGORIES
    ]
    top = pd.concat([frame for frame in picked if not frame.empty])

    for _, row in metrics.drop(top.index).iterrows():
        if len(top) >= TOP_N:
            break
        top = pd.concat([top, row.to_frame().T])

    top = top.sort_values("score", ascending=False).reset_index(drop=True)
    top["rank"] = range(1, len(top) + 1)

    selected = metrics.copy()
    selected["rank"] = (
        selected["code"].map(top.set_index("code")["rank"]).astype("Int64")
    )
    selected["selected"] = selected["rank"].notna()
    return selected


def score_breakdown(funds: pd.DataFrame, code: int) -> dict | None:
    """Explain one fund's score using category-relative percentiles."""
    rows = funds[funds["code"] == code]
    if rows.empty:
        return None

    row = rows.iloc[0]
    columns = list(SCORE_WEIGHTS)
    percentiles = funds.groupby("category")[columns].rank(pct=True)
    parts = []
    available_weight = 0.0

    for metric, weight in SCORE_WEIGHTS.items():
        value = row.get(metric)
        percentile = percentiles.loc[row.name, metric]
        percentile = None if pd.isna(percentile) else float(percentile)
        if percentile is not None:
            available_weight += weight
        parts.append(
            {
                "metric": metric,
                "label": METRIC_LABELS[metric],
                "value": None if pd.isna(value) else float(value),
                "percentile": percentile,
                "weight": float(weight),
                "contribution": None,
            }
        )

    if available_weight:
        for part in parts:
            if part["percentile"] is not None:
                part["contribution"] = (
                    100 * part["percentile"] * part["weight"] / available_weight
                )

    missing = [part["label"] for part in parts if part["percentile"] is None]
    return {
        "code": int(row["code"]),
        "name": str(row["name"]),
        "category": str(row["category"]),
        "score": None if pd.isna(row.get("score")) else float(row["score"]),
        "rank": None if pd.isna(row.get("rank")) else int(row["rank"]),
        "available_weight": available_weight,
        "parts": parts,
        "missing": missing,
    }
