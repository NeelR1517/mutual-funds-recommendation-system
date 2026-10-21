from __future__ import annotations

import pandas as pd
import streamlit as st

from mflyzer.dashboard import format_pct, require_artifacts

data = require_artifacts()
meta = data["metadata"]
explainers = meta["explainers"]

st.title("Methodology, assumptions, and limits")
st.caption(
    "What the numbers are, how the recommendation was produced, and what the "
    "model deliberately refuses to do."
)

st.info(
    "The **quality score is not a return forecast**. It ranks funds on what they "
    "have already done relative to their category. The Monte Carlo is a range of "
    "outcomes, not a prediction. The ML model is a tested add-on whose gate failed "
    "in this run.",
    title="Three different things are on this dashboard",
    icon=":material/schema:",
)

sections = [
    ("Score construction", "rule", explainers["score"]),
    ("Candidate selection", "format_list_numbered", explainers["selection"]),
    ("Suitability policy", "tune", explainers["suitability"]),
    ("Portfolio optimizer", "balance", explainers["optimizer"]),
    ("Monte Carlo", "ssid_chart", explainers["monte_carlo"]),
    ("ML gate", "lock", explainers["ml_gate"]),
]
for title, icon, body in sections:
    with st.container(border=True):
        st.subheader(f":material/{icon}: {title}", anchor=False)
        st.markdown(body)

st.divider()

left, right = st.columns(2)

with left:
    with st.container(border=True):
        st.subheader("Settings used for this run")
        settings = meta["settings"]
        setting_rows = [
            ("Universe", "Five equity categories: large, mid, small, flexi, index"),
            ("Minimum history", f"{settings['MIN_YEARS']:g} years and {settings['MIN_OBS']} daily NAVs"),
            ("Candidate pool", f"Top {settings['TOP_N']} by category-relative score"),
            ("Category starting quota", f"{settings['BASE_QUOTA']} funds per category"),
            ("Risk-free rate", format_pct(settings["RISK_FREE"])),
            ("Age", f"{settings['AGE']} years"),
            ("Horizon", f"{settings['HORIZON']:g} years"),
            ("Mode", settings["MODE"].upper()),
            ("Risk tolerance", f"{settings['RISK']} / 5"),
            ("Plan amount", f"₹{settings['AMOUNT']:,.0f}"),
        ]
        st.dataframe(
            pd.DataFrame(setting_rows, columns=["Setting", "Value"]),
            hide_index=True,
            alt="Table of notebook settings used to produce the dashboard",
        )

with right:
    with st.container(border=True):
        st.subheader("What the data does not contain")
        st.markdown(
            """
            - **No AUM, expense ratio, fund manager, or holdings.** mfapi.in does
              not expose them, so the score cannot judge size, cost, or style drift.
            - **No official index TRI.** Benchmarks are equal-weight composites of
              index funds in the downloaded universe. They have tracking error and
              fund expenses.
            - **Survivorship bias.** Only live schemes are in the feed. Funds that
              closed or merged are absent.
            - **Inferred categories.** Labels come from fund names first and the
              category text second. A few funds may be misclassified.
            - **Index funds are one sleeve.** A small-cap index fund still carries
              small-cap risk even though it sits in the index category.
            - **Historical returns do not persist.** A high score is evidence about
              the past, not a promise about the future.
            """
        )

st.subheader("Warnings from this run")
if meta["warnings"]:
    for warning in meta["warnings"]:
        st.warning(warning, icon=":material/warning:")
else:
    st.success("No warnings were raised for this run.", icon=":material/check_circle:")

st.subheader("How to refresh the dashboard")
st.markdown(
    "The Streamlit app reads only `data/cache/artifacts/`. To regenerate it, execute "
    "the notebook. To force a fresh download, delete `data/cache/master.parquet` and "
    "`data/cache/raw/` first."
)
st.code(
    "uv run python -m nbconvert --to notebook --execute --inplace mf_recommender.ipynb\n"
    "uv run streamlit run streamlit_app.py",
    language="bash",
)

with st.expander("Files produced by the notebook", icon=":material/folder_open:"):
    files = meta.get("artifacts", [])
    st.markdown(
        "\n".join(f"- `{name}`" for name in files)
        + "\n- `metadata.json`"
    )
    st.caption(
        "The app reads metrics, top pool, score breakdown, recommendation, portfolio "
        "history, stress episodes, Monte Carlo, NAV series, and ML gate evidence."
    )

st.divider()
st.caption(
    "Not investment advice. The author is not a registered investment adviser. "
    "Mutual fund investments are subject to market risk; read all scheme-related "
    "documents carefully."
)
