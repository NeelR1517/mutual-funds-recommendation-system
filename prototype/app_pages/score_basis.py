from __future__ import annotations

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from mflyzer.dashboard import (
    CATEGORY_COLORS,
    CATEGORY_ORDER,
    METRIC_HELP,
    METRIC_LABELS,
    category_label,
    format_pct,
    require_artifacts,
    short_name,
)
from mflyzer.dashboard.charts import style_figure

data = require_artifacts()
meta = data["metadata"]
top = data["top"].copy()
score_breakdown = data["score_breakdown"].copy()
score_weights = data["score_weights"].copy()
ml_test = data["ml_test_predictions"].copy()
ml_coefficients = data["ml_coefficients"].copy()

metric_order = score_weights["metric"].tolist()
metric_labels = {metric: METRIC_LABELS.get(metric, metric) for metric in metric_order}

st.title("Score basis")
st.caption(
    "Every score is a weighted average of category-relative percentiles. "
    "This page shows the exact inputs, the weights, and the ML gate that would "
    "have changed the ranking."
)

ml_gate = meta["scoring"]["ml_gate"]
if ml_gate["passed"]:
    st.success(
        f"The Ridge model passed the gate with rank IC {ml_gate['rank_ic']:.2f}. "
        f"It contributes {ml_gate['blend_weight']:.0%} of the final score.",
        title="The ML blend is active",
        icon=":material/check_circle:",
    )
else:
    st.warning(
        f"Rank IC was {ml_gate['rank_ic']:.2f}, below the {ml_gate['threshold']:.2f} "
        "threshold, so the ML model was not blended in. The ranking below is entirely "
        "rule-based.",
        title="The ML gate failed",
        icon=":material/rule:",
    )

left, right = st.columns([1, 1.4])

with left:
    with st.container(border=True):
        st.subheader("Metric weights")
        weight_frame = score_weights.copy()
        weight_frame["metric_label"] = weight_frame["metric"].map(metric_labels)
        weight_frame = weight_frame.sort_values("weight", ascending=True)
        fig = px.bar(
            weight_frame,
            x="weight",
            y="metric_label",
            orientation="h",
            color="weight",
            color_continuous_scale="Blues",
            labels={"weight": "Weight in the composite", "metric_label": ""},
            text=weight_frame["weight"].map(lambda value: f"{value:.0%}"),
        )
        fig.update_traces(textposition="outside", cliponaxis=False)
        fig.update_xaxes(tickformat=".0%", range=[0, 0.18])
        fig.update_layout(coloraxis_showscale=False)
        st.plotly_chart(
            style_figure(fig, height=380),
            alt="Bar chart of the weights assigned to each scoring metric",
        )

with right:
    with st.container(border=True):
        st.subheader("The formula")
        st.markdown(
            r"""
            For each fund, every available metric is converted to a **percentile
            inside its own category**:

            $$p_i = \operatorname{rank}_{\\text{category}}(m_i) / n_{\\text{category}}$$

            The score is the weighted average, rescaled when a metric is missing:

            $$\text{score} = 100 \times
            \frac{\sum_i w_i p_i}{\sum_i w_i \,\text{for available } p_i}$$

            Missing metrics — usually 5-year CAGR for younger funds — are dropped
            rather than filled. The result is always on a 0–100 scale, where 100 is
            the best available fund in that category on the weighted mix.
            """
        )
        st.caption(
            "The composite intentionally has no risk bonus or penalty. Risk is "
            "handled by the suitability policy and the portfolio optimizer."
        )

st.divider()

st.subheader("Inspect one fund")
fund_options = top.sort_values("rank")["code"].tolist()

default_code = (
    data["recommendation"].sort_values("weight", ascending=False).iloc[0]["code"]
    if not data["recommendation"].empty
    else fund_options[0]
)
selected_code = st.selectbox(
    "Fund",
    options=fund_options,
    index=fund_options.index(default_code) if default_code in fund_options else 0,
    format_func=lambda code: short_name(
        top.loc[top["code"] == code, "name"].iloc[0]
    ),
    help="Choose any fund in the 200-fund candidate pool.",
)
selected = top.loc[top["code"] == selected_code].iloc[0]
selected_breakdown = score_breakdown.loc[score_breakdown["code"] == selected_code].copy()
selected_breakdown["metric_label"] = selected_breakdown["metric"].map(metric_labels)
selected_breakdown = selected_breakdown.set_index("metric").reindex(metric_order)

