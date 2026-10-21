// ---------------------------------------------------------------------------
// build-data.mjs — builds data/funds-data.js (and .json) for the app.
//
// Pipeline (all public data, sources documented in Method page):
//   1. Fetch NAV history for a curated universe of ~71 Indian mutual funds
//      (Direct Growth plans) from api.mfapi.in/mf/{schemeCode}.
//   2. Compute risk-return features: CAGR 1/3/5Y, annualised volatility,
//      Sharpe ratio, max drawdown (5Y), monthly-win consistency.
//   3. K-means (k=5) on standardised features -> data-driven risk cohorts.
//   4. RandomForest (from scratch) trained to predict the SEBI Riskometer
//      level (1-6) from fund behaviour; leave-one-out CV + confusion matrix
//      gives an honest accuracy figure. Per-fund prediction cross-checks the
//      official category-level label.
//   5. Everything (features, model outputs, weekly NAV series for the
//      backtest) is written to data/funds-data.js as window.FUNDS_DATA.
//
// Run: node scripts/build-data.mjs
// Raw API responses are cached in OS temp dir; delete that folder to refresh.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_JS = path.join(ROOT, '..', 'data', 'funds-data.js');
const OUT_JSON = path.join(ROOT, '..', 'data', 'funds-data.json');
const CACHE_DIR = path.join(os.tmpdir(), 'opencode', 'mf-cache');

const API = 'https://api.mfapi.in';
const YEARSWindow = 13;         // years of NAV history kept for series export
const MIN_HISTORY_YEARS = 3;    // funds younger than this are skipped
const RISK_FREE = 0.07;         // ~ 10y G-sec-ish, stated in Method page
const K = 5;                    // clusters
const RF_TREES = 150;

