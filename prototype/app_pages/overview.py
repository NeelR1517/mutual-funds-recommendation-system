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
)
from mflyzer.dashboard.charts import style_figure

data = require_artifacts()
meta = data["metadata"]
metrics = data["metrics"]
recommendation = data["recommendation"]

st.title("Fund quality, portfolio, and the evidence behind it")
st.caption(
    f"Generated {pd.Timestamp(meta['generated_at']).strftime('%d %b %Y, %H:%M UTC')} "
    f"from {meta['universe']['nav_rows']:,} NAV observations "
    f"({meta['universe']['nav_start']} to {meta['universe']['nav_end']})."
)

performance = meta["portfolio"]["performance"]
portfolio_cagr = performance["CAGR"]["portfolio"]
benchmark_cagr = performance["CAGR"]["benchmark"]
equity_pct = meta["allocation"]["equity_target_pct"]

with st.container(horizontal=True):
    st.metric(
        "Funds analysed",
        f"{meta['universe']['funds_with_metrics']:,}",
        delta=f"{meta['universe']['direct_growth_candidates']:,} candidates screened",
        delta_color="off",
        border=True,
    )
    st.metric(
        "Candidate pool",
        f"{meta['universe']['funds_in_top']:,}",
        delta="top quality scores",
        delta_color="off",
        border=True,
    )
    st.metric(
        "Recommended funds",
        f"{len(recommendation)}",
        delta=f"{meta['settings']['MODE']} portfolio",
        delta_color="off",
        border=True,
    )
    st.metric(
        "Equity target",
        format_pct(equity_pct / 100),
        delta=f"{100 - equity_pct:.1f}% debt / cash gap",
        delta_color="off",
        border=True,
    )
    st.metric(
        "Portfolio CAGR",
        format_pct(portfolio_cagr),
        delta=f"{(portfolio_cagr - benchmark_cagr) * 100:+.1f} pp",
        delta_description="vs Nifty 500 proxy",
        border=True,
    )

ml_gate = meta["scoring"]["ml_gate"]
if not ml_gate["passed"]:
    st.warning(
        f"Forward-1-year rank IC was {ml_gate['rank_ic']:.2f}, below the "
        f"{ml_gate['threshold']:.2f} gate. The ranking is rule-based only; "
        "the ML model was not blended into the scores.",
        title="The ML gate failed",
        icon=":material/rule:",
    )

if any("Mid + small caps exceed" in warning for warning in meta["warnings"]):
    st.warning(
        "Mid and small caps are above 45% of the equity sleeve. "
        "That is deliberate for this aggressive profile, but it is the main "
        "source of portfolio risk.",
        title="Mid + small cap concentration",
        icon=":material/warning:",
    )

left, right = st.columns(2)

with left:
    with st.container(border=True):
        st.subheader("Where the candidate pool comes from")
        st.caption(
            "The same five categories are scored separately. Uneven category sizes "
            "are filled with the best remaining funds so slots are not wasted."
        )
        counts = pd.DataFrame({
            "category": [category_label(cat) for cat in CATEGORY_ORDER],
            "Universe": [
                meta["universe"]["category_counts"].get(cat, 0) for cat in CATEGORY_ORDER
            ],
            "Top pool": [
                meta["universe"]["top_category_counts"].get(cat, 0) for cat in CATEGORY_ORDER
            ],
        })
        fig = px.bar(
            counts,
            x=["Universe", "Top pool"],
            y="category",
            orientation="h",
            barmode="group",
            color_discrete_sequence=["#94A3B8", "#1D4ED8"],
            labels={"value": "Funds", "variable": ""},
        )
        fig.update_yaxes(categoryorder="array", categoryarray=counts["category"].tolist()[::-1])
        fig.update_layout(title=None)
        st.plotly_chart(
            style_figure(fig, height=340),
            alt="Fund counts by category in the full universe and the top pool",
        )

with right:
    with st.container(border=True):
        st.subheader("Scores are relative to each category")
        st.caption(
            "A small-cap fund is compared with other small-cap funds, not with large caps. "
            "That keeps the 0–100 score about quality, not about category risk."
        )
        score_frame = metrics.copy()
        score_frame["category_label"] = score_frame["category"].map(category_label)
        fig = px.box(
            score_frame,
            x="category_label",
            y="score",
            color="category_label",
            color_discrete_map={category_label(cat): color for cat, color in CATEGORY_COLORS.items()},
            category_orders={"category_label": [category_label(cat) for cat in CATEGORY_ORDER]},
            points="outliers",
        )
        fig.update_layout(showlegend=False, xaxis_title="", yaxis_title="Composite score")
        fig.update_yaxes(range=[0, 100])
        st.plotly_chart(
            style_figure(fig, height=340),
            alt="Distribution of composite quality scores within each fund category",
        )

st.subheader("How the recommendation was built")
steps = [
    (
        "filter_alt",
        "1. Screen",
        f"{meta['universe']['schemes_total']:,} schemes → "
        f"{meta['universe']['direct_growth_candidates']:,} Direct-Growth candidates → "
        f"{meta['universe']['funds_with_metrics']} with enough live NAV history.",
    ),
    (
        "leaderboard",
        "2. Score",
        "Nine return, risk, consistency, and momentum metrics are percentile-ranked "
        "inside each category and weighted into a 0–100 score.",
    ),
    (
        "tune",
        "3. Fit the investor",
        f"Age {meta['settings']['AGE']}, horizon {meta['settings']['HORIZON']:g} years, "
        f"risk {meta['settings']['RISK']}/5, and a {meta['settings']['MODE']} plan set "
        f"a {equity_pct:.0f}% equity target and the category mix.",
    ),
    (
        "query_stats",
        "4. Test the result",
        "A constrained optimizer picks fund weights. The portfolio is then checked "
        "against Nifty 500, two stress episodes, and 2,000 Monte Carlo paths.",
    ),
]
for column, (icon, title, body) in zip(st.columns(4, border=True), steps):
    with column:
        st.markdown(f"##### :material/{icon}: {title}")
        st.caption(body)

with st.container(border=True):
    st.subheader("Plan at a glance")
    plan_col, gap_col, amount_col = st.columns(3)
    with plan_col:
        st.metric(
            "Equity sleeve",
            format_pct(equity_pct / 100),
            delta=meta["allocation"]["profile"].title(),
            delta_color="off",
        )
    with gap_col:
        st.metric(
            "Debt / cash gap",
            format_pct(meta["allocation"]["debt_cash_gap_pct"] / 100),
            delta="outside this universe",
            delta_color="off",
        )
    with amount_col:
        amount = meta["settings"]["AMOUNT"]
        st.metric(
            "Plan amount",
            format_inr(amount),
            delta=meta["settings"]["MODE"].upper(),
            delta_color="off",
        )
    st.caption(
        "The debt / cash gap is explicit because mfapi.in exposes equity funds only. "
        "It is not a recommendation to hold cash; it is the part this data cannot fill."
    )