with st.container(horizontal=True):
    st.metric("Composite score", f"{selected['score']:.1f}", border=True)
    st.metric("Category rank", f"#{int(selected['rank'])}", border=True)
    st.metric("Category", category_label(selected["category"]), border=True)
    st.metric("3-year CAGR", format_pct(selected["cagr_3y"]), border=True)
    st.metric("3-year Sharpe", f"{selected['sharpe_3y']:.2f}", border=True)
    st.metric("Max drawdown", format_pct(selected["max_drawdown"]), border=True)

left, right = st.columns(2)

with left:
    with st.container(border=True):
        st.subheader("Category-relative percentiles")
        radar = selected_breakdown.dropna(subset=["percentile"]).copy()
        fig = go.Figure(
            go.Scatterpolar(
                r=radar["percentile"],
                theta=radar["metric_label"],
                fill="toself",
                line=dict(color=CATEGORY_COLORS.get(selected["category"], "#1D4ED8"), width=2),
                hovertemplate="%{theta}<br>Percentile: %{r:.0%}<extra></extra>",
            )
        )
        fig.update_layout(
            polar=dict(
                radialaxis=dict(range=[0, 1], tickformat=".0%", showline=False),
                angularaxis=dict(tickfont=dict(size=11)),
            ),
            showlegend=False,
        )
        st.plotly_chart(
            style_figure(fig, height=430),
            alt=f"Radar chart of {short_name(selected['name'])} category-relative metric percentiles",
        )

with right:
    with st.container(border=True):
        st.subheader("What each metric contributed")
        contrib = selected_breakdown.dropna(subset=["contribution"]).copy()
        contrib = contrib.sort_values("contribution", ascending=True)
        fig = px.bar(
            contrib,
            x="contribution",
            y="metric_label",
            orientation="h",
            color="contribution",
            color_continuous_scale="Blues",
            labels={"contribution": "Points contributed to the score", "metric_label": ""},
            text=contrib["contribution"].map(lambda value: f"{value:.1f}"),
        )
        fig.update_traces(textposition="outside", cliponaxis=False)
        fig.update_layout(coloraxis_showscale=False)
        st.plotly_chart(
            style_figure(fig, height=430),
            alt="Bar chart of the points each metric contributed to the selected fund's score",
        )

with st.container(border=True):
    st.subheader("Evidence table")
    evidence = selected_breakdown.reset_index()[
        ["metric_label", "percentile", "weight", "contribution"]
    ].rename(
        columns={
            "metric_label": "Metric",
            "percentile": "Percentile in category",
            "weight": "Weight",
            "contribution": "Points contributed",
        }
    )
    st.dataframe(
        evidence,
        column_config={
            "Metric": st.column_config.TextColumn("Metric", width="large"),
            "Percentile in category": st.column_config.ProgressColumn(
                "Percentile in category", min_value=0, max_value=1, format="percent"
            ),
            "Weight": st.column_config.NumberColumn("Weight", format="percent"),
            "Points contributed": st.column_config.NumberColumn(
                "Points contributed", format="%.1f"
            ),
        },
        hide_index=True,
        alt="Table of each metric's percentile, weight, and contribution to the selected fund's score",
    )
    missing = evidence.loc[evidence["Percentile in category"].isna(), "Metric"].tolist()
    if missing:
        st.caption(
            "Not available for this fund: " + ", ".join(missing) + ". "
            "The denominator of the score drops those weights."
        )
    st.caption(
        f"Points contributed sum to {selected['score']:.1f}, the fund's composite score."
    )

st.divider()