// ---------------------------------------------------------------------------
// Curated universe: schemeCode -> category label. Direct Growth plans.
// (Expense ratio & AUM are small curated approximations — mfapi does not
// expose them; Method page discloses this clearly.)
// ---------------------------------------------------------------------------
const UNIVERSE = [
  // code, category, ter(%), aum(₹cr)
  [118825, 'Large Cap', 0.57, 27000], [120586, 'Large Cap', 0.79, 42000],
  [119018, 'Large Cap', 0.75, 30000], [118632, 'Large Cap', 0.61, 16000],
  [120465, 'Large Cap', 0.54, 28000], [119598, 'Large Cap', 0.63, 34000],

  [122639, 'Flexi Cap', 0.63, 89000], [120492, 'Flexi Cap', 0.92, 2100],
  [120166, 'Flexi Cap', 0.52, 10500], [118535, 'Flexi Cap', 0.82, 12000],
  [120046, 'Flexi Cap', 0.78, 4000],  [140353, 'Flexi Cap', 0.88, 6000],
  [149763, 'Flexi Cap', 0.44, 5200],  [118955, 'Flexi Cap', 0.86, 11000],
  [119076, 'Flexi Cap', 0.62, 6100],  [120843, 'Flexi Cap', 0.68, 5800],
  [148990, 'Flexi Cap', 0.86, 900],

  [118668, 'Mid Cap', 0.76, 24000], [118989, 'Mid Cap', 0.68, 62000],
  [125307, 'Mid Cap', 0.50, 7200],  [119178, 'Mid Cap', 0.57, 12000],
  [120505, 'Mid Cap', 0.51, 30000], [119716, 'Mid Cap', 0.71, 23000],
  [119071, 'Mid Cap', 0.61, 15000], [119620, 'Mid Cap', 0.59, 10000],

  [125354, 'Small Cap', 0.55, 28000], [118778, 'Small Cap', 0.71, 45000],
  [125497, 'Small Cap', 0.62, 12000], [120828, 'Small Cap', 0.60, 9000],
  [149019, 'Small Cap', 0.50, 8200],  [146130, 'Small Cap', 0.37, 3400],
  [120164, 'Small Cap', 0.44, 7000],  [118525, 'Small Cap', 0.94, 8600],
  [119556, 'Small Cap', 0.71, 4200],  [120591, 'Small Cap', 0.61, 9100],
  [145206, 'Small Cap', 0.44, 10000],

  [135781, 'ELSS', 0.61, 8000],  [120847, 'ELSS', 0.68, 10000],
  [118285, 'ELSS', 0.36, 4100],  [120503, 'ELSS', 0.54, 33000],
  [119723, 'ELSS', 0.74, 12000], [120715, 'ELSS', 0.54, 8300],
  [119441, 'ELSS', 0.42, 8600],

  [120716, 'Index - Nifty 50', 0.17, 9200], [119063, 'Index - Nifty 50', 0.20, 10100],
  [120620, 'Index - Nifty 50', 0.18, 5100], [119827, 'Index - Nifty 50', 0.20, 1600],
  [118741, 'Index - Nifty 50', 0.20, 2200],

  [120684, 'Index - Nifty Next 50', 0.65, 3100], [143341, 'Index - Nifty Next 50', 0.60, 2100],
  [146381, 'Index - Nifty Next 50', 0.60, 1800],

  [141006, 'Aggressive Hybrid', 0.75, 2100], [119542, 'Aggressive Hybrid', 0.45, 1500],
  [144681, 'Aggressive Hybrid', 0.44, 1100], [145228, 'Aggressive Hybrid', 0.79, 950],
  [119347, 'Aggressive Hybrid', 0.60, 1600],

  [118968, 'Balanced Advantage', 0.84, 12000], [118615, 'Balanced Advantage', 0.55, 5100],
  [118736, 'Balanced Advantage', 0.75, 8200],  [149134, 'Balanced Advantage', 0.68, 3200],
  [144335, 'Balanced Advantage', 0.65, 4100],

  [119839, 'Conservative Hybrid', 0.78, 2100], [119079, 'Conservative Hybrid', 0.62, 1900],

  [120590, 'Gilt', 0.45, 8200], [119759, 'Gilt', 0.45, 4100], [119605, 'Gilt', 0.38, 8600],
  [120062, 'Short Duration', 0.28, 10200],

  [119424, 'Money Market', 0.25, 7100], [119092, 'Money Market', 0.25, 8300],
  [119106, 'Money Market', 0.30, 5300],

  [119091, 'Liquid', 0.30, 69000], [119568, 'Liquid', 0.30, 61000],
];

// Category -> SEBI Riskometer level (1=Low ... 6=Very High). Category-typical
// labels per SEBI's product-labelling rules; Method page discloses this.
const CAT_LEVEL = {
  'Large Cap': 5, 'Flexi Cap': 6, 'Mid Cap': 6, 'Small Cap': 6, 'ELSS': 6,
  'Index - Nifty 50': 5, 'Index - Nifty Next 50': 6,
  'Aggressive Hybrid': 5, 'Balanced Advantage': 4, 'Conservative Hybrid': 3,
  'Gilt': 3, 'Short Duration': 2, 'Money Market': 2, 'Liquid': 1,
};
export const LEVEL_NAMES = ['', 'Low', 'Low to Moderate', 'Moderate', 'Moderately High', 'High', 'Very High'];

// Benchmarks & helpers -------------------------------------------------------
const BENCH_CODE = 120716; // UTI Nifty 50 Index Fund - Direct Plan - Growth (proxy for NIFTY 50 TRI)

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchScheme(code, tries = 3) {
  const cacheFile = path.join(CACHE_DIR, `${code}.json`);
  if (fs.existsSync(cacheFile)) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* refetch */ }
  }
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${API}/mf/${code}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !json.data || json.data.length === 0) throw new Error('empty');
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(json));
      return json;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
    }
  }
}

