# mflyzer

Mutual-fund research and recommendation engine built on [mfapi.in](https://www.mfapi.in/), plus a Streamlit visualizer for the results.

## What it does

`mf_recommender.ipynb`:

1. Downloads the Indian mutual-fund universe and caches every NAV history under `data/cache/`.
2. Keeps five equity categories: large cap, mid cap, small cap, flexi cap, and broad-market index funds.
3. Computes return, risk, consistency, and momentum metrics.
4. Scores funds inside their own category and selects a 200-fund candidate pool.
5. Builds a portfolio from age, horizon, SIP/lumpsum choice, and risk tolerance.
6. Saves every table used by the dashboard to `data/cache/artifacts/`.

The Streamlit app reads only those artifacts, so it starts instantly.

## Setup

```bash
uv sync
```

## Run the notebook

```bash
uv run python -m nbconvert --to notebook --execute --inplace mf_recommender.ipynb
```

The first run downloads about 5,000 scheme histories. Later runs reuse `data/cache/raw/`.

To force a fresh download, delete `data/cache/master.parquet` and `data/cache/raw/`.

## Run the visualizer

```bash
uv run streamlit run streamlit_app.py
```

Pages:

- **Overview** — universe, candidate pool, score distribution, pipeline.
- **Recommendation** — fund weights, amounts, category mix, suitability warnings.
- **Score basis** — metric weights, percentile contributions, ML-gate evidence.
- **Performance** — portfolio vs Nifty 500 proxy, drawdown, rolling returns, stress episodes.
- **Monte Carlo** — terminal value distribution, sample paths, drawdown risk.
- **Fund universe** — searchable metrics table, risk/return scatter, NAV lookup.
- **Methodology** — assumptions, data limits, warnings, refresh instructions.

The dashboard artifacts live in `data/cache/artifacts/` and are intentionally ignored by git.

## Important limits

- No AUM, expense ratio, fund manager, or holdings data exists on mfapi.in.
- Benchmarks are equal-weight composites of index funds, not official index TRI values.
- Only live schemes are listed, so survivorship bias remains.
- Historical returns do not predict future returns.

Not investment advice.
