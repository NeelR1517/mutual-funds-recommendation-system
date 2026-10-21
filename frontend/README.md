# SahiMF — Investor-Profile-Aware Fund Selector (India)

Mutual fund selection in India still runs on static star ratings and tip lists — those
describe the *fund*, not the *investor*. FundLens recommends Indian mutual funds based on
**who you are**, and shows its reasoning for every pick.

**Scope: decision support, not decision replacement.** It filters, matches, ranks and
explains; the final call stays with the investor. Not investment advice.

---

## Run it

Requires **Node.js ≥ 18** (uses only built-in modules, zero npm installs).

```bash
node scripts/serve.mjs     # → open http://localhost:8788
```

To rebuild the dataset (fetches fresh NAV history from mfapi.in, re-runs the ML):

```bash
node scripts/build-data.mjs
```

Responses are cached in the OS temp dir (`%TEMP%/opencode/mf-cache`) so rebuilds are fast;
delete that folder to force a full refresh. The whole rebuild takes a few minutes.

## What it does (the 4 steps)

1. **Questionnaire → transparent risk score (0–100).**
   `0.35·horizon + 0.30·appetite + 0.20·age + 0.15·SIP`, each factor normalised 0–100 and
   displayed with its contribution. Horizon is capped by years to retirement.

2. **Real fund data → risk–return features.**
   NAV histories for **72 Direct–Growth plans** (Large/Flexi/Mid/Small Cap, ELSS,
   Nifty-50 & Next-50 index, Aggressive Hybrid, BAF, Conservative Hybrid, Gilt, Short
   Duration, Money Market, Liquid) from `api.mfapi.in` (AMFI data). Features: CAGR 1/3/5Y,
   annualised volatility, Sharpe (7% risk-free), max drawdown 5Y, monthly-window win rate.

3. **Simple, honest ML.**
   - **K-means (k=5)** on standardised `log(vol) · |maxDD| · CAGR₃ · consistency`
     (weights 2 / 1.5 / 0.7 / 0.4) → five data-driven risk cohorts.
   - **RandomForest** (150 bagged trees) predicts each fund's SEBI Riskometer level (1–6)
     from behaviour; leave-one-out CV accuracy (~81%) and the confusion matrix are shown.
     Every fund card displays the model's vote vs the official label — agreement ✓ or
     divergence ≠.

4. **You → cohort → ranked top-5 + reasons.**
   Your score maps to the nearest cohort (overridable). Inside it, funds rank by
   adjustable weights — **return quality 40% · consistency 20% · drawdown 20% · cost 10% ·
   size 10%** — five live sliders + presets. Top-5 cards carry plain-language reasons
   generated from the winning sub-scores.

5. **SIP backtest (proof it works).**
   The top-5 basket at equal split, replayed over real NAVs (monthly SIP, first NAV ≥ 5th
   of month) against a Nifty 50 index-fund proxy over 1/3/5 years — final values, XIRR
   (bisection IRR) and max drawdown of the value path.

## Data snapshot

- Universe: 72 funds · ~41,000 weekly NAV points · last 13 years per fund
- Every entry carries official Riskometer level (category-typical), TER, AUM,
  RFC features, cluster id, RF probabilities

## Honest limitations (also shown on the site's Method page)

- **TER & AUM are curated approximations** — mfapi.in/AMFI does not expose them.
  Replace with AMFI's scheme-attributes file for production accuracy.
- The SEBI Riskometer label is reconstructed at **category level**; real labels are
  fund-specific and dynamic.
- The Nifty 50 benchmark is proxied by **UTI Nifty 50 Index Fund (Direct)** NAV — not the
  official TRI.
- Curated universe (72 funds), Direct-Growth plans only.
- Everything is descriptive of the past; nothing predicts the future.

## Project layout

```
index.html              page markup
styles.css              design system
app.js                  scoring, ranking, backtest, explore logic
charts.js               dependency-free canvas line/scatter charts
data/funds-data.js      generated dataset (window.FUNDS_DATA)
data/funds-data.json    same dataset as plain JSON
scripts/build-data.mjs  full pipeline: fetch → features → K-means → RF → export
scripts/serve.mjs       tiny static server (localhost:8788)
scripts/find-schemes.mjs helper to look up mfapi scheme codes
```

## Credits & data

- NAV data: AMFI via [api.mfapi.in](https://mfapi.in) (free, public).
- SEBI Riskometer levels reconstructed from SEBI's product-labelling framework (course of
  2020 onward) at the scheme-category level.