const DAY = 86400000;
function parseSeries(raw) {
  // raw.data: [{date:'DD-MM-YYYY', nav:' 123.45'} ...] (any order; we sort)
  const pts = raw.data
    .map(d => {
      const [dd, mm, yy] = d.date.split('-').map(Number);
      return { t: Date.UTC(yy, mm - 1, dd), nav: parseFloat(String(d.nav).replace(/,/g, '')) };
    })
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.nav) && p.nav > 0);
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

function idxAtOrAfter(pts, t) {
  let lo = 0, hi = pts.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t >= t) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

function cagr(pts, years) {
  const end = pts[pts.length - 1];
  const i = idxAtOrAfter(pts, end.t - years * 365.25 * DAY);
  if (i < 0) return null;
  const p0 = pts[i];
  const span = (end.t - p0.t) / (365.25 * DAY);
  if (span < years * 0.9) return null;
  return Math.pow(end.nav / p0.nav, 1 / span) - 1;
}

function annVol(pts, years) {
  const i = idxAtOrAfter(pts, pts[pts.length - 1].t - years * 365.25 * DAY);
  const win = pts.slice(Math.max(0, i));
  if (win.length < 100) return null;
  const rets = [];
  for (let j = 1; j < win.length; j++) rets.push(Math.log(win[j].nav / win[j - 1].nav));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252);
}

function maxDD(pts, years) {
  const i = idxAtOrAfter(pts, pts[pts.length - 1].t - years * 365.25 * DAY);
  const win = pts.slice(Math.max(0, i));
  if (win.length < 50) return null;
  let peak = win[0].nav, dd = 0;
  for (const p of win) {
    if (p.nav > peak) peak = p.nav;
    const d = p.nav / peak - 1;
    if (d < dd) dd = d;
  }
  return dd; // negative or 0
}

function consistency(pts, years) {
  const i = idxAtOrAfter(pts, pts[pts.length - 1].t - years * 365.25 * DAY);
  const win = pts.slice(Math.max(0, i));
  if (win.length < 150) return null;
  let n = 0, pos = 0;
  for (let j = 21; j < win.length; j += 21) {
    n++;
    if (win[j].nav > win[j - 21].nav) pos++;
  }
  return n > 0 ? pos / n : null;
}

// --------------------------- K-means ---------------------------------------
function zscore(rows, w = null) {
  const k = rows[0].length;
  const mu = new Array(k).fill(0), sd = new Array(k).fill(0);
  for (const r of rows) for (let j = 0; j < k; j++) mu[j] += r[j];
  for (let j = 0; j < k; j++) mu[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < k; j++) sd[j] += (r[j] - mu[j]) ** 2;
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1;
  return rows.map(r => r.map((v, j) => ((v - mu[j]) / sd[j]) * (w ? w[j] : 1)));
}

function dist2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; }

function kmeans(X, k, seed) {
  const rng = mulberry32(seed);
  const n = X.length;
  const centroids = [X[Math.floor(rng() * n)].slice()];
  while (centroids.length < k) {
    const d = X.map(x => Math.min(...centroids.map(c => dist2(x, c))));
    const total = d.reduce((a, b) => a + b, 0);
    let r = rng() * total, pick = 0;
    for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break; } }
    centroids.push(X[pick].slice());
  }
  let assign = new Array(n).fill(0);
  for (let iter = 0; iter < 300; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = dist2(X[i], centroids[c]); if (d < bd) { bd = d; best = c; } }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    const sums = Array.from({ length: k }, () => new Array(X[0].length).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) { counts[assign[i]]++; for (let j = 0; j < X[0].length; j++) sums[assign[i]][j] += X[i][j]; }
    for (let c = 0; c < k; c++) if (counts[c] > 0) for (let j = 0; j < X[0].length; j++) centroids[c][j] = sums[c][j] / counts[c];
    if (!changed) break;
  }
  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += dist2(X[i], centroids[assign[i]]);
  return { assign, centroids, inertia };
}

