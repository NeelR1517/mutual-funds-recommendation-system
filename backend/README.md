# Mutual Fund Recommender API

A small FastAPI backend distilled from [`mf_recommender.ipynb`](./mf_recommender.ipynb). It downloads Indian mutual-fund NAV history from [mfapi.in](https://www.mfapi.in/), scores funds inside their own category, and builds a portfolio from age, horizon, risk tolerance, mode and amount.

Not investment advice.

## Run

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/` for the UI or `http://localhost:8000/docs` for the API.

The first start downloads about 5,000 scheme histories in the background. Poll `GET /health` until `status` is `ready`. Later starts reuse `data/cache/`.

## Layout

```
app/
├── main.py                 FastAPI app and startup
├── config.py               tunable constants
├── schemas.py              Pydantic request/response models
├── store.py                dataset build, cache and readiness
├── serializers.py          fund row → API payload
├── utils.py                numeric/date cleanup
├── api/
│   ├── deps.py             shared dependencies
│   ├── system.py           /health, /refresh, /meta, /overview
│   ├── funds.py            /funds, /funds/{code}, /funds/{code}/nav, /funds/{code}/score
│   └── recommend.py        /recommend
└── services/
    ├── mfapi.py            HTTP, gzip cache, XIRR
    ├── universe.py         candidates, classification, NAVs, quality filter
    ├── metrics.py          return, risk, consistency, benchmark metrics
    ├── scoring.py          category percentiles and top 200
    ├── portfolio.py        suitability targets, fund picks, optimiser
    ├── simulation.py       backtest and Monte Carlo
    └── recommendation.py   response assembly
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Build status plus fund counts |
| `POST` | `/refresh` | Rebuild the dataset in the background |
| `GET` | `/meta` | Risk-free rate, categories, score weights, UI labels |
| `GET` | `/overview` | Dataset counts, categories and build date |
| `GET` | `/funds` | Ranked funds; filter by category, sort, paginate |
| `GET` | `/funds/{code}` | One fund's metrics |
| `GET` | `/funds/{code}/nav` | Recent NAV history |
| `GET` | `/funds/{code}/score` | Score breakdown for one fund |
| `POST` | `/recommend` | Portfolio, backtest and projection for a profile |

### Example

```bash
curl -X POST http://localhost:8000/recommend \
  -H 'Content-Type: application/json' \
  -d '{"age": 30, "horizon_years": 15, "risk_tolerance": 4, "mode": "sip", "amount": 10000}'
```

Amount is monthly for `sip` and one-time for `lumpsum`.

## How it works

1. **Universe** — keep Direct–Growth schemes, classify into large, mid, small, flexi and broad-market index, then require a recent NAV, 1.5 years of history and 300 observations.
2. **Metrics** — 1/3/5-year CAGR, SIP XIRR, volatility, Sharpe, Sortino, Calmar, max drawdown, consistency and Nifty 500-relative beta/alpha.
3. **Score** — percentile rank each metric inside its own category; weighted composite: 40% return, 30% risk-adjusted, 20% consistency, 10% momentum. Keep the top 200 with a 40-per-category minimum quota.
4. **Recommend** — equity share from age/horizon/risk, category mix from the risk profile with horizon gates, up to two funds per category, then a constrained mean-variance optimiser with per-category bands and a volatility cap.

Benchmarks are equal-weight composites of matching index funds, not official indices.

## Notes

- Cached under `data/cache/`: `master.pkl`, raw gzip responses, and `dataset.pkl`. Delete the folder to force a full rebuild.
- The notebook's ML gate failed out-of-sample, so this backend keeps the rule-based score only.
- mfapi.in has no AUM, expense ratio, manager or holdings data.
- Historical returns do not predict future returns.
