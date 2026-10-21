"""Shared response shaping."""

from __future__ import annotations

from .utils import date_str, integer, num


def fund_payload(row, **extra) -> dict:
    code = extra.get("code", row.get("code", row.name))
    payload = {
        "code": int(code),
        "name": str(row["name"]),
        "amc": str(row["amc"]),
        "category": str(row["category"]),
        "selected": bool(row.get("selected", True)),
        "rank": integer(row.get("rank")),
        "years": num(row.get("years")),
        "n_obs": integer(row.get("n_obs")),
        "first_date": date_str(row.get("first")),
        "last_date": date_str(row.get("last")),
        "score": num(row.get("score")),
        "n_metrics": integer(row.get("n_metrics")),
        "cagr_1y": num(row.get("cagr_1y")),
        "cagr_3y": num(row.get("cagr_3y")),
        "cagr_5y": num(row.get("cagr_5y")),
        "vol_3y": num(row.get("vol_3y")),
        "sharpe_3y": num(row.get("sharpe_3y")),
        "sortino_3y": num(row.get("sortino_3y")),
        "max_drawdown": num(row.get("max_drawdown")),
        "calmar_3y": num(row.get("calmar_3y")),
        "positive_months": num(row.get("positive_months")),
        "consistency": num(row.get("consistency")),
        "sip_xirr": num(row.get("sip_xirr")),
        "momentum_12m": num(row.get("momentum_12m")),
        "beta": num(row.get("beta")),
        "alpha": num(row.get("alpha")),
    }
    payload.update(extra)
    return payload
