"""Assemble an investor-specific recommendation."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pandas as pd

from ..config import DISCLAIMER
from ..serializers import fund_payload
from ..utils import num
from .portfolio import category_targets, equity_target, optimize_weights, pick_funds
from .simulation import backtest, monte_carlo

if TYPE_CHECKING:
    from ..store import Dataset


def _warnings(picked: pd.DataFrame, horizon: int, equity: float) -> list[str]:
    messages = []

    if horizon < 3:
        messages.append(
            "Horizon under 3 years: equity is unsuitable; most money belongs in debt/cash."
        )
    elif horizon < 5 and equity > 55:
        messages.append(
            "Horizon under 5 years: equity allocation is at its upper limit."
        )

    if (picked["years"] < 3).any():
        messages.append(
            "Some picks have under 3 years of history; treat their metrics cautiously."
        )
    if picked.groupby("amc")["weight"].sum().max() > 0.30:
        messages.append("One fund house exceeds 30% of the portfolio.")

    mid_small = picked.loc[picked["category"].isin(["mid", "small"]), "weight"].sum()
    if mid_small > 0.45:
        messages.append("Mid + small caps exceed 45% of the portfolio.")

    index_names = picked.loc[picked["category"] == "index", "name"]
    if index_names.str.contains("smallcap|small cap", case=False, na=False).any():
        messages.append(
            "The index sleeve includes a small-cap index fund; its category label understates its risk."
        )

    return messages


def build_recommendation(
    dataset: Dataset,
    *,
    age: int,
    horizon: int,
    risk: int,
    mode: str,
    amount: float,
) -> dict:
    top = dataset.funds[dataset.funds["selected"]].sort_values("score", ascending=False)
    if top.empty:
        raise ValueError("No selected funds are available.")

    equity = equity_target(age, horizon, risk)
    targets = category_targets(age, horizon, risk)
    chosen = pick_funds(top, targets, mode)
    if chosen.empty:
        raise ValueError("No funds matched the selected allocation.")

    weights = optimize_weights(chosen, dataset.returns, targets, risk)
    active = weights[weights > 0]

    picked = chosen.loc[active.index].copy()
    picked["weight"] = active
    picked["equity_share"] = picked["weight"] * equity / 100
    picked["amount"] = picked["equity_share"] * amount
    picked = picked.sort_values("weight", ascending=False)

    portfolio_returns = (
        (dataset.returns[picked.index] * picked["weight"]).sum(axis=1).dropna()
    )
    if portfolio_returns.empty:
        raise ValueError("The portfolio has no return history.")

    allocations = [
        fund_payload(
            row,
            code=int(code),
            weight=num(row["weight"]),
            equity_share=num(row["equity_share"]),
            amount=num(row["amount"]),
        )
        for code, row in picked.iterrows()
    ]

    return {
        "inputs": {
            "age": age,
            "horizon_years": horizon,
            "risk_tolerance": risk,
            "mode": mode,
            "amount": amount,
        },
        "equity_target": equity,
        "debt_gap": 100 - equity,
        "category_targets": {key: float(value) for key, value in targets.items()},
        "allocations": allocations,
        "buckets": [
            {
                "bucket": "Equity funds",
                "share": equity,
                "amount": amount * equity / 100,
            },
            {
                "bucket": "Debt / cash (outside universe)",
                "share": 100 - equity,
                "amount": amount * (100 - equity) / 100,
            },
        ],
        "backtest": backtest(portfolio_returns, dataset.market),
        "projection": monte_carlo(portfolio_returns, horizon, mode, amount),
        "warnings": _warnings(picked, horizon, equity),
        "disclaimer": DISCLAIMER,
    }
