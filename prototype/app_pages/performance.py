from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from mflyzer.dashboard import format_pct, require_artifacts
from mflyzer.dashboard.charts import style_figure

data = require_artifacts()
meta = data["metadata"]
history = data["portfolio_history"].copy()
returns = data["portfolio_returns"].copy()
performance = data["performance"].copy()
stress = data["stress"].copy()

perf = meta["portfolio"]["performance"]

st.title("Portfolio performance")
st.caption(
    f"Historical check from {meta['portfolio']['recent_start']} to "
    f"{meta['portfolio']['recent_end']}. The benchmark is an equal-weight composite "
    "of index funds, not the official Nifty 500 TRI."
)

with st.container(horizontal=True):
    st.metric(
        "CAGR",
        format_pct(perf["CAGR"]["portfolio"]),
        delta=f"{(perf['CAGR']['portfolio'] - perf['CAGR']['benchmark']) * 100:+.1f} pp",
        delta_description="vs Nifty 500 proxy",
        border=True,
    )
    st.metric(
        "Volatility",
        format_pct(perf["Volatility"]["portfolio"]),
        delta=f"{(perf['Volatility']['portfolio'] - perf['Volatility']['benchmark']) * 100:+.1f} pp",
        delta_description="vs Nifty 500 proxy",
        delta_color="off",
        border=True,
    )
    st.metric(
        "Sharpe",
        f"{perf['Sharpe']['portfolio']:.2f}",
        delta=f"{perf['Sharpe']['portfolio'] - perf['Sharpe']['benchmark']:+.2f}",
        delta_description="vs Nifty 500 proxy",
        border=True,
    )
    st.metric(
        "Maximum drawdown",
        format_pct(perf["Max drawdown"]["portfolio"]),
        delta=f"{(perf['Max drawdown']['portfolio'] - perf['Max drawdown']['benchmark']) * 100:+.1f} pp",
        delta_description="vs Nifty 500 proxy",
        delta_color="off",
        border=True,
    )
    st.metric(
        "SIP XIRR",
        format_pct(meta["portfolio"]["sip_xirr"]),
        delta="5-year money-weighted",
        delta_color="off",
        border=True,
    )

with st.container(border=True):
    st.subheader("Value of ₹1 invested")
    curve = history.copy()
    curve = curve.rename(
        columns={
            "portfolio_value": "Portfolio",
            "benchmark_value": "Nifty 500 proxy",
        }
    )
    fig = px.line(
        curve,
        x="date",
        y=["Portfolio", "Nifty 500 proxy"],
        color_discrete_sequence=["#1D4ED8", "#94A3B8"],
        labels={"value": "Value of ₹1", "date": "", "variable": ""},
    )
    fig.update_yaxes(tickprefix="₹", tickformat=".2f")
    st.plotly_chart(
        style_figure(fig, height=400),
        alt="Cumulative value of one rupee invested in the portfolio and the Nifty 500 proxy",
    )

left, right = st.columns(2)

with left:
    with st.container(border=True):
        st.subheader("Drawdown")
        drawdown = history.copy()
        drawdown = drawdown.rename(
            columns={
                "portfolio_drawdown": "Portfolio",
                "benchmark_drawdown": "Nifty 500 proxy",
            }
        )
        fig = go.Figure()
        for column, color in [("Portfolio", "#1D4ED8"), ("Nifty 500 proxy", "#94A3B8")]:
            fig.add_trace(
                go.Scatter(
                    x=drawdown["date"],
                    y=drawdown[column],
                    name=column,
                    mode="lines",
                    line=dict(color=color, width=2),
                    fill="tozeroy" if column == "Portfolio" else None,
                    fillcolor="rgba(29, 78, 216, 0.12)" if column == "Portfolio" else None,
                    hovertemplate="%{x|%b %Y}<br>%{y:.1%}<extra></extra>",
                )
            )
        fig.update_yaxes(tickformat=".0%")
        st.plotly_chart(
            style_figure(fig, height=340),
            alt="Portfolio and benchmark drawdown from their previous peaks",
        )

with right:
    with st.container(border=True):
        st.subheader("Rolling 12-month return")
        monthly = returns.set_index("date").sort_index()
        rolling = (1 + monthly).rolling(12).apply(np.prod, raw=True) - 1
        rolling = rolling.dropna().reset_index()
        rolling = rolling.rename(
            columns={"portfolio": "Portfolio", "benchmark": "Nifty 500 proxy"}
        )
        fig = px.line(
            rolling,
            x="date",
            y=["Portfolio", "Nifty 500 proxy"],
            color_discrete_sequence=["#1D4ED8", "#94A3B8"],
            labels={"value": "Rolling 12-month return", "date": "", "variable": ""},
        )
        fig.update_yaxes(tickformat=".0%")
        fig.add_hline(y=0, line_dash="dash", line_color="#64748B", line_width=1)
        st.plotly_chart(
            style_figure(fig, height=340),
            alt="Rolling twelve-month returns of the portfolio and the benchmark",
        )

left, right = st.columns([1.2, 1])

with left:
    with st.container(border=True):
        st.subheader("Summary statistics")
        summary = performance.pivot(index="metric", columns="series", values="value")
        summary = summary.rename(columns={"Market (Nifty 500)": "Nifty 500 proxy"})
        summary = summary.loc[["CAGR", "Volatility", "Sharpe", "Max drawdown"]]
        display = summary.astype(object).copy()
        for metric_name in ["CAGR", "Volatility", "Max drawdown"]:
            display.loc[metric_name] = display.loc[metric_name].map(
                lambda value: f"{value:.1%}"
            )
        display.loc["Sharpe"] = display.loc["Sharpe"].map(lambda value: f"{value:.2f}")
        st.dataframe(display, alt="Portfolio and benchmark summary statistics")
        st.caption(
            "Volatility is annualised monthly standard deviation. Sharpe uses a "
            f"{meta['settings']['RISK_FREE']:.1%} annual risk-free rate."
        )

with right:
    with st.container(border=True):
        st.subheader("Stress episodes")
        for _, row in stress.iterrows():
            st.metric(
                row["episode"],
                format_pct(row["return"]),
                delta=f"{row['start']} to {row['end']}",
                delta_color="off",
                border=True,
            )
        st.caption(
            "Each episode is the compounded portfolio return over the stated window. "
            "These are historical replays, not forecasts."
        )

st.info(
    "The market series is an equal-weight composite of Nifty 50, Nifty 500, "
    "Midcap 150, and Smallcap 250 index funds already in the universe. "
    "It is a fund-based proxy, so tracking error and expense ratios differ from the official indices.",
    title="About the benchmark",
    icon=":material/info:",
)
