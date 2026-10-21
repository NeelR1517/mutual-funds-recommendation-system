"""Shared data access and formatting for the mflyzer dashboard."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ARTIFACTS = ROOT / "data" / "cache" / "artifacts"
ARTIFACTS = Path(os.environ.get("MFLYZER_ARTIFACTS", DEFAULT_ARTIFACTS)).expanduser()

TABLE_NAMES = [
    "metrics",
    "top",
    "score_breakdown",
    "score_weights",
    "recommendation",
    "deployment",
    "category_targets",
    "benchmarks",
    "portfolio_history",
    "portfolio_returns",
    "stress",
    "monte_carlo",
    "monte_carlo_paths",
    "nav_monthly",
    "nav_daily",
    "ml_panel",
    "ml_coefficients",
    "ml_test_predictions",
    "performance",
]

CATEGORY_ORDER = ["large", "mid", "small", "flexi", "index"]
CATEGORY_LABELS = {
    "large": "Large cap",
    "mid": "Mid cap",
    "small": "Small cap",
    "flexi": "Flexi cap",
    "index": "Index",
}
CATEGORY_COLORS = {
    "large": "#1D4ED8",
    "mid": "#7C3AED",
    "small": "#DC2626",
    "flexi": "#059669",
    "index": "#D97706",
}
METRIC_LABELS = {
    "cagr_1y": "1-year CAGR",
    "cagr_3y": "3-year CAGR",
    "cagr_5y": "5-year CAGR",
    "vol_3y": "3-year volatility",
    "sharpe_3y": "3-year Sharpe",
    "sortino_3y": "3-year Sortino",
    "max_drawdown": "Maximum drawdown",
    "calmar_3y": "3-year Calmar",
    "positive_months": "Positive months",
    "consistency": "Rolling 1-year consistency",
    "sip_xirr": "SIP XIRR",
    "momentum_12m": "12-month momentum",
    "beta": "Beta vs Nifty 500",
    "alpha": "Alpha vs Nifty 500",
    "score": "Composite score",
}
METRIC_HELP = {
    "cagr_3y": "Annualised return over the last 36 months.",
    "cagr_5y": "Annualised return over the last 60 months, when available.",
    "sip_xirr": "Money-weighted return of a monthly SIP over the last five years.",
    "sharpe_3y": "Excess return per unit of total volatility.",
    "sortino_3y": "Excess return per unit of downside volatility.",
    "calmar_3y": "3-year CAGR divided by the absolute maximum drawdown.",
    "consistency": "Share of rolling 12-month windows that ended positive.",
    "max_drawdown": "Worst peak-to-trough fall in daily NAV.",
    "momentum_12m": "Trailing 12-month return.",
}


class ArtifactsMissing(RuntimeError):
    """Raised when the notebook has not written the dashboard artifacts yet."""


@st.cache_data(ttl="10m", max_entries=2, show_spinner=False)
def load_artifacts() -> dict[str, object]:
    """Load every parquet table and the metadata file once per session."""
    metadata_path = ARTIFACTS / "metadata.json"
    missing = [name for name in TABLE_NAMES if not (ARTIFACTS / f"{name}.parquet").exists()]
    if not metadata_path.exists() or missing:
        detail = ", ".join((["metadata.json"] if not metadata_path.exists() else []) + missing)
        raise ArtifactsMissing(
            f"No dashboard artifacts found in {ARTIFACTS}. Missing: {detail}. "
            "Run the final cell of mf_recommender.ipynb first."
        )

    data: dict[str, object] = {
        name: pd.read_parquet(ARTIFACTS / f"{name}.parquet") for name in TABLE_NAMES
    }
    data["metadata"] = json.loads(metadata_path.read_text())
    return data


def require_artifacts() -> dict[str, object]:
    """Load artifacts, or stop the page with a useful message."""
    try:
        return load_artifacts()
    except ArtifactsMissing as error:
        st.error(str(error), title="Dashboard data is missing", icon=":material/database_off:")
        st.code(
            "uv run python -m nbconvert --to notebook --execute --inplace mf_recommender.ipynb\n"
            "uv run streamlit run streamlit_app.py",
            language="bash",
        )
        st.stop()


def category_label(value: str) -> str:
    return CATEGORY_LABELS.get(value, str(value).title())


def short_name(name: str) -> str:
    """Remove the repeated plan suffix so fund names fit in tables and charts."""
    for suffix in (
        " - Direct Plan - Growth Option",
        " - Direct Plan - Growth",
        " - Direct Plan - Growth Option ",
        " Direct Plan - Growth Option",
        " Direct Plan - Growth",
    ):
        name = name.replace(suffix, "")
    return name.strip(" -")


def format_pct(value: float | None, decimals: int = 1) -> str:
    if value is None or pd.isna(value):
        return "—"
    return f"{value * 100:,.{decimals}f}%"


def format_inr(value: float | None, decimals: int = 0) -> str:
    """Format rupees with Indian units for large amounts."""
    if value is None or pd.isna(value):
        return "—"
    value = float(value)
    if abs(value) >= 1e7:
        return f"₹{value / 1e7:,.2f} Cr"
    if abs(value) >= 1e5:
        return f"₹{value / 1e5:,.2f} L"
    return f"₹{value:,.{decimals}f}"


def format_number(value: float | int | None, decimals: int = 0) -> str:
    if value is None or pd.isna(value):
        return "—"
    return f"{value:,.{decimals}f}"


def metric_rows(metrics: pd.DataFrame) -> pd.DataFrame:
    """Add readable labels used across tables and charts."""
    frame = metrics.copy()
    frame["category_label"] = frame["category"].map(category_label)
    frame["fund"] = frame["name"].map(short_name)
    return frame
