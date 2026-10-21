from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from mflyzer.dashboard import (
    CATEGORY_COLORS,
    CATEGORY_ORDER,
    METRIC_HELP,
    category_label,
    format_pct,
    require_artifacts,
    short_name,
)
from mflyzer.dashboard.charts import style_figure

data = require_artifacts()
meta = data["metadata"]
metrics = data["metrics"].copy()
top = data["top"]
nav = data["nav_monthly"].copy()
nav["date"] = pd.to_datetime(nav["date"])

metrics["fund"] = metrics["name"].map(short_name)
metrics["category_label"] = metrics["category"].map(category_label)
metrics["in_top"] = metrics["code"].isin(top["code"])

st.title("Fund universe")
st.caption(
    f"{len(metrics)} funds with enough live NAV history. Filter, sort, and open any "
    "fund to see its metrics and NAV path."
)

with st.sidebar:
    st.divider()
    st.subheader("Fund filters", anchor=False)
    selected_categories = st.multiselect(
        "Category",
        options=CATEGORY_ORDER,
        default=CATEGORY_ORDER,
        format_func=category_label,
    )
    query = st.text_input(
        "Search",
        placeholder="Fund or AMC name",
        help="Case-insensitive search across fund and AMC names.",
    )
    only_top = st.toggle("Only the 200-fund pool", value=True)

filtered = metrics.loc[metrics["category"].isin(selected_categories)].copy()
if only_top:
    filtered = filtered.loc[filtered["in_top"]]
if query.strip():
    needle = query.strip()
    filtered = filtered.loc[
        filtered["name"].str.contains(needle, case=False, na=False)
        | filtered["amc"].str.contains(needle, case=False, na=False)
    ]

if filtered.empty:
    st.info("No funds match these filters.", icon=":material/filter_alt_off:")
    st.stop()

sort_metric = st.selectbox(
    "Sort by",
    options=["score", "cagr_3y", "cagr_5y", "sip_xirr", "sharpe_3y", "max_drawdown", "vol_3y"],
    format_func=lambda key: {
        "score": "Quality score",
        "cagr_3y": "3-year CAGR",
        "cagr_5y": "5-year CAGR",
        "sip_xirr": "SIP XIRR",
        "sharpe_3y": "3-year Sharpe",
        "max_drawdown": "Maximum drawdown",
        "vol_3y": "3-year volatility",
    }[key],
)
filtered = filtered.sort_values(sort_metric, ascending=(sort_metric in {"max_drawdown", "vol_3y"}))

with st.container(border=True):
    st.subheader("Risk vs return")
    fig = px.scatter(
        filtered,
        x="vol_3y",
        y="cagr_3y",
        color="category_label",
        size="score",
        size_max=18,
        hover_name="fund",
        hover_data={
            "amc": True,
            "score": ":.1f",
            "max_drawdown": ":.1%",
            "sip_xirr": ":.1%",
            "category_label": False,
        },
        color_discrete_map={
            category_label(cat): color for cat, color in CATEGORY_COLORS.items()
        },
        labels={
            "vol_3y": "3-year annualised volatility",
            "cagr_3y": "3-year CAGR",
            "category_label": "Category",
        },
        opacity=0.8,
    )
    fig.add_vline(
        x=filtered["vol_3y"].median(),
        line_dash="dot",
        line_color="#94A3B8",
        line_width=1,
    )
    fig.add_hline(
        y=filtered["cagr_3y"].median(),
        line_dash="dot",
        line_color="#94A3B8",
        line_width=1,
    )
    fig.update_xaxes(tickformat=".0%")
    fig.update_yaxes(tickformat=".0%")
    st.plotly_chart(
        style_figure(fig, height=440),
        alt="Scatter plot of three-year return against volatility, colored by fund category",
    )
    st.caption(
        "Top-right is more return for more risk. Bubble size is the quality score. "
        "Dotted lines are the medians of the current filter."
    )

