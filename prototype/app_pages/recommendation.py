from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from mflyzer.dashboard import (
    CATEGORY_COLORS,
    CATEGORY_ORDER,
    category_label,
    format_inr,
    format_pct,
    require_artifacts,
    short_name,
)
from mflyzer.dashboard.charts import style_figure

data = require_artifacts()
meta = data["metadata"]
recommendation = data["recommendation"].copy()
category_targets = data["category_targets"].copy()
deployment = data["deployment"]

settings = meta["settings"]
allocation = meta["allocation"]

st.title("Recommendation")
st.caption(
    "A fully invested equity sleeve, sized by age, horizon, and risk tolerance. "
    "The debt/cash gap is left outside this fund universe."
)

with st.container(horizontal=True):
    st.metric("Age", f"{settings['AGE']}", border=True)
    st.metric("Horizon", f"{settings['HORIZON']:g} years", border=True)
    st.metric("Risk tolerance", f"{settings['RISK']} / 5", border=True)
    st.metric("Mode", settings["MODE"].upper(), border=True)
    st.metric(
        "Amount",
        format_inr(settings["AMOUNT"]),
        delta="per month" if settings["MODE"] == "sip" else "one-time",
        delta_color="off",
        border=True,
    )

equity_col, gap_col, vol_col = st.columns(3)
with equity_col:
    st.metric(
        "Equity allocation",
        format_inr(settings["AMOUNT"] * allocation["equity_target_pct"] / 100)
        if settings["MODE"] == "lumpsum"
        else format_inr(settings["AMOUNT"] * allocation["equity_target_pct"] / 100) + " / month",
        delta=format_pct(allocation["equity_target_pct"] / 100),
        delta_description="of the plan",
        border=True,
    )
with gap_col:
    st.metric(
        "Debt / cash gap",
        format_inr(settings["AMOUNT"] * allocation["debt_cash_gap_pct"] / 100)
        if settings["MODE"] == "lumpsum"
        else format_inr(settings["AMOUNT"] * allocation["debt_cash_gap_pct"] / 100) + " / month",
        delta=format_pct(allocation["debt_cash_gap_pct"] / 100),
        delta_description="outside this data",
        delta_color="off",
        border=True,
    )
with vol_col:
    st.metric(
        "Expected volatility",
        format_pct(allocation["expected_volatility"]),
        delta="optimizer constraint",
        delta_color="off",
        border=True,
    )

recommendation["fund"] = recommendation["name"].map(short_name)
recommendation["category_label"] = recommendation["category"].map(category_label)
recommendation = recommendation.sort_values("weight", ascending=True)

left, right = st.columns([1.6, 1])

with left:
    with st.container(border=True):
        st.subheader("Recommended fund weights")
        fig = px.bar(
            recommendation,
            x="weight",
            y="fund",
            color="category_label",
            orientation="h",
            color_discrete_map={
                category_label(cat): color for cat, color in CATEGORY_COLORS.items()
            },
            labels={"weight": "Share of equity sleeve", "fund": "", "category_label": "Category"},
            text=recommendation["weight"].map(lambda value: f"{value:.1%}"),
        )
        fig.update_traces(textposition="outside", cliponaxis=False)
        fig.update_xaxes(tickformat=".0%", range=[0, recommendation["weight"].max() * 1.25])
        st.plotly_chart(
            style_figure(fig, height=400),
            alt="Horizontal bar chart of recommended fund weights by category",
        )

with right:
    with st.container(border=True):
        st.subheader("Equity vs debt / cash")
        pie_frame = deployment.copy()
        pie_frame["bucket"] = pie_frame["bucket"].replace(
            {"Debt / cash (outside universe)": "Debt / cash gap"}
        )
        fig = px.pie(
            pie_frame,
            names="bucket",
            values="amount",
            hole=0.58,
            color="bucket",
            color_discrete_map={
                "Equity funds": "#1D4ED8",
                "Debt / cash gap": "#94A3B8",
            },
        )
        fig.update_traces(textinfo="percent", hovertemplate="%{label}<br>%{value:,.0f}<extra></extra>")
        st.plotly_chart(
            style_figure(fig, height=400, showlegend=True),
            alt="Donut chart splitting the plan between equity funds and the debt or cash gap",
        )