st.subheader("How the top funds compare")
with st.container(border=True):
    heat_codes = (
        data["recommendation"].sort_values("weight", ascending=False)["code"].tolist()
        if not data["recommendation"].empty
        else top.sort_values("rank")["code"].head(9).tolist()
    )
    heat = score_breakdown.loc[score_breakdown["code"].isin(heat_codes)].copy()
    heat["fund"] = heat["fund_name"].map(short_name)
    heat["metric_label"] = heat["metric"].map(metric_labels)
    heat = heat.pivot_table(index="fund", columns="metric_label", values="percentile")
    heat = heat.reindex(columns=[metric_labels[metric] for metric in metric_order])
    heat = heat.loc[
        [
            short_name(top.loc[top["code"] == code, "name"].iloc[0])
            for code in heat_codes
            if short_name(top.loc[top["code"] == code, "name"].iloc[0]) in heat.index
        ]
    ]

    fig = px.imshow(
        heat,
        color_continuous_scale="Blues",
        zmin=0,
        zmax=1,
        aspect="auto",
        text_auto=".0%",
        labels={"x": "", "y": "", "color": "Percentile"},
    )
    fig.update_xaxes(side="top", tickangle=-25)
    fig.update_layout(coloraxis_colorbar=dict(tickformat=".0%"))
    st.plotly_chart(
        style_figure(fig, height=420, showlegend=False),
        alt="Heatmap of category-relative percentiles for the recommended funds across all scoring metrics",
    )
    st.caption(
        "Read across a row: dark cells are strengths for that fund. Read down a column: "
        "the best funds on that metric. NaN cells mean the metric is unavailable."
    )

st.divider()

st.subheader("The ML gate")
gate_cols = st.columns(4)
gate_cols[0].metric(
    "Rank IC",
    f"{ml_gate['rank_ic']:.2f}",
    delta=f"gate is {ml_gate['threshold']:.2f}",
    delta_color="off",
    border=True,
)
gate_cols[1].metric("Gate", "Failed" if not ml_gate["passed"] else "Passed", border=True)
gate_cols[2].metric("Test funds", f"{ml_gate['test_rows']}", border=True)
gate_cols[3].metric("Blend weight", format_pct(ml_gate["blend_weight"]), border=True)

left, right = st.columns([1.4, 1])

with left:
    with st.container(border=True):
        st.subheader("Predicted vs realised rank")
        plot = ml_test.copy()
        plot["category_label"] = plot["category"].map(category_label)
        fig = px.scatter(
            plot,
            x="prediction",
            y="target",
            color="category_label",
            color_discrete_map={
                category_label(cat): color for cat, color in CATEGORY_COLORS.items()
            },
            labels={
                "prediction": "Model's predicted percentile",
                "target": "Realised next-year percentile",
                "category_label": "Category",
            },
            hover_data={"code": True},
            opacity=0.75,
        )
        fig.add_shape(
            type="line",
            x0=0,
            x1=1,
            y0=0,
            y1=1,
            line=dict(dash="dash", color="#64748B", width=1),
        )
        fig.update_xaxes(tickformat=".0%", range=[-0.02, 1.02])
        fig.update_yaxes(tickformat=".0%", range=[-0.02, 1.02])
        st.plotly_chart(
            style_figure(fig, height=380),
            alt="Scatter plot of the Ridge model's predicted percentile against realized next-year percentile",
        )
        st.caption(
            "A useful model would slope upward. This test set slopes the other way, "
            "which is why the gate blocked it."
        )

with right:
    with st.container(border=True):
        st.subheader("What the Ridge model learned")
        coeff = ml_coefficients.copy()
        coeff["feature"] = coeff["feature"].str.replace("category_", "Category: ", regex=False)
        coeff = coeff.sort_values("coefficient")
        fig = px.bar(
            coeff,
            x="coefficient",
            y="feature",
            orientation="h",
            color="coefficient",
            color_continuous_scale="RdBu",
            labels={"coefficient": "Standardised coefficient", "feature": ""},
        )
        fig.update_layout(coloraxis_showscale=False)
        fig.add_vline(x=0, line_color="#64748B", line_width=1)
        st.plotly_chart(
            style_figure(fig, height=380),
            alt="Bar chart of the Ridge model's standardised coefficients by feature",
        )
        st.caption(
            "The target is next-year category-relative return. The model is trained on "
            "year-end snapshots from 2020 onward and holds out the latest year."
        )

with st.expander("Why the gate exists", icon=":material/lock:"):
    st.markdown(
        f"""
        The notebook does not trust an ML model just because it fits the past.
        It trains a Ridge regression on trailing metrics and tests it on the most
        recent held-out year. The blend is used only when **out-of-sample rank IC
        exceeds {ml_gate['threshold']:.2f}**.

        This run had **{ml_gate['train_rows']} training rows** and
        **{ml_gate['test_rows']} test rows**. Rank IC was
        **{ml_gate['rank_ic']:.2f}**, so the model was rejected and the final score
        stayed rule-based. That is a feature, not a failure: it prevents a noisy
        model from overriding a transparent ranking.
        """
    )
