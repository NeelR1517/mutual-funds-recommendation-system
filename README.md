# SahiMF · *mflyzer*

> **A mutual-fund engine that treats fund quality and investor fit as two separate problems.**
> Screen ~5,000 Indian schemes → score each one *inside its own category* → size the equity
> sleeve from age, horizon and risk → let a constrained optimiser pick the weights →
> show the evidence, including the parts that failed.

**Not investment advice.** Historical returns do not predict future returns.

---

## Table of contents

| # | Section | What you'll find |
| --- | --- | --- |
| 1 | [Why this exists](#1-why-this-exists) | The problem in one paragraph |
| 2 | [The pipeline at a glance](#2-the-pipeline-at-a-glance) | Nine steps, one diagram |
| 3 | [Step 1 — Building the universe](#3-step-1--building-the-universe) | Filtering 5,000 schemes down to a scoreable set |
| 4 | [Step 2 — Nine metrics per fund](#4-step-2--nine-metrics-per-fund) | What we actually measure |
| 5 | [Step 3 — Category-relative scoring](#5-step-3--category-relative-scoring) | The score formula, in plain English |
| 6 | [Step 4 — The ML gate](#6-step-4--the-ml-gate) | We built a model. It failed. On purpose. |
| 7 | [Step 5 — The suitability policy](#7-step-5--the-suitability-policy) | How much *should* be in equity? |
| 8 | [Step 6 — Shortlisting the funds](#8-step-6--shortlisting-the-funds) | Turning a pool of 200 into 4–8 candidates |
| 9 | [Step 7 — The optimiser](#9-step-7--the-optimiser) | Mean-variance with guard rails |
| 10 | [Step 8 — Proving it: backtest & Monte Carlo](#10-step-8--proving-it-backtest--monte-carlo) | Stress-testing the result |
| 11 | [Repository layout](#11-repository-layout) | Every folder, linked |
| 12 | [Running it](#12-running-it) | Backend, frontend, prototype |
| 13 | [API reference](#13-api-reference) | Every endpoint |
| 14 | [Tuning knobs](#14-tuning-knobs) | The constants that matter |
| 15 | [Honest limits](#15-honest-limits) | What this model cannot do |
| 16 | [Glossary](#16-glossary) | CAGR, XIRR, Sharpe, IC, and friends |

---

## 1. Why this exists

Most "mutual fund recommendations" online are a list of the biggest, most-advertised funds.
That answers *"which funds are popular?"* — not *"which funds are good, and are they good
**for you**?"*.

SahiMF splits the problem in two:

1. **Fund quality** is a *category-relative* judgement. A small-cap fund is measured against
   other small-cap funds, never against a large-cap fund. A 14% CAGR from a mid-cap fund and a
   14% CAGR from a large-cap fund are not the same achievement, and the scoreboard says so.
2. **Investor fit** is a *suitability* judgement. A 24-year-old with a 20-year horizon and a
   52-year-old three years from retirement should not see the same portfolio — even if it is the
   objectively best one.

Everything downstream follows from keeping those two apart.

---

## 2. The pipeline at a glance

```
                      ┌───────────────────────────────────────────┐
                      │  1. UNIVERSE      ~5,000 schemes          │
                      │     Direct–Growth only → 5 categories       │
                      │     ≥1.5 yrs history, ≥300 NAVs, recent    │
                      └───────────────────┬───────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────────┐
                      │  2. METRICS       CAGR, vol, Sharpe,       │
                      │     Sortino, Calmar, drawdown, SIP XIRR,   │
                      │     consistency, momentum, beta/alpha      │
                      └───────────────────┬───────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────────┐
                      │  3. SCORE         Percentile *inside*      │
                      │     each category → weighted 0–100 score  │
                      └───────────────────┬───────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────────┐
                      │  4. ML GATE        Ridge regression tries  │
                      │     to beat the rules out-of-sample.      │
                      │     It usually fails. Rules stay.         │
                      └───────────────────┬───────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────────┐
                      │  5. SUITABILITY   age + horizon + risk    │
                      │     → equity %, category mix, hard gates  │
                      └───────────────────┬───────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────────┐
                      │  6. SHORTLIST     ≤2 funds per category    │
                      │     tilted by SIP XIRR or Calmar         │
                      └───────────────────┬───────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────────┐
                      │  7. OPTIMISE      constrained mean-       │
                      │     variance (Ledoit–Wolf + SLSQP)        │
                      └───────────────────┬───────────────────────┘
                                          ▼
                      ┌───────────────────────────────────────────┐
                      │  8. PROVE IT      5-year replay vs proxy  │
                      │     + 2,000 Monte Carlo paths             │
                      └───────────────────────────────────────────┘
```

Read the whole thing as **nine steps, one score, one portfolio, one honest evidence pack**.

---

## 3. Step 1 — Building the universe

**Source:** [mfapi.in](https://www.mfapi.in/) (AMFI NAV data). Every raw response is cached as
gzip on disk, so the second run is nearly instant.

| Filter | Rule | Why |
| --- | --- | --- |
| Plan | **Direct + Growth** only | Excludes IDCW / dividend / bonus / payout variants that would double-count the same fund |
| Type | Active **or** broad-market index | ETFs, FoFs, closed-ended, interval and FMP plans are dropped |
| Geography | **India only** | US / global / international funds are dropped |
| Taxonomy | 5 buckets: `large`, `mid`, `small`, `flexi`, `index` | Sector and thematic funds are dropped — they are a different bet, not a different size |
| Freshness | NAV within **10 days** of the newest quote | Dead funds get dropped |
| History | ≥ **1.5 years** and ≥ **300** daily observations | You cannot measure 5-year consistency on 8 months of data |

Category labels are **inferred** from the fund name first, then from mfapi's own category text
as a fallback — because mfapi's categories are messy (`Income`, `IDF`, `1099 Days` all show up).

> Implementation: [`backend/app/services/universe.py`](backend/app/services/universe.py)

---

## 4. Step 2 — Nine metrics per fund

Monthly returns drive most metrics; daily NAVs are used for drawdown. Everything is computed on
the trailing 36 months unless noted.

| Metric | Weight | What it actually tells you |
| --- | --- | --- |
| `cagr_3y` | 15% | Annualised return over 36 months |
| `cagr_5y` | 10% | Annualised return over 60 months (often missing for young funds) |
| `sip_xirr` | 15% | Money-weighted return of a ₹1/month SIP over 5 years — the number a real investor feels |
| `sharpe_3y` | 12% | Excess return per unit of total volatility |
| `sortino_3y` | 10% | Excess return per unit of *downside* volatility only |
| `calmar_3y` | 8% | 3-year CAGR ÷ worst peak-to-trough fall |
| `consistency` | 12% | Share of rolling 12-month windows that ended positive |
| `max_drawdown` | 8% | Worst peak-to-trough fall in daily NAV |
| `momentum_12m` | 10% | Trailing 12-month return |

Grouped the way the notebook describes it: **40% return, 30% risk-adjusted, 20% consistency,
10% momentum.**

Two extra numbers are computed but *not* scored — `beta` and `alpha` against a Nifty 500 proxy —
because they are informative but redundant with the metrics above.

**Benchmarks are proxies.** There is no index feed in this build, so "Nifty 500" is an equal-weight
composite of the Nifty 500 index funds already downloaded. That composite carries fund expenses
and tracking error. It is a fair yardstick, not the official TRI.

> Implementation: [`backend/app/services/metrics.py`](backend/app/services/metrics.py),
> [`backend/app/services/mfapi.py`](backend/app/services/mfapi.py) (XIRR + SIP XIRR)

---

## 5. Step 3 — Category-relative scoring

This is the heart of the "quality" claim, and it is deliberately simple.

**Step A — rank inside the category.**

```
p_i = rank(m_i within its own category) / n_in_that_category
```

A mid-cap fund with a 15% 3-year CAGR might sit at the 92nd percentile *among mid caps* and the
61st percentile *among all funds*. The scoreboard we care about is the first one.

**Step B — blend, and rescale for what is missing.**

```
score = 100 × ( Σ w_i · p_i ) / ( Σ w_i  over the metrics that exist )
```

If a fund has no 5-year record, that 10% weight is **dropped from the denominator, not filled
with a zero and not imputed**. A 3-year-old fund is scored against what it *can* show, and the
result still lands on a clean 0–100 scale.

**Step C — keep a pool of 200.**

- 40 slots are reserved per category (`BASE_QUOTA`), so no category can be wiped out by a bad
  stretch in the market.
- Remaining slots are filled by score across the whole universe, then the whole thing is
  re-sorted by score and re-ranked.

**Risk gets no bonus and no penalty in the score.** Risk is handled where it belongs: in the
suitability policy and in the optimiser. The score answers *"how good is this fund, for its
category?"* — nothing more.

> Implementation: [`backend/app/services/scoring.py`](backend/app/services/scoring.py)

---

## 6. Step 4 — The ML gate

> *"We built a model. Then we asked it to prove itself on data it had never seen. It failed.
> So we shipped the rules instead."*

The scoring composite is transparent, which is nice — but it is also just a set of opinions
dressed up as arithmetic. So the notebook builds a small **Ridge regression** and tries to
beat the rules out-of-sample.

**How the test works**

| Piece | Choice | Reason |
| --- | --- | --- |
| Training rows | Year-end snapshots from **2020** onward | Each snapshot is a full cross-section of funds at one date |
| Features | `cagr`, `vol`, `sharpe`, `maxdd`, `consistency`, `momentum`, `age` + category dummies | All knowable *at* the snapshot date — no look-ahead |
| Target | Next 12-month return, ranked **within category** | Predicts the right question: "will it beat its peers?" |
| Model | `Ridge(alpha=1.0)` on standardised features | Regularised and small; a bigger model would just memorise noise |
| Hold-out | The **latest** year-end is held out entirely | The most recent period is the hardest test |
| Gate | Spearman **rank IC > 0.05** on the hold-out, with ≥ 20 test funds | IC measures ranking quality; it is the right metric for a ranking problem |

**The verdict.** Rank IC came in below the threshold, so `use_ml = False`, the blend weight is
`0%`, and the shipped score stays **100% rule-based**. The notebook prints this explicitly and
the warnings list carries a line saying so.

This is the best part of the project, and it is worth being blunt about why: **the honest
outcome of a model that fails its test is to not ship it.** A blend weight that silently
snuck in at 20% would have made every score in the app harder to explain and very slightly
worse. The gate turns "we used ML" from a claim into a measurement.

If a future run *does* clear the gate, the blend activates at **20%** and every score in the UI
shows it. The code path already exists.

> Implementation: [`backend/mf_recommender.ipynb`](backend/mf_recommender.ipynb) (cell 19),
> surfaced in the UI as the "Score basis → ML gate" panel and the
> [Streamlit score-basis page](prototype/app_pages/score_basis.py)

---

## 7. Step 5 — The suitability policy

Now we leave the world of funds and enter the world of *this particular investor*.

### 7.1 How much should be in equity?

Three inputs — horizon, age, risk tolerance — are normalised to 0–1 and blended:

```
h = clip((horizon − 1) / 14, 0, 1)          # time to use the money
a = clip((65 − age) / 45, 0, 1)             # years to retirement
r = (risk − 1) / 4                          # 1 = very low … 5 = very high

capacity = 0.45·h + 0.30·a + 0.25·r
target   = 20 + 65·capacity                 # 20% (nope) … 85% (sure)
```

Then four hard caps take the **minimum**:

| Cap | Rule |
| --- | --- |
| Horizon cap | < 1 yr → 10% · < 3 → 30% · < 5 → 55% · < 7 → 75% · else 90% |
| Age cap | `max(20, 110 − age)` |
| Risk cap | 1 → 30% · 2 → 50% · 3 → 70% · 4 → 85% · 5 → 95% |
| Floor / ceiling | 10% – 95% |

Because the universe contains **equity funds only**, the remaining share is reported as an
explicit **debt / cash gap** rather than being quietly invested in the equity sleeve. The API
returns it as `debt_gap`, and the UI shows it as "Debt / cash (outside universe)".

### 7.2 Which categories, in what mix?

The equity share picks a starting profile:

| Profile | Equity share | Large | Index | Flexi | Mid | Small |
| --- | --- | --- | --- | --- | --- | --- |
| Conservative | < 45% | 40% | 25% | 25% | 10% | 0% |
| Moderate | 45–70% | 25% | 20% | 30% | 18% | 7% |
| Aggressive | ≥ 70% | 15% | 10% | 25% | 28% | 22% |

Then **horizon gates** override the profile, because a 2-year goal has no business owning
small-cap funds:

| Horizon | Gate applied |
| --- | --- |
| < 3 years | Mid **and** small forced to 0% |
| < 5 years | Small forced to 0%, mid capped at 10% |
| < 7 years | Small capped at 5%, mid capped at 20% |

Finally the whole mix is renormalised to 100%.

> Implementation: [`backend/app/services/portfolio.py`](backend/app/services/portfolio.py)
> (`equity_target`, `category_targets`)

---

## 8. Step 6 — Shortlisting the funds

The 200-fund pool is far too big to hand to an optimiser, so it is narrowed first.

**Per category, a `pick_score` is computed:**

```
pick_score = 0.7 × composite_score + 0.3 × mode_tilt
```

where the **mode tilt** depends on how the money is being invested:

- **SIP mode** → tilt toward `sip_xirr` (money-weighted, the way the investor actually invests).
- **Lump-sum mode** → tilt toward `calmar_3y` (return per unit of worst drawdown — you eat the
  whole drawdown at once, so the ratio matters more than the headline CAGR).

Tilt is a *category-relative percentile* too, so it stays on the same scale as the score.

**Then the shortlist is taken:**

- Only categories with a non-zero target are considered.
- Funds with **≥ 2 years** of history are preferred; if a category has none, the preference is
  dropped rather than skipping the category.
- **2 funds** are taken from a category when its target weight is ≥ 15%, otherwise **1**.

Typical result: **4–8 funds**, spread across at most 5 categories.

> Implementation: [`backend/app/services/portfolio.py`](backend/app/services/portfolio.py)
> (`pick_funds`)

---

## 9. Step 7 — The optimiser

The shortlist becomes weights here. The objective is standard mean-variance; the guard rails are
what make it usable.

### 9.1 The estimates

**Expected return (μ)** is deliberately conservative — half the fund's own 3-year CAGR, half the
median 3-year CAGR of its category:

```
μ_i = 0.5 · cagr_3y(fund) + 0.5 · median_category(cagr_3y)
μ_i = fillna(0.08)                       # fallback when history is short
μ_i = clip(μ_i, −0.05, 0.25)             # no heroes, no disasters
```

**Covariance (Σ)** uses **Ledoit–Wolf shrinkage** on the last 36 months of monthly returns
(× 12 to annualise). Raw sample covariance on ~36 observations of Indian mid-caps is garbage;
shrinkage pulls it toward a well-conditioned target and stops the optimiser from discovering
that small-cap and large-cap "diversify" perfectly.

### 9.2 The objective

```
maximise   μᵀw  −  ½·λ·wᵀΣw  −  ‖w − w_target‖²
           return   risk penalty     drift penalty
```

- `λ` (risk aversion) is **8.0 / 6.0 / 4.5 / 3.5 / 2.5** for risk tolerance 1 → 5.
- The drift penalty keeps the optimiser near the policy's category targets instead of chasing
  the historical numbers into a corner.

### 9.3 The constraints

| Constraint | Rule |
| --- | --- |
| Fully invested | `Σw = 1` |
| Long only | `w ≥ 0` |
| Position size | `0.03 ≤ w_i ≤ 0.30` per fund |
| Category bands | each category within **±5 percentage points** of its target |
| Volatility budget | `√(wᵀΣw) ≤ {1: 14%, 2: 15%, 3: 17%, 4: 19%, 5: 21%}` |

Solved with **SLSQP**. If the volatility cap makes the problem infeasible, it retries once
without that cap — and if that still fails, it falls back to the category targets split evenly
across the shortlist. The API never returns an unsolvable plan.

Weights under 2% are zeroed and the rest renormalised, so the final numbers add up cleanly.

> Implementation: [`backend/app/services/portfolio.py`](backend/app/services/portfolio.py)
> (`optimize_weights`)

---

## 10. Step 8 — Proving it: backtest & Monte Carlo

### 10.1 Five-year replay

The final weights are replayed month-by-month over the trailing five years and compared against
the Nifty 500 proxy. The output is CAGR, volatility, Sharpe, max drawdown and SIP XIRR for both
portfolio and benchmark.

### 10.2 Monte Carlo

**2,000 paths**, seeded at `42` so results are reproducible. Monthly returns from the last five
years are resampled **with replacement** and applied to the plan.

- **SIP mode** → each month grows the existing value and adds the contribution.
- **Lump-sum mode** → the amount compounds for the whole horizon.

Reported: median, 5th and 95th percentile terminal value, the **probability of ending below
total contributions**, median max drawdown, worst 5% drawdown, and percentile bands
(5/25/50/75/95) for every month of the horizon.

The UI is deliberately blunt about this: *the 5th percentile is the planning number, not the
median.* Fees, taxes, exit loads and changing interest rates are not modelled, and the returns
are sampled independently — so the spread is a floor for the uncertainty, not a full model of it.

> Implementation: [`backend/app/services/simulation.py`](backend/app/services/simulation.py)

---

## 11. Repository layout

```
mflyzer/
├── README.md                    ← you are here
│
├── backend/                     FastAPI service — the engine
│   ├── app/
│   │   ├── main.py              app + lifespan + static frontend mount
│   │   ├── config.py            every tunable constant in one file
│   │   ├── store.py             dataset build, cache, readiness state
│   │   ├── schemas.py           Pydantic request/response models
│   │   ├── serializers.py       fund row → API payload
│   │   ├── utils.py             numeric/date cleanup
│   │   ├── api/
│   │   │   ├── system.py        /health, /refresh, /meta, /overview
│   │   │   ├── funds.py         /funds, /funds/{code}, /nav, /score
│   │   │   └── recommend.py     /recommend
│   │   └── services/            ← the ML lives here
│   │       ├── universe.py      candidates, classification, NAVs, quality filter
│   │       ├── metrics.py       return, risk, consistency, benchmark metrics
│   │       ├── scoring.py       category percentiles + top-200 pool
│   │       ├── portfolio.py     suitability targets, shortlist, optimiser
│   │       ├── simulation.py    backtest + Monte Carlo
│   │       ├── recommendation.py response assembly
│   │       └── mfapi.py         HTTP, gzip cache, XIRR
│   ├── data/cache/              master.pkl, dataset.pkl, raw/*.json.gz
│   ├── mf_recommender.ipynb     the original notebook (incl. the ML gate)
│   └── requirements.txt
│
├── frontend/                    SahiMF UI — zero-dependency HTML/CSS/JS
│   ├── index.html               overview: universe, pipeline, how it works
│   ├── quiz.html                4 questions: age, horizon, SIP, risk
│   ├── results.html             7-section dashboard
│   ├── core.js                  API client, formatting, storage, labels
│   ├── home.js / quiz.js / results.js
│   ├── charts.js                canvas line, scatter and percentile-band charts
│   ├── styles.css               design system
│   └── scripts/                 build-data.mjs, find-schemes.mjs, serve.mjs, test-kmeans.mjs
│
└── prototype/                   Streamlit visualizer (research view)
    ├── mf_recommender.ipynb     notebook that writes the artifacts
    ├── streamlit_app.py         7 pages, artifact-driven
    ├── app_pages/               overview, recommendation, score_basis,
    │                            performance, monte_carlo, universe, methodology
    └── src/mflyzer/dashboard/   shared data loading + chart helpers
```

The frontend is served **by the backend itself** (FastAPI mounts it at `/`), so pages and API
share an origin and there is no CORS or build step to worry about.

---

## 12. Running it

### 12.1 Backend + UI (the real thing)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open:

| URL | What |
| --- | --- |
| `http://localhost:8000/` | The SahiMF UI |
| `http://localhost:8000/docs` | Interactive API docs |
| `http://localhost:8000/health` | Build status (poll until `status == "ready"`) |

The **first** start downloads ~5,000 scheme histories in a background thread. Later starts
reuse `backend/data/cache/` and are instant. Delete that folder to force a rebuild, or hit
`POST /refresh`.

### 12.2 Frontend only (fast UI iteration)

```bash
cd frontend
node scripts/serve.mjs        # http://localhost:8788
```

The client then points at `http://localhost:8000`. Override with `window.SAHIMF_API_BASE`.

### 12.3 Prototype (Streamlit research view)

```bash
cd prototype
uv sync
uv run python -m nbconvert --to notebook --execute --inplace mf_recommender.ipynb
uv run streamlit run streamlit_app.py
```

The notebook writes tables to `prototype/data/cache/artifacts/`; the Streamlit app reads **only**
those artifacts, so it starts instantly and never recomputes anything.

### 12.4 Try the API by hand

```bash
curl -X POST http://localhost:8000/recommend \
  -H 'Content-Type: application/json' \
  -d '{"age": 30, "horizon_years": 15, "risk_tolerance": 4, "mode": "sip", "amount": 10000}'
```

`amount` is **per month** for `sip` and **one-time** for `lumpsum`.

---

## 13. API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | [`/health`](backend/app/api/system.py) | Build status plus fund counts |
| `POST` | [`/refresh`](backend/app/api/system.py) | Rebuild the dataset in the background |
| `GET` | [`/meta`](backend/app/api/system.py) | Risk-free rate, categories, score weights, UI labels |
| `GET` | [`/overview`](backend/app/api/system.py) | Dataset counts, categories, build date |
| `GET` | [`/funds`](backend/app/api/funds.py) | Ranked funds; filter, sort, paginate |
| `GET` | [`/funds/{code}`](backend/app/api/funds.py) | One fund's metrics |
| `GET` | [`/funds/{code}/nav`](backend/app/api/funds.py) | Recent NAV history |
| `GET` | [`/funds/{code}/score`](backend/app/api/funds.py) | Per-metric percentile breakdown for one fund |
| `POST` | [`/recommend`](backend/app/api/recommend.py) | Portfolio, backtest and projection for a profile |

The `/funds/{code}/score` endpoint is the one to bookmark: it returns every metric's percentile,
its weight, and the points it contributed — so any score in the UI can be taken apart by hand.

---

## 14. Tuning knobs

Everything lives in [`backend/app/config.py`](backend/app/config.py) (and mirrors the setup cell
of the notebook).

| Constant | Default | Meaning |
| --- | --- | --- |
| `TOP_N` | `200` | Size of the quality pool |
| `BASE_QUOTA` | `40` | Reserved slots per category |
| `MIN_YEARS` | `1.5` | Minimum NAV history |
| `MIN_OBS` | `300` | Minimum daily NAV observations |
| `RISK_FREE` | `0.065` | Annual risk-free rate (an assumption, not a market feed) |
| `SCORE_WEIGHTS` | see [Step 2](#4-step-2--nine-metrics-per-fund) | What "quality" means |
| `PROFILES` | see [Step 5](#72-which-categories-in-what-mix) | Category mixes |
| `RISK_AVERSION` | `8 → 2.5` | Optimiser's risk penalty by risk tolerance |
| `VOL_BUDGET` | `14% → 21%` | Optimiser's volatility ceiling by risk tolerance |

---

## 15. Honest limits

Things this project **cannot** do, stated plainly:

- **No AUM, expense ratio, fund manager or holdings.** mfapi.in does not publish them, so the
  score cannot judge fund size, cost or style drift.
- **The benchmarks are proxies.** Equal-weight composites of index funds with expenses and
  tracking error — not official index TRI values.
- **Survivorship bias is real.** Only live schemes are listed, so dead funds never appear in
  the universe. Historical scores are flattered by this.
- **Categories are inferred**, from fund names and category text — not from a regulator.
- **Only equity funds.** Debt and cash appear as an explicit gap, never as a recommendation.
- **The ML gate failed.** The shipped ranking is rule-based. See [Step 4](#6-step-4--the-ml-gate).
- **Historical returns do not predict future returns.** A high score is evidence about the past.
- **This is not investment advice.** It is decision support and a research tool.

---

## 16. Glossary

| Term | Meaning |
| --- | --- |
| **CAGR** | Compound annual growth rate — the smooth yearly return a series implies |
| **SIP XIRR** | Money-weighted return of a monthly investment; unlike CAGR it accounts for when you invested |
| **Sharpe** | Excess return per unit of total volatility |
| **Sortino** | Excess return per unit of *downside* volatility only |
| **Calmar** | Return divided by worst drawdown |
| **Max drawdown** | Worst peak-to-trough fall in value |
| **Percentile rank** | Where a fund sits among its category peers (0 = worst, 1 = best) |
| **Ledoit–Wolf** | A shrinkage estimator that stabilises noisy covariance matrices |
| **SLSQP** | A sequential least-squares programming solver — used here for the constrained optimum |
| **Rank IC** | Spearman correlation between predicted and realised ranks; measures whether a model ranks better than chance |
| **Ridge** | A regularised linear regression that shrinks coefficients to control overfitting |
| **Mean-variance** | Classic framework: trade expected return against portfolio variance |
| **Monte Carlo** | Many simulated paths, to show a *range* of outcomes instead of one fake forecast |

---

## Credits

- **Data:** [mfapi.in](https://www.mfapi.in/) — AMFI NAV history. Cached locally on first run.
- **Stack:** FastAPI · pandas · NumPy · SciPy · scikit-learn · vanilla HTML/CSS/JS · Streamlit
- **Not investment advice.** Educational and research use only.
