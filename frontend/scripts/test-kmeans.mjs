// Quick experiment: load funds-data.json, try clustering configs, print sizes.
import fs from 'node:fs';
const D = JSON.parse(fs.readFileSync('data/funds-data.json', 'utf8'));
const F = D.funds;

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function kmeans(X, k, seed) {
  const rng = mulberry32(seed); const n = X.length;
  const cents = [X[Math.floor(rng() * n)].slice()];
  while (cents.length < k) { const d = X.map(x => Math.min(...cents.map(c => c.reduce((s, v, i) => s + (v - x[i]) ** 2, 0)))); const tot = d.reduce((a, b) => a + b, 0); let r = rng() * tot, pick = 0; for (let i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break; } } cents.push(X[pick].slice()); }
  let assign = new Array(n).fill(0);
  for (let it = 0; it < 300; it++) { let ch = false; for (let i = 0; i < n; i++) { let b = 0, bd = Infinity; for (let c = 0; c < k; c++) { const d = X[i].reduce((s, v, j) => s + (v - cents[c][j]) ** 2, 0); if (d < bd) { bd = d; b = c; } } if (assign[i] !== b) { assign[i] = b; ch = true; } } const sums = Array.from({ length: k }, () => new Array(X[0].length).fill(0)); const cnt = new Array(k).fill(0); for (let i = 0; i < n; i++) { cnt[assign[i]]++; for (let j = 0; j < X[0].length; j++) sums[assign[i]][j] += X[i][j]; } for (let c = 0; c < k; c++) if (cnt[c] > 0) for (let j = 0; j < X[0].length; j++) cents[c][j] = sums[c][j] / cnt[c]; if (!ch) break; }
  return assign;
}
function zscore(rows, w) { const k = rows[0].length; const mu = new Array(k).fill(0), sd = new Array(k).fill(0); for (const r of rows) for (let j = 0; j < k; j++) mu[j] += r[j]; for (let j = 0; j < k; j++) mu[j] /= rows.length; for (const r of rows) for (let j = 0; j < k; j++) sd[j] += (r[j] - mu[j]) ** 2; for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1; return rows.map(r => r.map((v, j) => ((v - mu[j]) / sd[j]) * (w ? w[j] : 1))); }

function show(label, rows, k, seeds = [1, 5000, 9000]) {
  let best = null;
  for (const s of seeds) {
    const assign = kmeans(rows, k, s * 1000);
    const groups = Array.from({ length: k }, () => []);
    assign.forEach((c, i) => groups[c].push(i));
    const inertia = groups.reduce((a, g) => a + g.reduce((s2, i) => s2 + rows[i].reduce((s3, v, j) => s3 + (v - rows[g[0]][j]) ** 2, 0), 0), 0);
    if (!best || inertia < best.inertia) best = { inertia, groups };
  }
  console.log(`\n== ${label} ==`);
  const stats = best.groups.map(g => {
    const mean = f => g.reduce((s2, i) => s2 + f(F[i]), 0) / Math.max(1, g.length);
    return { n: g.length, vol: mean(f => f.vol) * 100, dd: mean(f => f.dd) * 100, cagr: mean(f => f.cagr3) * 100, cats: [...new Set(g.map(i => F[i].cat))].join(',') };
  });
  for (const st of stats.sort((a, b) => a.vol - b.vol)) console.log(`  n=${st.n} vol=${st.vol.toFixed(1)}% dd=${st.dd.toFixed(1)}% cagr3=${st.cagr.toFixed(1)}% [${st.cats}]`);
}

const logv = f => Math.log10(f.vol);
show('A: [log vol, |dd|, cagr3, cons]', zscore(F.map(f => [logv(f), Math.abs(f.dd), f.cagr3, f.cons])), 5);
show('B: [log vol, |dd|, cagr3]', zscore(F.map(f => [logv(f), Math.abs(f.dd), f.cagr3]), [1, 1.5, 0.8]), 5);
show('C: [log vol x2, |dd| x1.5, cagr3 x0.7, cons x0.4]', zscore(F.map(f => [logv(f), Math.abs(f.dd), f.cagr3, f.cons]), [2, 1.5, 0.7, 0.4]), 5);
show('D: [log vol, |dd| x2, cagr3 x0.6, cons x0.3]', zscore(F.map(f => [logv(f), Math.abs(f.dd), f.cagr3, f.cons]), [1, 2, 0.6, 0.3]), 5);