with st.container(border=True):
    st.subheader("Fund metrics")
    table = filtered.copy()
    table["years"] = table["years"].round(1)
    st.dataframe(
        table[
            [
                "fund",
                "category_label",
                "amc",
                "score",
                "cagr_3y",
                "cagr_5y",
                "sip_xirr",
                "vol_3y",
                "sharpe_3y",
                "max_drawdown",
                "years",
                "in_top",
            ]
        ],
        column_config={
            "fund": st.column_config.TextColumn("Fund", width="large"),
            "category_label": st.column_config.TextColumn("Category"),
            "amc": st.column_config.TextColumn("AMC"),
            "score": st.column_config.ProgressColumn(
                "Quality score", min_value=0, max_value=100, format="%.1f"
            ),
            "cagr_3y": st.column_config.NumberColumn("3-year CAGR", format="percent", help=METRIC_HELP["cagr_3y"]),
            "cagr_5y": st.column_config.NumberColumn("5-year CAGR", format="percent", help=METRIC_HELP["cagr_5y"]),
            "sip_xirr": st.column_config.NumberColumn("SIP XIRR", format="percent", help=METRIC_HELP["sip_xirr"]),
            "vol_3y": st.column_config.NumberColumn("Volatility", format="percent"),
            "sharpe_3y": st.column_config.NumberColumn("Sharpe", format="%.2f", help=METRIC_HELP["sharpe_3y"]),
            "max_drawdown": st.column_config.NumberColumn("Max drawdown", format="percent", help=METRIC_HELP["max_drawdown"]),
            "years": st.column_config.NumberColumn("History (years)", format="%.1f"),
            "in_top": st.column_config.CheckboxColumn("In top pool"),
        },
        hide_index=True,
        alt="Filterable table of fund quality scores and risk and return metrics",
    )
    st.caption(
        "The top pool is a quality ranking, not a size ranking. Negative drawdowns are "
        "kept as negative numbers so sorting is intuitive."
    )

st.divider()

st.subheader("Look up a fund")
available = filtered.loc[filtered["code"].isin(nav["code"].unique())].copy()
if available.empty:
    st.info(
        "No NAV series is available for the current filter. Clear the filters or turn "
        "off the top-pool restriction to see more funds.",
        icon=":material/show_chart:",
    )
    st.stop()

fund_code = st.selectbox(
    "Fund",
    options=available["code"].tolist(),
    format_func=lambda code: available.loc[available["code"] == code, "fund"].iloc[0],
    key="universe_fund",
)
fund = available.loc[available["code"] == fund_code].iloc[0]

with st.container(horizontal=True):
    st.metric("Quality score", f"{fund['score']:.1f}", border=True)
    st.metric("Category", category_label(fund["category"]), border=True)
    st.metric("3-year CAGR", format_pct(fund["cagr_3y"]), border=True)
    st.metric("SIP XIRR", format_pct(fund["sip_xirr"]), border=True)
    st.metric("Volatility", format_pct(fund["vol_3y"]), border=True)
    st.metric("Max drawdown", format_pct(fund["max_drawdown"]), border=True)

window = st.segmented_control(
    "NAV window",
    options=["1 year", "3 years", "5 years", "All"],
    default="3 years",
    help="Monthly NAV history for the selected fund.",
)
if window is None:
    window = "3 years"

fund_nav = nav.loc[nav["code"] == fund_code].sort_values("date")
if window != "All":
    years = {"1 year": 1, "3 years": 3, "5 years": 5}[window]
    start = fund_nav["date"].max() - pd.DateOffset(years=years)
    fund_nav = fund_nav.loc[fund_nav["date"] >= start]

with st.container(border=True):
    st.subheader(short_name(fund["name"]))
    fig = px.line(
        fund_nav,
        x="date",
        y="nav",
        color_discrete_sequence=[CATEGORY_COLORS.get(fund["category"], "#1D4ED8")],
        labels={"date": "", "nav": "NAV (₹)"},
    )
    fig.update_yaxes(tickprefix="₹", tickformat=",.2f")
    fig.update_layout(showlegend=False)
    st.plotly_chart(
        style_figure(fig, height=340),
        alt=f"Monthly NAV history for {short_name(fund['name'])}",
    )
    st.caption(
        f"AMC: {fund['amc']} · Code: {int(fund['code'])} · "
        f"History: {fund['years']:.1f} years · "
        f"Open the Score basis page to see the metric percentiles behind the score."
    )
