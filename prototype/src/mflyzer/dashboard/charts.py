"""Plotly helpers shared by the dashboard pages."""

from __future__ import annotations

import plotly.graph_objects as go


def style_figure(
    fig: go.Figure,
    *,
    height: int = 380,
    showlegend: bool = True,
    legend_at_top: bool = True,
) -> go.Figure:
    """Apply a transparent, theme-aware layout to a Plotly figure."""
    fig.update_layout(
        height=height,
        margin=dict(l=8, r=8, t=52, b=8),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        hoverlabel=dict(namelength=-1),
        showlegend=showlegend,
    )
    if showlegend and legend_at_top:
        fig.update_layout(
            legend=dict(
                orientation="h",
                yanchor="bottom",
                y=1.02,
                xanchor="left",
                x=0,
            )
        )
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(gridcolor="rgba(148, 163, 184, 0.18)")
    return fig