// --------------------------- RandomForest ----------------------------------
class MdTree {
  constructor(rng, featPool) { this.rng = rng; this.featPool = featPool; }
  fit(X, y, depth = 4) {
    this.maxDepth = depth; this.minLeaf = 3; this.tree = this._grow(X, y, 0);
  }
  _leaf(y) {
    const counts = {};
    for (const v of y) counts[v] = (counts[v] || 0) + 1;
    let best = null, bestN = -1;
    for (const [v, c] of Object.entries(counts)) if (c > bestN) { bestN = c; best = Number(v); }
    const total = y.length;
    const probs = {};
    for (const [v] of Object.entries(counts)) probs[v] = counts[v] / total;
    return { leaf: true, value: best, probs, n: total };
  }
  _gini(y) {
    const counts = {};
    for (const v of y) counts[v] = (counts[v] || 0) + 1;
    let g = 1;
    for (const c of Object.values(counts)) g -= (c / y.length) ** 2;
    return g;
  }
  _grow(X, y, depth) {
    if (depth >= this.maxDepth || y.length < 2 * this.minLeaf) return this._leaf(y);
    // random feature subset
    const feats = [...this.featPool].sort(() => this.rng() - 0.5).slice(0, 2);
    let best = null;
    for (const f of feats) {
      const vals = X.map(r => r[f]);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 1e-12) continue;
      for (let q = 0; q < 4; q++) {
        const thr = lo + ((q + 1) / 5) * (hi - lo);
        const li = [], ri = [], ly = [], ry = [];
        for (let i = 0; i < X.length; i++) (X[i][f] <= thr ? (li.push(i), ly.push(y[i])) : (ri.push(i), ry.push(y[i])));
        if (ly.length < this.minLeaf || ry.length < this.minLeaf) continue;
        const g = (ly.length / y.length) * this._gini(ly) + (ry.length / y.length) * this._gini(ry);
        if (!best || g < best.g) best = { g, f, thr, li, ri, ly, ry };
      }
    }
    if (!best) return this._leaf(y);
    return {
      leaf: false, f: best.f, thr: best.thr,
      left: this._grow(best.li.map(i => X[i]), best.ly, depth + 1),
      right: this._grow(best.ri.map(i => X[i]), best.ry, depth + 1),
    };
  }
  predict(x) {
    let node = this.tree;
    while (!node.leaf) node = x[node.f] <= node.thr ? node.left : node.right;
    return node.probs;
  }
}

function randomForest(X, y, nTrees = RF_TREES) {
  const classes = [...new Set(y)].sort((a, b) => a - b);
  const rng = mulberry32(77);
  const featPool = X[0].map((_, i) => i);
  const trees = [];
  for (let t = 0; t < nTrees; t++) {
    const idx = Array.from({ length: X.length }, () => Math.floor(rng() * X.length));
    const Xb = idx.map(i => X[i]), yb = idx.map(i => y[i]);
    const tree = new MdTree(rng, featPool);
    tree.fit(Xb, yb);
    trees.push(tree);
  }
  const predictProbs = (x) => {
    const acc = Object.fromEntries(classes.map(c => [c, 0]));
    for (const tree of trees) {
      const p = tree.predict(x);
      for (const c of classes) acc[c] += p[c] || 0;
    }
    for (const c of classes) acc[c] /= nTrees;
    return acc;
  };
  return { trees, classes, predictProbs };
}

function looEvaluate(X, y) {
  const n = X.length;
  const conf = {}; // actual -> {pred -> count}
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const Xi = X.filter((_, j) => j !== i), yi = y.filter((_, j) => j !== i);
    const rf = randomForest(Xi, yi, RF_TREES);
    const acc = rf.predictProbs(X[i]);
    let best = null, bp = -1;
    for (const [c, p] of Object.entries(acc)) if (p > bp) { bp = p; best = Number(c); }
    if (best === y[i]) correct++;
    conf[y[i]] = conf[y[i]] || {};
    conf[y[i]][best] = (conf[y[i]][best] || 0) + 1;
  }
  return { accuracy: correct / n, confusion: conf };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`Universe: ${UNIVERSE.length} curated schemes`);
