"""Suitability policy, fund shortlisting and weight optimisation."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.covariance import ledoit_wolf

from ..config import CATEGORIES, PROFILES, RISK_AVERSION, VOL_BUDGET


def equity_target(age: int, horizon: int, risk: int) -> float:
    h = np.clip((horizon - 1) / 14, 0, 1)
    a = np.clip((65 - age) / 45, 0, 1)
    r = (risk - 1) / 4

    capacity = 0.45 * h + 0.30 * a + 0.25 * r
    target = 20 + 65 * capacity

    horizon_cap = next(
        (cap for limit, cap in ((1, 10), (3, 30), (5, 55), (7, 75)) if horizon < limit),
        90,
    )
    age_cap = max(20, 110 - age)
    risk_cap = {1: 30, 2: 50, 3: 70, 4: 85, 5: 95}[risk]

    return float(np.clip(min(target, horizon_cap, age_cap, risk_cap), 10, 95))


def category_targets(age: int, horizon: int, risk: int) -> pd.Series:
    equity = equity_target(age, horizon, risk) / 100

    if equity < 0.45:
        profile = "conservative"
    elif equity < 0.70:
        profile = "moderate"
    else:
        profile = "aggressive"

    target = pd.Series(PROFILES[profile], dtype=float)

    if horizon < 3:
        target[["mid", "small"]] = 0
    elif horizon < 5:
        target["small"] = 0
        target["mid"] = min(target["mid"], 0.10)
    elif horizon < 7:
        target["small"] = min(target["small"], 0.05)
        target["mid"] = min(target["mid"], 0.20)

    return target / target.sum()


def pick_funds(top: pd.DataFrame, targets: pd.Series, mode: str) -> pd.DataFrame:
    pool = top.copy()
    tilt_column = "sip_xirr" if mode == "sip" else "calmar_3y"
    pool["pick_score"] = 0.0

    for category in CATEGORIES:
        mask = pool["category"] == category
        tilt = pool.loc[mask, tilt_column].rank(pct=True).fillna(0) * 100
        pool.loc[mask, "pick_score"] = 0.7 * pool.loc[mask, "score"] + 0.3 * tilt

    chosen = []
    for category, weight in targets.items():
        if weight <= 0:
            continue

        candidates = pool[(pool["category"] == category) & (pool["years"] >= 2)]
        if candidates.empty:
            candidates = pool[pool["category"] == category]
        candidates = candidates.sort_values("pick_score", ascending=False)
        chosen.append(candidates.head(2 if weight >= 0.15 else 1))

    chosen = pd.concat(chosen).drop_duplicates("code").set_index("code")
    return chosen


def optimize_weights(
    chosen: pd.DataFrame,
    returns: pd.DataFrame,
    targets: pd.Series,
    risk: int,
) -> pd.Series:
    if len(chosen) == 1:
        return pd.Series([1.0], index=chosen.index)

    history = returns[chosen.index].iloc[-36:].fillna(0)
    cov = ledoit_wolf(history)[0] * 12

    mu = (
        (
            0.5 * chosen["cagr_3y"].fillna(chosen["cagr_1y"])
            + 0.5 * chosen.groupby("category")["cagr_3y"].transform("median")
        )
        .fillna(0.08)
        .clip(-0.05, 0.25)
    )

    cat_bounds = {}
    for category in CATEGORIES:
        target = targets.get(category, 0.0)
        cat_bounds[category] = (
            max(0.0, target - 0.05) if target > 0 else 0.0,
            min(1.0, target + 0.05) if target > 0 else 0.0,
        )

    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1}]
    for category in CATEGORIES:
        mask = (chosen["category"] == category).to_numpy().astype(float)
        low, high = cat_bounds[category]
        constraints.append({"type": "ineq", "fun": lambda w, m=mask, h=high: h - w @ m})
        constraints.append({"type": "ineq", "fun": lambda w, m=mask, l=low: w @ m - l})

    vol_budget = VOL_BUDGET[risk]
    constraints.append(
        {"type": "ineq", "fun": lambda w, b=vol_budget: b - np.sqrt(w @ cov @ w)}
    )

    x0 = np.array([targets[category] for category in chosen["category"]])
    x0 = x0 / x0.sum()
    target_weights = x0.copy()
    risk_aversion = RISK_AVERSION[risk]

    def objective(w: np.ndarray) -> float:
        expected = w @ mu.to_numpy()
        variance = w @ cov @ w
        drift = np.sum((w - target_weights) ** 2)
        return -(expected - 0.5 * risk_aversion * variance - drift)

    bounds = [(0.03, 0.30)] * len(chosen)
    result = minimize(
        objective, x0, method="SLSQP", bounds=bounds, constraints=constraints
    )
    if not result.success:
        result = minimize(
            objective, x0, method="SLSQP", bounds=bounds, constraints=constraints[:-1]
        )

    weights = pd.Series(result.x if result.success else x0, index=chosen.index)
    weights[weights < 0.02] = 0
    return weights / weights.sum()
