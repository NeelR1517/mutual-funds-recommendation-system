"""Entry point for the mflyzer mutual-fund visualizer.

Run from the repository root:

    streamlit run streamlit_app.py
"""

from __future__ import annotations

import streamlit as st

from mflyzer.dashboard.data import ARTIFACTS, ROOT

st.set_page_config(
    page_title="mflyzer | Mutual fund recommender",
    page_icon=":material/query_stats:",
    layout="wide",
)

pages = st.navigation(
    [
        st.Page(
            "app_pages/overview.py",
            title="Overview",
            icon=":material/space_dashboard:",
            default=True,
        ),
        st.Page(
            "app_pages/recommendation.py",
            title="Recommendation",
            icon=":material/recommend:",
        ),
        st.Page(
            "app_pages/score_basis.py",
            title="Score basis",
            icon=":material/leaderboard:",
        ),
        st.Page(
            "app_pages/performance.py",
            title="Performance",
            icon=":material/monitoring:",
        ),
        st.Page(
            "app_pages/monte_carlo.py",
            title="Monte Carlo",
            icon=":material/ssid_chart:",
        ),
        st.Page(
            "app_pages/universe.py",
            title="Fund universe",
            icon=":material/dataset:",
        ),
        st.Page(
            "app_pages/methodology.py",
            title="Methodology",
            icon=":material/menu_book:",
        ),
    ]
)

with st.sidebar:
    st.caption("Mutual fund research from mfapi.in")
    try:
        location = ARTIFACTS.relative_to(ROOT)
    except ValueError:
        location = ARTIFACTS
    st.caption(f"Artifacts: `{location}`")
    if st.button("Reload artifacts", icon=":material/refresh:", width="stretch"):
        st.cache_data.clear()
        st.rerun()
    st.caption("Not investment advice.")

pages.run()
