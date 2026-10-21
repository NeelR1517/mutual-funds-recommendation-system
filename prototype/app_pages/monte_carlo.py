from __future__ import annotations

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from mflyzer.dashboard import format_inr, format_pct, require_artifacts
from mflyzer.dashboard.charts import style_figure

data = require_artifacts()
meta = data["metadata"]
mc = data["monte_carlo"].copy()
paths = data["monte_carlo_paths"].copy()
sim = meta["portfolio"]["monte_carlo"]
settings = meta["settings"]

st.title("Monte Carlo")
st.caption(
    "A range of outcomes, not a forecast. The simulation resamples the portfolio's "
    "recent monthly returns and applies the chosen SIP or lump-sum plan."
)

with st.container(horizontal=True):
    st.metric(
        "Median terminal value",
        format_inr(sim["median"]),
        delta=f"after {sim['months'] / 12:.0f} years",
        delta_color="off",
        border=True,
    )
    st.metric(
        "5th–95th percentile",
        f"{format_inr(sim['p05'])} – {format_inr(sim['p95'])}",
        border=True,
    )
    st.metric(
        "Below contributions",
        format_pct(sim["probability_below_contributions"]),
        delta="probability",
        delta_color="off",
        border=True,
    )
    st.metric(
        "Median max drawdown",
        format_pct(sim["median_max_drawdown"]),
        border=True,
    )
    st.metric(
        "Worst 5% drawdown",
        format_pct(sim["worst_5pct_max_drawdown"]),
        border=True,
    )

left, right = st.columns([1.5, 1])

with left:
    with st.container(border=True):
        st.subheader("Terminal value distribution")
        plot = mc.copy()
        plot["value_lakh"] = plot["value"] / 1e5
        invested_lakh = sim["invested"] / 1e5
        median_lakh = sim["median"] / 1e5
        fig = px.histogram(
            plot,
            x="value_lakh",
            nbins=55,
            color_discrete_sequence=["#1D4ED8"],
            labels={"value_lakh": "Terminal value (₹ lakh)", "count": "Paths"},
        )
        fig.update_traces(marker_line_width=0)
        fig.add_vline(
            x=invested_lakh,
            line_dash="dash",
            line_color="#DC2626",
            annotation_text="Contributions",
            annotation_position="top",
        )
        fig.add_vline(
            x=median_lakh,
            line_dash="dot",
            line_color="#059669",
            annotation_text="Median",
            annotation_position="top",
        )
        st.plotly_chart(
            style_figure(fig, height=400),
            alt="Histogram of simulated terminal portfolio values with contributions and median marked",
        )

with right:
    with st.container(border=True):
        st.subheader("Plan assumptions")
        st.metric("Mode", settings["MODE"].upper(), border=False)
        st.metric(
            "Contribution",
            format_inr(settings["AMOUNT"]),
            delta="per month" if settings["MODE"] == "sip" else "one-time",
            delta_color="off",
            border=False,
        )
        st.metric("Total invested", format_inr(sim["invested"]), border=False)
        st.metric("Paths", f"{sim['paths']:,}", border=False)
        st.metric("Horizon", f"{sim['months']} months", border=False)
        st.caption(sim["method"])

with st.container(border=True):
    st.subheader("Sample paths")
    path_plot = paths.copy()
    path_plot["value_lakh"] = path_plot["value"] / 1e5
    fig = px.line(
        path_plot,
        x="month",
        y="value_lakh",
        color="path",
        color_discrete_sequence=["#1D4ED8"] * path_plot["path"].nunique(),
        labels={"month": "Months from start", "value_lakh": "Portfolio value (₹ lakh)"},
    )
    fig.update_traces(line=dict(width=0.8), opacity=0.18)
    fig.update_layout(showlegend=False)

    if settings["MODE"] == "sip":
        months = sim["months"]
        contributions = [settings["AMOUNT"] * month / 1e5 for month in range(months + 1)]
        fig.add_trace(
            go.Scatter(
                x=list(range(months + 1)),
                y=contributions,
                mode="lines",
                name="Contributions",
                line=dict(color="#DC2626", width=2, dash="dash"),
                hovertemplate="Month %{x}<br>₹%{y:.1f} lakh contributed<extra></extra>",
            )
        )
    else:
        fig.add_hline(
            y=sim["invested"] / 1e5,
            line_dash="dash",
            line_color="#DC2626",
            annotation_text="Contribution",
            annotation_position="top left",
        )

    st.plotly_chart(
        style_figure(fig, height=380, showlegend=settings["MODE"] == "lumpsum"),
        alt="Fifteen sample simulated portfolio value paths over the investment horizon",
    )
    st.caption(
        "Each faint line is one sampled path. The dashed red line is money contributed, "
        "so the gap above it is simulated gain."
    )

left, right = st.columns(2)

with left:
    with st.container(border=True):
        st.subheader("Drawdown distribution")
        fig = px.histogram(
            mc,
            x="max_drawdown",
            nbins=40,
            color_discrete_sequence=["#7C3AED"],
            labels={"max_drawdown": "Maximum drawdown", "count": "Paths"},
        )
        fig.update_traces(marker_line_width=0)
        fig.add_vline(
            x=sim["median_max_drawdown"],
            line_dash="dash",
            line_color="#DC2626",
            annotation_text="Median",
            annotation_position="top",
        )
        fig.update_xaxes(tickformat=".0%")
        st.plotly_chart(
            style_figure(fig, height=340),
            alt="Histogram of maximum drawdowns across Monte Carlo paths",
        )

with right:
    with st.container(border=True):
        st.subheader("What this does and does not say")
        st.markdown(
            f"""
            - **Uses:** {sim['paths']:,} paths, {sim['months']} months, the
              last five years of portfolio monthly returns.
            - **Does not use:** fees, taxes, exit loads, or a changing interest-rate
              regime. Returns are sampled independently, so streaks and volatility
              clustering are not modelled.
            - **Interpretation:** the spread shows how much the ending value depends
              on the order of returns. A wide spread is a risk warning, not a promise.
            """
        )
        st.warning(
            "Do not treat the median as a target. The 5th percentile is the more useful "
            "planning number.",
            title="Use the downside, not the median",
            icon=":material/priority_high:",
        )
