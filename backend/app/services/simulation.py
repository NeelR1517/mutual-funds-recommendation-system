"""Historical performance and Monte Carlo projection."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import RISK_FREE
from ..utils import num
from .mfapi import sip_xirr


def performance(returns: pd.Series) -> dict:
    if len(returns) < 2:
        return {"cagr": None, "volatility": None, "sharpe": None, "max_drawdown": None}

    curve = (1 + returns).cumprod()
    years = len(returns) / 12
    cagr = float(curve.iloc[-1] ** (1 / years) - 1)
    volatility = float(returns.std() * np.sqrt(12))
    drawdown = float((curve / curve.cummax() - 1).min())

    return {
        "cagr": num(cagr),
        "volatility": num(volatility),
        "sharpe": num((cagr - RISK_FREE) / volatility) if volatility > 0 else None,
        "max_drawdown": num(drawdown),
    }


def backtest(returns: pd.Series, market: pd.Series) -> dict:
    recent = returns[returns.index >= returns.index.max() - pd.DateOffset(years=5)]
    benchmark = market.reindex(recent.index).fillna(0)

    portfolio_curve = (1 + recent).cumprod()
    market_curve = (1 + benchmark).cumprod()
    history = [
        {
            "date": index.date().isoformat(),
            "portfolio": float(portfolio_curve.loc[index]),
            "market": float(market_curve.loc[index]),
        }
        for index in recent.index
    ]

    return {
        "portfolio": performance(recent),
        "market": performance(benchmark),
        "sip_xirr": num(sip_xirr((1 + returns).cumprod())),
        "history": history,
    }


def monte_carlo(
    returns: pd.Series,
    horizon: int,
    mode: str,
    amount: float,
    paths: int = 2000,
    seed: int = 42,
) -> dict:
    returns = returns[returns.index >= returns.index.max() - pd.DateOffset(years=5)]
    months = max(1, int(horizon * 12))
    rng = np.random.default_rng(seed)
    draws = rng.choice(returns.to_numpy(), size=(paths, months), replace=True)

    if mode == "sip":
        value = np.zeros(paths)
        curve = np.zeros((paths, months + 1))
        for month in range(months):
            value = value * (1 + draws[:, month]) + amount
            curve[:, month + 1] = value
        invested = amount * months
        invested_path = [amount * month for month in range(months + 1)]
    else:
        growth = np.cumprod(1 + draws, axis=1)
        curve = np.column_stack([np.ones(paths), growth]) * amount
        value = curve[:, -1]
        invested = amount
        invested_path = [amount] * (months + 1)

    # The first SIP column is zero, which would make the drawdown ratio undefined.
    drawdown_curve = curve[:, 1:] if mode == "sip" else curve
    drawdowns = (drawdown_curve / np.maximum.accumulate(drawdown_curve, axis=1) - 1).min(axis=1)
    quantiles = np.percentile(curve, [5, 25, 50, 75, 95], axis=0)

    bands = [
        {
            "month": month,
            "p5": num(quantiles[0, month]),
            "p25": num(quantiles[1, month]),
            "p50": num(quantiles[2, month]),
            "p75": num(quantiles[3, month]),
            "p95": num(quantiles[4, month]),
        }
        for month in range(months + 1)
    ]

    return {
        "months": months,
        "invested": num(invested),
        "median": num(np.median(value)),
        "p5": num(np.percentile(value, 5)),
        "p95": num(np.percentile(value, 95)),
        "prob_below_contributions": num((value < invested).mean()),
        "median_max_drawdown": num(np.median(drawdowns)),
        "worst_5pct_drawdown": num(np.percentile(drawdowns, 5)),
        "bands": bands,
        "invested_path": invested_path,
    }
