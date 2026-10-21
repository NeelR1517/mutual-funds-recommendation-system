# SahiMF frontend

> **The project README has moved to [`../README.md`](../README.md).**
> It covers the whole engine — universe screening, category-relative scoring, the ML gate,
> the suitability policy, the constrained optimiser, the backtest and Monte Carlo — plus the
> backend, this frontend and the Streamlit prototype.

This folder is the zero-dependency UI for the FastAPI recommender. The backend serves these
files at `http://localhost:8000/`, so the pages and API share an origin.

Not investment advice.

## Run

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/`. API docs live at `/docs`.

For frontend-only edits you can also run `node scripts/serve.mjs` on port 8788. The client
then calls `http://localhost:8000`; override it with `window.SAHIMF_API_BASE`.

## Pages

- **`index.html`** — live dataset overview: fund counts, categories, pipeline and limits.
- **`quiz.html`** — four inputs (age, horizon, monthly SIP, risk appetite), then
  `POST /recommend` and a redirect to the results.
- **`results.html`** — seven sections: plan overview, allocation, performance, Monte Carlo,
  score basis, fund universe, and method.

Shared client code lives in `core.js` (API calls, formatting, category labels, storage,
toasts). Page logic lives in `home.js`, `quiz.js` and `results.js`; `charts.js` draws the
line, scatter and percentile-band charts on canvas.

The latest profile is cached in `localStorage` (`sahimf.profile`) and the matching
recommendation in `sessionStorage` (`sahimf.recommendation`), so the results page survives a
refresh but never shows a stale plan for a new profile. Use **Start over** to clear them.

## Data flow

All numbers come from the backend: `/meta`, `/overview`, `/funds`,
`/funds/{code}/score`, `/funds/{code}/nav` and `/recommend`. There is no generated dataset
and no build step.

## Files

```
index.html / home.js       overview page
quiz.html / quiz.js        investor profile form
results.html / results.js  recommendation dashboard
core.js                    shared API client and helpers
charts.js                  canvas line, scatter and band charts
styles.css                 design system
scripts/serve.mjs          optional static dev server (port 8788)
scripts/build-data.mjs     legacy data pipeline (K-means + RandomForest) — reference only
scripts/test-kmeans.mjs    clustering experiment harness — reference only
scripts/find-schemes.mjs   look up scheme codes by name pattern
```

The old `app.js` and `data/` files are kept for reference only; the live pages do not use
them.
