// Helper: find scheme codes by name pattern in the mfapi.in scheme list.
// Usage: node scripts/find-schemes.mjs "bluechip" "flexi" ...
// Reads the cached list from %TEMP%/opencode/mf_all.json (downloads if missing).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE = path.join(os.tmpdir(), 'opencode', 'mf_all.json');

async function ensureList() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const res = await fetch('https://api.mfapi.in/mf');
  const json = await res.json();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(json));
  return json;
}

const list = await ensureList();
const all = Array.isArray(list) ? list : Object.values(list);
const patterns = process.argv.slice(2);
for (const p of patterns) {
  const rx = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const hits = all.filter((s) => rx.test(s.schemeName)).slice(0, 20);
  console.log(`\n=== /${p}/ -> ${all.filter((s) => rx.test(s.schemeName)).length} hits ===`);
  for (const h of hits) console.log(h.schemeCode, h.schemeName);
}