const results = [];
const skipped = [];

for (let i = 0; i < UNIVERSE.length; i += 8) {
  const chunk = UNIVERSE.slice(i, i + 8);
  const settled = await Promise.allSettled(chunk.map(async ([code, cat, ter, aum]) => {
    const raw = await fetchScheme(code);
    return { code, cat, ter, aum, meta: raw.meta, pts: parseSeries(raw) };
  }));
  for (const s of settled) {
    if (s.status !== 'fulfilled') { skipped.push({ reason: 'fetch-fail: ' + s.reason }); continue; }
    results.push(s.value);
  }
  console.log(`  fetched ${Math.min(i + 8, UNIVERSE.length)}/${UNIVERSE.length}`);
}

const funds = [];
for (const r of results) {
  const { pts } = r;
  const end = pts[pts.length - 1];
  const spanYears = (end.t - pts[0].t) / (365.25 * DAY);
  if (spanYears < MIN_HISTORY_YEARS) { skipped.push({ code: r.code, name: r.meta.scheme_name, reason: `history ${spanYears.toFixed(1)}y` }); continue; }
  // trim to last YEARSWindow years (keeps the panel comparable)
  const i0 = idxAtOrAfter(pts, end.t - YEARSWindow * 365.25 * DAY);
  const trimmed = pts.slice(Math.max(0, i0));

  const vol = annVol(trimmed, 3);
  const cagr3 = cagr(trimmed, 3) ?? cagr(trimmed, 1);
  const dd5 = maxDD(trimmed, 5) ?? 0;
  const cons = consistency(trimmed, 3) ?? 0.5;
  if (vol == null || cagr3 == null) { skipped.push({ code: r.code, reason: 'insufficient points' }); continue; }

  funds.push({
    code: r.code,
    name: r.meta.scheme_name.replace(/- Direct Plan.*$/i, '').replace(/- Growth.*$/i, '').trim(),
    house: r.meta.fund_house || '',
    cat: r.cat,
    level: CAT_LEVEL[r.cat] ?? 4,
    ter: r.ter,
    aum: r.aum,
    start: pts[0].t,
    cagr1: cagr(trimmed, 1),
    cagr3,
    cagr5: cagr(trimmed, 5),
    vol,
    sharpe: (cagr3 - RISK_FREE) / vol,
    dd: dd5,
    cons,
    series: trimmed.filter((_, idx) => idx % 5 === 0 || idx === trimmed.length - 1)
      .map(p => [Math.round(p.t / DAY), Math.round(p.nav * 10000) / 10000]),
  });
}

console.log(`Kept ${funds.length} funds (skipped ${skipped.length}: ${skipped.slice(0, 6).map(s => s.reason).join(', ')}${skipped.length > 6 ? ' …' : ''})`);
if (funds.length < 55) { console.error('ERROR: universe too small, aborting'); process.exit(1); }

// ---- K-means cohorts ----
// Risk features dominate (vol & drawdown); log-vol separates debt/equity
// bands cleanly across a 5-cohort risk spectrum (weights documented on
// the Method page).
const featRows = funds.map(f => [Math.log10(f.vol), Math.abs(f.dd), Math.max(-1, f.cagr3), f.cons]);
const Z = zscore(featRows, [2, 1.5, 0.7, 0.4]);
let bestRun = null;
for (let s = 1; s <= 12; s++) {
  const run = kmeans(Z, K, s * 1000);
  if (!bestRun || run.inertia < bestRun.run.inertia) bestRun = { run, seed: s * 1000 };
}
const { assign: clusterAssign } = bestRun.run;