with st.container(border=True):
    st.subheader("Where the money goes")
    table = recommendation.sort_values("weight", ascending=False).copy()
    table["amount"] = table["amount"].round(0)
    st.dataframe(
        table[
            [
                "fund",
                "category_label",
                "weight",
                "amount",
                "score",
                "cagr_3y",
                "sharpe_3y",
                "max_drawdown",
            ]
        ],
        column_config={
            "fund": st.column_config.TextColumn("Fund", width="large"),
            "category_label": st.column_config.TextColumn("Category"),
            "weight": st.column_config.NumberColumn("Equity weight", format="percent", help="Share of the equity sleeve."),
            "amount": st.column_config.NumberColumn(
                "Monthly amount (₹)" if settings["MODE"] == "sip" else "Amount (₹)",
                format="%.0f",
            ),
            "score": st.column_config.ProgressColumn(
                "Quality score", min_value=0, max_value=100, format="%.1f"
            ),
            "cagr_3y": st.column_config.NumberColumn("3-year CAGR", format="percent"),
            "sharpe_3y": st.column_config.NumberColumn("Sharpe", format="%.2f"),
            "max_drawdown": st.column_config.NumberColumn("Max drawdown", format="percent"),
        },
        hide_index=True,
        alt="Recommended funds with weights, amounts, quality scores, and risk metrics",
    )
    st.caption(
        "Amounts are the equity-sleeve share of the plan. The score is the "
        "category-relative quality score; the return and risk columns are the evidence "
        "behind it."
    )

left, right = st.columns(2)

with left:
    with st.container(border=True):
        st.subheader("Category mix: target vs optimizer")
        actual = recommendation.groupby("category")["weight"].sum() * 100
        targets = category_targets.set_index("category")["target"] * 100
        compare = pd.DataFrame({
            "category": [category_label(cat) for cat in CATEGORY_ORDER],
            "Target": [targets.get(cat, 0) for cat in CATEGORY_ORDER],
            "Optimizer": [actual.get(cat, 0) for cat in CATEGORY_ORDER],
        })
        fig = px.bar(
            compare,
            x="category",
            y=["Target", "Optimizer"],
            barmode="group",
            color_discrete_sequence=["#94A3B8", "#1D4ED8"],
            labels={"value": "Share of equity sleeve (%)", "category": "", "variable": ""},
        )
        fig.update_yaxes(ticksuffix="%")
        st.plotly_chart(
            style_figure(fig, height=340),
            alt="Target category weights compared with the optimizer's final weights",
        )
        st.caption(
            "The optimizer may move each category up to five percentage points from target."
        )

with right:
    with st.container(border=True):
        st.subheader("Why this mix")
        st.markdown(
            f"""
            - **Equity target {allocation['equity_target_pct']:.1f}%** comes from
              age, horizon, and risk tolerance, with hard caps for short horizons.
            - **Profile: {allocation['profile'].title()}** selects the starting
              category mix. Short horizons block mid and small caps entirely.
            - **Fund shortlist:** up to two funds per category. SIP mode tilts
              toward SIP XIRR; lump sum tilts toward Calmar.
            - **Weights:** the optimizer maximizes expected return minus a risk
              penalty while staying long-only, fully invested, 3–30% per fund,
              and under a {format_pct(allocation['vol_budget'])} volatility budget.
            """
        )
        st.caption(
            "The optimizer solved this run."
            if allocation["optimizer_solved"]
            else "The optimizer did not solve this run; category targets were split across the shortlist."
        )

if meta["warnings"]:
    with st.expander("Warnings for this run", icon=":material/warning:"):
        for warning in meta["warnings"]:
            st.markdown(f"- {warning}")