// order clusters by mean volatility ascending -> cohort ids 0..4
const clusterStats = Array.from({ length: K }, (_, c) => {
  const idxs = funds.map((_, i) => i).filter(i => clusterAssign[i] === c);
  const mean = (fn) => idxs.reduce((a, i) => a + fn(funds[i]), 0) / Math.max(1, idxs.length);
  return { c, n: idxs.length, meanVol: mean(f => f.vol), meanDD: mean(f => Math.abs(f.dd)), meanCagr: mean(f => f.cagr3), meanCons: mean(f => f.cons) };
}).sort((a, b) => a.meanVol - b.meanVol);

const cohortNames = ['Conservative', 'Cautious', 'Balanced', 'Growth', 'Aggressive'];
const cohorts = clusterStats.map((s, rank) => ({
  id: rank,
  name: cohortNames[rank],
  clusterRaw: s.c,
  count: s.n,
  meanVol: s.meanVol,
  meanDD: s.meanDD,
  meanCagr: s.meanCagr,
  meanCons: s.meanCons,
  riskIndex: K > 1 ? rank / (K - 1) : 0.5, // 0 (safest) .. 1 (riskiest)
}));
const rawToCohort = new Map(clusterStats.map((s, rank) => [s.c, rank]));

// ---- RandomForest cross-check ----
const Xrf = funds.map(f => [f.vol, Math.abs(f.dd), f.sharpe, f.cons]);
const yrf = funds.map(f => f.level);
const rfFull = randomForest(Xrf, yrf);
const loo = looEvaluate(Xrf, yrf);
const classCounts = {}; for (const v of yrf) classCounts[v] = (classCounts[v] || 0) + 1;

const fundsOut = funds.map((f, i) => {
  const probs = rfFull.predictProbs(Xrf[i]);
  const arr = rfFull.classes.map(c => [c, probs[c] || 0]).sort((a, b) => b[1] - a[1]);
  const level = arr[0][0];
  const cohortId = rawToCohort.get(clusterAssign[i]);
  return {
    ...f,
    cohortId,
    cohName: cohorts[cohortId].name,
    rf: { level, conf: arr[0][1], agree: level === f.level, runnerUp: arr[1] },
    rfProbs: Object.fromEntries(rfFull.classes.map(c => [c, Math.round((probs[c] || 0) * 1000) / 1000])),
  };
});

const shape = {
  builtOn: new Date().toISOString(),
  riskFree: RISK_FREE,
  bench: { code: BENCH_CODE, name: 'UTI Nifty 50 Index Fund (Direct) — proxy for NIFTY 50' },
  universe: {
    schemesInList: UNIVERSE.length,
    fundsKept: funds.length,
    navPoints: funds.reduce((a, f) => a + f.series.length, 0),
    source: 'api.mfapi.in (AMFI NAV data)',
    navPerPoint: 'weekly (every 5th trading day, last 13 years)',
    skipped,
  },
  cohorts,
  clf: {
    model: 'RandomForest (150 trees, max depth 4, bagged)',
    features: ['volatility 3Y', 'max drawdown 5Y', 'sharpe 3Y', 'monthly-win consistency'],
    labels: 'SEBI Riskometer levels 1-6 (category-typical)',
    looAccuracy: loo.accuracy,
    classCounts,
    confusion: loo.confusion,
  },
  funds: fundsOut,
};

const js = ('// GENERATED FILE — run `node scripts/build-data.mjs` to rebuild\n' +
  `window.FUNDS_DATA = ${JSON.stringify(shape)};\n`);
fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
fs.writeFileSync(OUT_JS, js);
fs.writeFileSync(OUT_JSON, JSON.stringify(shape, null, 1));
console.log(`\nWrote ${OUT_JS} (${(fs.statSync(OUT_JS).size / 1e6).toFixed(2)} MB)`);
console.log(`LOO CV accuracy of RF vs Riskometer levels: ${(loo.accuracy * 100).toFixed(1)}%`);
console.log('Cohorts:', cohorts.map(c => `${c.name}(${c.count})`).join(' '));
