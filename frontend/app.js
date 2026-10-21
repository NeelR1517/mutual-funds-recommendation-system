/* ============================================================
   FundLens — app logic
   Pipeline: profile → risk score → cohort → weighted ranking →
   top-5 + reasons → SIP backtest vs Nifty 50 proxy.
   ============================================================ */
(() => {
  const D = window.FUNDS_DATA;
  if (!D || !D.funds) {
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="padding:12px 24px;background:#fef2f2;color:#dc2626;font-weight:600">
        Missing data/funds-data.js — run <code>node scripts/build-data.mjs</code> first.</div>`);
    return;
  }
  const DAY = 86400000;
  const LVL = ['', 'Low', 'Low to Moderate', 'Moderate', 'Moderately High', 'High', 'Very High'];
  const COHORT_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#fb923c', '#f87171'];
  const BENCH = D.funds.find(f => f.code === D.bench.code);
  const FUNDS = D.funds;
  const byCode = Object.fromEntries(FUNDS.map(f => [f.code, f]));

  // ------------------------------------------------------------------ utils
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const pc = (v, dp = 1) => (v == null ? '—' : `${(v * 100).toFixed(dp)}%`);
  const pcS = (v, dp = 1) => (v == null ? '—' : `${(v * 100).toFixed(dp)}%`);
  const inr = v => `₹${Math.round(v).toLocaleString('en-IN')}`;
  const aumF = cr => `₹${(cr / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k cr`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vals = key => FUNDS.map(f => f[key]).filter(v => v != null).sort((a, b) => a - b);
  const pctile = (v, sorted) => sorted.findIndex(x => x >= v) < 0 ? 1 : sorted.findIndex(x => x >= v) / sorted.length;
  const winsor = (arr, p) => { const n = Math.floor(arr.length * p); return [arr[n], arr[arr.length - 1 - n]]; };
  const S5 = { cagr5: vals('cagr5'), cagr3: vals('cagr3'), sharpe: vals('sharpe'), cons: vals('cons'), dd: FUNDS.map(f => Math.abs(f.dd)).sort((a, b) => a - b), ter: vals('ter'), aum: vals('aum').map(x => Math.log10(x)) };
  // metrics where a LARGER raw value is worse (score high when low)
  const WORSE_IS_BIGGER = new Set(['dd', 'ter']);
  function nz(metric, v) {
    const s = S5[metric]; const [lo, hi] = winsor(s, 0.05);
    let z = (v - lo) / ((hi - lo) || 1);
    if (WORSE_IS_BIGGER.has(metric)) z = 1 - z;
    return Math.max(0, Math.min(1, z));
  }

  const state = {
    profile: { age: 30, horizon: 10, sip: 10000, appetite: 'balanced' },
    score: null,
    cohortId: D.cohorts[2].id, // Balanced until computed
    computed: false,
    weights: { r: 40, c: 20, d: 20, cos: 10, size: 10 },
    btHorizon: 3,
    sort: { key: 'cagr5', dir: -1 },
    filters: { q: '', cat: 'All', cohort: -1 },
  };

  // try restore saved state
  try {
    const sp = JSON.parse(localStorage.getItem('fl.profile'));
    if (sp) state.profile = { ...state.profile, ...sp };
    const sw = JSON.parse(localStorage.getItem('fl.weights'));
    if (sw) state.weights = { ...state.weights, ...sw };
  } catch { /* ignore */ }

  // ------------------------------------------------------------------- Step 1: risk score
  function interp(x, pts) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (x - x0) / (x1 - x0) * (y1 - y0);
      }
    }
    return pts[pts.length - 1][1];
  }
  const clamp01 = v => Math.max(0, Math.min(100, v));

  function scoreProfile(p) {
    const horizon = Math.min(p.horizon, Math.max(1, Math.round((65 - p.age) / 2))); // past ~retirement, cap horizon
    const h = clamp01((horizon - 1) / 14 * 100);
    const a = clamp01((65 - p.age) / 47 * 100);
    const ap = { conservative: 30, balanced: 60, aggressive: 100, unsure: 55 }[p.appetite];
    const s = interp(p.sip, [[1000, 20], [5000, 45], [10000, 60], [25000, 80], [50000, 100]]);
    const parts = [
      { label: 'Investment horizon', raw: horizon, weight: 0.35, val: h, note: p.horizon !== horizon ? `capped by proximity to retirement (${p.horizon}y → ${horizon}y)` : `(1y → 0 · 15y+ → 100)` },
      { label: 'Risk appetite', raw: p.appetite, weight: 0.30, val: ap },
      { label: 'Age', raw: p.age, weight: 0.20, val: a, note: `(65−age)/47` },
      { label: 'Monthly SIP', raw: p.sip, weight: 0.15, val: s },
    ];
    const score = Math.round(parts.reduce((acc, x) => acc + x.weight * x.val, 0));
    const formula = `${parts.map(x => `${x.weight.toFixed(2)}×${Math.round(x.val)}`).join(' + ')} = ${score}`;
    return { score, parts, formula };
  }
  const band = s => s < 25 ? ['Conservative', 0] : s < 45 ? ['Cautious', 1] : s < 65 ? ['Balanced', 2] : s < 85 ? ['Growth', 3] : ['Aggressive', 4];
  function mapCohort(score) {
    let best = D.cohorts[0], bd = Infinity;
    for (const c of D.cohorts) {
      const d = Math.abs(c.riskIndex - score / 100);
      if (d < bd - 1e-9) { bd = d; best = c; }
    }
    return best.id;
  }

  // ------------------------------------------------------------------- Step 4: ranking
  const METRICS = [
    { k: 'r', label: 'Return quality', w: 'r', calc: f => 0.55 * nz('cagr5', f.cagr5 ?? f.cagr3) + 0.25 * nz('cagr3', f.cagr3) + 0.2 * nz('sharpe', f.sharpe) },
    { k: 'c', label: 'Consistency', calc: f => nz('cons', f.cons) },
    { k: 'd', label: 'Drawdown control', calc: f => nz('dd', Math.abs(f.dd)) },
    { k: 'cos', label: 'Cost efficiency', calc: f => nz('ter', f.ter) },
    { k: 'size', label: 'Fund size', calc: f => nz('aum', Math.log10(f.aum)) },
  ];
  const subsOf = f => METRICS.map(m => ({ k: m.k, label: m.label, v: m.calc(f) }));
  function effWeights() {
    const w = state.weights, tot = METRICS.reduce((a, m) => a + (+w[m.k] || 0), 0) || 1;
    return Object.fromEntries(METRICS.map(m => [m.k, (w[m.k] || 0) / tot]));
  }
  const composite = (f, ew) => subsOf(f).reduce((a, s) => a + s.v * ew[s.k], 0);

  // ------------------------------------------------------------------- reasons
  function reasons(f, ss, ew, cohort) {
    const out = [];
    const big = [...ss].sort((a, b) => b.v * ew[b.k] - a.v * ew[a.k]).filter(s => ew[s.k] > 0.02).slice(0, 3);
    for (const s of big) {
      if (s.k === 'r') {
        const pct5 = Math.round(pctile(f.cagr5 ?? f.cagr3, S5.cagr5) * 100);
        const yrs = f.cagr5 != null ? '5' : '3';
        out.push(`<b>Return quality:</b> ${pc(f['cagr' + yrs])} p.a. over the last ${yrs}Y — ${ordinal(pct5)} percentile of the ${FUNDS.length}-fund universe.`);
      } else if (s.k === 'c') {
        out.push(`<b>Consistency:</b> positive in ${Math.round(f.cons * 100)}% of rolling monthly windows over 3 years — steadier than most peers.`);
      } else if (s.k === 'd') {
        out.push(`<b>Drawdown control:</b> worst fall in 5 years was ${pc(f.dd, 1)} (cohort avg ${pc(-(cohort?.meanDD ?? 0), 1)}) — shallow corrections are easier to hold through.`);
      } else if (s.k === 'cos') {
        const cheapPct = Math.round((1 - pctile(f.ter, S5.ter)) * 100);
        out.push(`<b>Cost:</b> TER ${f.ter.toFixed(2)}% — cheaper than ${cheapPct}% of the universe; over years, lower fees compound in your favour.`);
      } else if (s.k === 'size') {
        out.push(`<b>Scale:</b> AUM around ${aumF(f.aum)} — established franchise, smooth operations.`);
      }
    }
    const rf = f.rf;
    if (rf.agree) out.push(`<b>Label check:</b> the RandomForest reads this fund as <b>${LVL[rf.level]}</b> (${Math.round(rf.conf * 100)}% confidence) — matching the official SEBI Riskometer label.`);
    else out.push(`<b>Label check:</b> the model reads <b>${LVL[rf.level]}</b> (${Math.round(rf.conf * 100)}% confidence), while the official label is <b>${LVL[f.level]}</b> — worth a closer look, but modelled behaviour matters more than paperwork.`);
    return out.slice(0, 4);
  }
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  // ------------------------------------------------------------------- chips
  const lvlChip = (lv, pre) => `<span class="chip ${lv <= 2 ? 'ok' : lv <= 4 ? 'warn' : 'bad'}">${pre}${LVL[lv]}</span>`;
  const modelChip = f => {
    const c = f.rf.agree ? `<span class="chip ok">✓ matches SEBI</span>`
      : `<span class="chip warn">≠ label differs</span>`;
    return `<span class="chip indigo">Model: ${LVL[f.rf.level]} ${Math.round(f.rf.conf * 100)}%</span>${c}`;
  };

  // ------------------------------------------------------------------- header / hero
  $('#statFunds').textContent = FUNDS.length;
  $('#statFunds2').textContent = FUNDS.length;
  $('#statPoints').textContent = D.universe.navPoints.toLocaleString('en-IN');
  $('#statCohorts').textContent = D.cohorts.length;
  $('#statAcc').textContent = `${Math.round(D.clf.looAccuracy * 100)}%`;
  $('#cohortSel').innerHTML = D.cohorts.map(c => `<option value="${c.id}">Cohort: ${c.name}</option>`).join('');
  $('#benchName').textContent = D.bench.name;
  $('#builtOn').textContent = new Date(D.builtOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // ------------------------------------------------------------------- Step 1: Fullscreen Quiz & Dashboard
  const q = { age: $('#qAge'), horizon: $('#qHorizon'), sip: $('#qSip') };
  const ageVal = $('#ageVal'), horVal = $('#horVal'), sipVal = $('#sipVal');
  const QUIZ_TOPICS = ['', 'Investor Age', 'Investment Horizon', 'Monthly SIP', 'Risk Tolerance'];
  let currentQuizStep = 1;

  function setQuizStep(step, dir = 'forward') {
    if (step < 1 || step > 4) return;
    currentQuizStep = step;
    if ($('#quizStepBadge')) $('#quizStepBadge').textContent = `Question ${step} of 4`;
    if ($('#quizTopicTitle')) $('#quizTopicTitle').textContent = QUIZ_TOPICS[step];
    if ($('#quizProgressBar')) $('#quizProgressBar').style.width = `${step * 25}%`;

    $$('.quiz-screen').forEach(s => {
      const sStep = +s.dataset.step;
      s.classList.remove('active', 'slide-in-right', 'slide-in-left');
      if (sStep === step) {
        s.classList.add('active', dir === 'forward' ? 'slide-in-right' : 'slide-in-left');
      }
    });
  }

  function openQuiz(step = 1) {
    setQuizStep(step, 'forward');
    const qv = $('#quizView');
    if (qv) qv.classList.add('open');
    const az = $('#quizAnalyzing');
    if (az) az.hidden = true;
    document.body.style.overflow = 'hidden';
  }

  function closeQuiz() {
    const qv = $('#quizView');
    if (qv) qv.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Quiz navigation buttons
  $$('.quiz-btn-next').forEach(btn => {
    btn.onclick = () => setQuizStep(+btn.dataset.next, 'forward');
  });
  $$('.quiz-btn-prev').forEach(btn => {
    btn.onclick = () => setQuizStep(+btn.dataset.prev, 'backward');
  });

  const btnExit = $('#btnExitQuiz');
  if (btnExit) btnExit.onclick = closeQuiz;

  const btnStart = $('#btnStartQuiz');
  if (btnStart) btnStart.onclick = () => openQuiz(1);

  const heroBtn = $('#heroStartQuiz');
  if (heroBtn) {
    heroBtn.onclick = (e) => {
      e.preventDefault();
      if (state.computed) {
        const target = $('#profileSummaryBar') || $('#profile');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        openQuiz(1);
      }
    };
  }

  const navProf = $('#navProfile');
  if (navProf) {
    navProf.onclick = (e) => {
      e.preventDefault();
      if (state.computed) {
        const target = $('#profileSummaryBar') || $('#profile');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        openQuiz(1);
      }
    };
  }

  $$('.quiz-presets .preset-pill').forEach(btn => {
    btn.onclick = () => {
      const parent = btn.closest('.quiz-presets');
      const targetId = parent.dataset.for;
      const val = +btn.dataset.val;
      if (targetId === 'qAge') {
        state.profile.age = val;
      } else if (targetId === 'qHorizon') {
        state.profile.horizon = val;
      } else if (targetId === 'qSip') {
        state.profile.sip = val;
      }
      refreshQRS();
    };
  });

  function refreshQRS() {
    const p = state.profile;
    q.age.value = p.age; q.horizon.value = p.horizon; q.sip.value = p.sip;
    ageVal.textContent = p.age;
    horVal.textContent = p.horizon;
    sipVal.textContent = `₹${p.sip.toLocaleString('en-IN')}`;
    $$('.radiocards input').forEach(r => { r.checked = r.value === p.appetite; });

    // Update preset pills active state
    $$('.quiz-presets[data-for="qAge"] .preset-pill').forEach(b => b.classList.toggle('active', +b.dataset.val === p.age));
    $$('.quiz-presets[data-for="qHorizon"] .preset-pill').forEach(b => b.classList.toggle('active', +b.dataset.val === p.horizon));
    $$('.quiz-presets[data-for="qSip"] .preset-pill').forEach(b => b.classList.toggle('active', +b.dataset.val === p.sip));

    // Dynamic horizon retirement calculation hint
    const retireYears = Math.max(1, 65 - p.age);
    const hintEl = $('#horizonRetireHint');
    if (hintEl) {
      if (p.horizon > retireYears) {
        hintEl.innerHTML = `<span style="color:var(--warn)">⚠️ At age ${p.age}, years to retirement (65 − ${p.age} = ${retireYears} yrs) caps your effective horizon in the model.</span>`;
      } else {
        hintEl.textContent = `Horizon is capped by years left to retirement (65 − ${p.age} = ${retireYears} yrs).`;
      }
    }
  }
  refreshQRS();

  q.age.oninput = () => { state.profile.age = +q.age.value; refreshQRS(); };
  q.horizon.oninput = () => { state.profile.horizon = +q.horizon.value; refreshQRS(); };
  q.sip.oninput = () => { state.profile.sip = +q.sip.value; refreshQRS(); };
  $$('.radiocards input').forEach(r => r.onchange = () => { state.profile.appetite = r.value; refreshQRS(); });

  $('#btnCompute').onclick = () => runProfile(false);
  $('#btnSample').onclick = () => {
    state.profile = { age: 52, horizon: 3, sip: 25000, appetite: 'conservative' };
    refreshQRS();
    runProfile(true);
  };
  const btnLaunchSample = $('#btnLaunchSample');
  if (btnLaunchSample) {
    btnLaunchSample.onclick = () => {
      state.profile = { age: 52, horizon: 3, sip: 25000, appetite: 'conservative' };
      refreshQRS();
      runProfile(true);
    };
  }

  // Keyboard navigation within quiz
  document.addEventListener('keydown', e => {
    const qv = $('#quizView');
    if (!qv || !qv.classList.contains('open')) return;
    if (e.key === 'Escape') {
      closeQuiz();
    } else if (e.key === 'Enter') {
      if (currentQuizStep < 4) {
        setQuizStep(currentQuizStep + 1, 'forward');
      } else if (currentQuizStep === 4) {
        runProfile(false);
      }
    }
  });

  function runProfile(sample) {
    localStorage.setItem('fl.profile', JSON.stringify(state.profile));
    const r = scoreProfile(state.profile);
    state.score = r.score;
    state.computed = true;
    state.cohortId = mapCohort(r.score);
    $('#btAmt').value = state.profile.sip;

    if (sample) {
      closeQuiz();
      showDashboard(r);
      toast('Sample profile loaded — 52 yrs, 3Y horizon, ₹25k SIP, conservative');
      return;
    }

    // Hide question screens, show analyzing screen inside quiz view
    $$('.quiz-screen').forEach(s => s.classList.remove('active'));
    const az = $('#quizAnalyzing');
    if (az) az.hidden = false;

    const as1 = $('#as1'), as2 = $('#as2'), as3 = $('#as3');
    if (as1 && as2 && as3) {
      as1.className = 'astep active'; as2.className = 'astep'; as3.className = 'astep';
      $('#analyzingTitle').textContent = 'Evaluating your risk profile...';
      $('#analyzingSub').textContent = 'Normalising age, horizon and monthly SIP capacity...';

      setTimeout(() => {
        as1.className = 'astep done'; as2.className = 'astep active';
        $('#analyzingTitle').textContent = 'Clustering fund cohorts...';
        $('#analyzingSub').textContent = 'Matching your score against 5 K-Means risk cohorts...';
      }, 420);

      setTimeout(() => {
        as2.className = 'astep done'; as3.className = 'astep active';
        $('#analyzingTitle').textContent = 'Running model verification...';
        $('#analyzingSub').textContent = 'RandomForest cross-check against SEBI Riskometer labels...';
      }, 840);

      setTimeout(() => {
        as3.className = 'astep done';
        // Redirect to main page dashboard!
        closeQuiz();
        showDashboard(r);
        toast(`✦ Profile evaluated! Risk score: ${r.score}/100`);
      }, 1300);
    } else {
      closeQuiz();
      showDashboard(r);
    }
  }

  function showDashboard(r) {
    const promptCard = $('#quizPromptCard');
    if (promptCard) promptCard.hidden = true;
    $('#profileSummaryBar').hidden = false;
    $('#scoreCard').hidden = false;
    $('#results').hidden = false;

    // Update summary bar data
    const p = state.profile;
    $('#sumAge').textContent = p.age;
    $('#sumHorizon').textContent = p.horizon;
    $('#sumSip').textContent = `₹${p.sip.toLocaleString('en-IN')}`;
    const appLabel = { conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Aggressive', unsure: 'Not sure' }[p.appetite] || p.appetite;
    $('#sumApp').textContent = appLabel;

    renderScore(r);
    renderCohortStrip();
    renderShortlist();
    runBacktest();

    window.location.hash = '#dashboard';
    const target = document.getElementById('profileSummaryBar');
    if (target) {
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }

  const retakeBtn = $('#btnRetakeQuiz');
  if (retakeBtn) retakeBtn.onclick = () => openQuiz(1);

  // Check URL hash for direct quiz launch
  if (window.location.hash === '#quiz' || window.location.hash === '#survey') {
    openQuiz(1);
  }

  function renderScore(r) {
    const [bandName, bandId] = band(r.score);
    const circ = 2 * Math.PI * 62;
    const dash = (r.score / 100) * (circ / 2);
    const scoreBox = $('#scoreCard');
    if (scoreBox.hidden) scoreBox.hidden = false;
    $('#gaugeArc').style.strokeDasharray = `${dash} ${circ}`;
    $('#scoreNum').textContent = r.score;
    $('#scoreBand').textContent = `${bandName} (score → ${bandName.toLowerCase()})`;
    const bl = $('#breakdown');
    bl.innerHTML = '';
    for (const p of r.parts) {
      bl.insertAdjacentHTML('beforeend', `
        <div class="bd-row">
          <div class="bd-head"><span>${p.label}${p.note ? ` <span class="w">· ${esc(p.note)}</span>` : ''}</span>
          <span class="w">weight ${(p.weight * 100).toFixed(0)}% · contributes ${Math.round(p.val * p.weight)}</span></div>
          <div class="bd-bar"><i style="width:${p.val}%"></i></div>
        </div>`);
    }
    $('#scoreFormula').innerHTML = `RiskScore = ${esc(r.formula)} &nbsp;·&nbsp; each factor normalised to 0–100 &nbsp;·&nbsp; horizon is capped by years left to retirement, so a 60-y/o can’t claim a 20-yr horizon.`;
    const c = D.cohorts[state.cohortId];
    $('#mapText').innerHTML = `<span class="chip indigo">→ Cohort: ${c.name}</span> your score of <b>${r.score}</b> sits nearest the <b>${c.name}</b> cohort’s risk index (${(c.riskIndex * 100).toFixed(0)}/100). Funds inside that cohort are ranked below.`;
    $('#cohortSel').value = state.cohortId;
  }

  $('#cohortSel').onchange = () => { if (!state.computed) return; state.cohortId = +$('#cohortSel').value; renderCohortStrip(); renderShortlist(); runBacktest(); };

  // ------------------------------------------------------------------- cohorts strip
  function renderCohortStrip() {
    const strip = $('#cohortStrip');
    strip.innerHTML = '';
    for (const c of D.cohorts) {
      const active = c.id === state.cohortId;
      strip.appendChild(el('div', `cohort${active ? ' active' : ''}`, `
        <h3><span>${c.name}</span><span class="n">${c.count} funds</span></h3>
        <div class="risk-pip"><i style="width:${(c.riskIndex * 100).toFixed(0)}%;background:${COHORT_COLORS[c.id]}"></i></div>
        <dl>
          <dt>Avg volatility</dt><dd>${pc(c.meanVol)}</dd>
          <dt>Avg 3Y CAGR</dt><dd>${pc(c.meanCagr)}</dd>
          <dt>Avg max DD</dt><dd>${pc(c.meanDD)}</dd>
          <dt>Avg consistency</dt><dd>${Math.round(c.meanCons * 100)}%</dd>
        </dl>`));
      strip.lastChild.onclick = () => { if (!state.computed) { toast('Fill the questionnaire first — or try the sample profile.'); return; } state.cohortId = c.id; $('#cohortSel').value = c.id; renderCohortStrip(); renderShortlist(); runBacktest(); };
    }
  }

  // ------------------------------------------------------------------- weights
  const presets = {
    'Balanced (default)': { r: 40, c: 20, d: 20, cos: 10, size: 10 },
    'Growth-first': { r: 55, c: 15, d: 10, cos: 10, size: 10 },
    'Safety-first': { r: 20, c: 20, d: 45, cos: 10, size: 5 },
    'Cheapest': { r: 25, c: 10, d: 15, cos: 45, size: 5 },
  };
  function renderWeights() {
    const box = $('#weightsBox');
    box.innerHTML = '';
    for (const m of METRICS) {
      box.insertAdjacentHTML('beforeend', `
        <div class="w-row"><span>${m.label}</span>
        <input type="range" min="0" max="60" value="${state.weights[m.k]}" data-w="${m.k}">
        <span class="wp" id="wp-${m.k}">${state.weights[m.k]}%</span></div>`);
    }
    $$('#weightsBox input').forEach(inp => inp.oninput = () => {
      state.weights[inp.dataset.w] = +inp.value;
      localStorage.setItem('fl.weights', JSON.stringify(state.weights));
      renderWeights();
      renderShortlist();
      if (state.computed) runBacktest();
    });
    const pr = $('#presetRow');
    pr.innerHTML = '';
    for (const name of Object.keys(presets)) {
      const b = el('button', 'btn small', name);
      b.onclick = () => { state.weights = { ...presets[name] }; localStorage.setItem('fl.weights', JSON.stringify(state.weights)); renderWeights(); renderShortlist(); runBacktest(); };
      pr.appendChild(b);
    }
    pr.appendChild(el('span', 'note', `Weights normalise to 100% — sliders are relative.`));
  }
  renderWeights();

  // ------------------------------------------------------------------- shortlist
  let lastTop = [];
  function renderShortlist() {
    const ew = effWeights();
    const cohort = D.cohorts[state.cohortId];
    const members = FUNDS.filter(f => f.cohortId === state.cohortId)
      .map(f => ({ f, ss: subsOf(f), comp: composite(f, ew) }))
      .sort((a, b) => b.comp - a.comp);
    lastTop = members;
    const box = $('#shortlist');
    box.innerHTML = '';
    $('#shortlistTitle').innerHTML = state.computed
      ? `Top picks for the <span class="chip indigo">${cohort.name}</span> cohort · ranked by your weights`
      : 'Top picks · ranked by your weights (default cohort shown)';
    const showN = state.showAll ? members.length : Math.min(5, members.length);
    members.slice(0, showN).forEach((m, i) => box.appendChild(fundCard(m, i + 1, cohort, ew, showN < members.length)));
    if (members.length > 5) {
      const b = el('button', 'btn small', state.showAll ? `Show top 5 only` : `Show all ${members.length} in this cohort ↓`);
      b.onclick = () => { state.showAll = !state.showAll; renderShortlist(); };
      box.appendChild(b);
    }
  }

  function fundCard(m, rank, cohort, ew, compact) {
    const f = m.f;
    const card = el('div', 'fcard');
    card.innerHTML = `
      <div class="f-head">
        <div class="rank">${rank}</div>
        <div>
          <h3>${esc(f.name)}</h3>
          <div class="f-sub">${esc(f.house)} · ${esc(f.cat)} · since ${new Date(f.start).getUTCFullYear()}</div>
        </div>
        <div class="f-chips">${lvlChip(f.level, 'SEBI: ')}${modelChip(f)}</div>
      </div>
      <div class="mgrid">
        <div class="metric"><b class="num">${pc(f.cagr1)}</b><span>CAGR 1Y</span></div>
        <div class="metric"><b class="num">${pc(f.cagr3)}</b><span>CAGR 3Y</span></div>
        <div class="metric"><b class="num">${pc(f.cagr5)}</b><span>CAGR 5Y</span></div>
        <div class="metric"><b class="num">${pc(f.vol)}</b><span>Volatility</span></div>
        <div class="metric"><b class="num">${f.sharpe.toFixed(2)}</b><span>Sharpe</span></div>
        <div class="metric"><b class="num">${pc(f.dd)}</b><span>Max DD 5Y</span></div>
        <div class="metric"><b class="num">${f.ter.toFixed(2)}%</b><span>TER</span></div>
        <div class="metric"><b class="num">${aumF(f.aum)}</b><span>AUM</span></div>
      </div>
      <ul class="reasons">${reasons(f, m.ss, ew, cohort).map(r => `<li>${r}</li>`).join('')}</ul>
      <div class="f-scorebar">
        <span class="total num">${(m.comp * 100).toFixed(1)}</span><span style="font-size:10px;color:var(--faint);font-weight:600">/100<br>score</span>
        ${m.ss.map(s => `<div class="piece"><span>${s.label} <b>${Math.round(s.v * 100)}</b> · w ${(ew[s.k] * 100).toFixed(0)}%</span><div class="bd-bar"><i style="width:${s.v * 100}%;background:${COHORT_COLORS[cohort.id]}"></i></div></div>`).join('')}
      </div>`;
    return card;
  }

  // ------------------------------------------------------------------- SIP backtest
  function xirr(flows) {
    const t0 = flows[0].t;
    const fn = r => flows.reduce((a, c) => a + c.amt / Math.pow(1 + r, (c.t - t0) / (365.25 * DAY)), 0);
    let lo = -0.95, hi = 4;
    if (fn(lo) * fn(hi) > 0) return null;
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (fn(lo) * fn(mid) <= 0) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  }

  function monthlyInvests(pts) {
    const invests = [];
    let curMonth = -1;
    for (const p of pts) {
      const dt = new Date(p.t);
      const mo = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
      if (mo === curMonth) continue;
      curMonth = mo;
      invests.push({ t: p.t, nav: p.nav });
    }
    return invests;
  }

  function sipPath(pts, invests, amt, axis) {
    const invested = [], values = [];
    let units = 0, ui = 0, ni = 0;
    for (const t of axis) {
      while (ui < invests.length && invests[ui].t <= t) { units += amt / invests[ui].nav; ui++; }
      while (ni < pts.length - 1 && pts[ni + 1].t <= t) ni++;
      invested.push(ui * amt);
      values.push(units ? units * pts[ni].nav : 0);
    }
    return { invested, values };
  }

  function sipBacktest(funds, monthly, years) {
    const allAxis = BENCH.series.map(([d]) => d * DAY);
    const cutoff = allAxis[allAxis.length - 1] - years * 365.25 * DAY;
    const axis = allAxis.filter(t => t >= cutoff);
    const per = monthly / Math.max(1, funds.length);
    const excluded = [];
    const paths = [];
    const flows = [];
    let investedEnd = 0;
    for (const f of funds) {
      if (f.series[0][0] * DAY > cutoff + 60 * DAY) { excluded.push(f.name); continue; }
      const pts = f.series.filter(([d]) => d * DAY >= cutoff).map(([d, n]) => ({ t: d * DAY, nav: n }));
      if (pts.length < 2) { excluded.push(f.name); continue; }
      const invests = monthlyInvests(pts);
      paths.push(sipPath(pts, invests, per, axis));
      for (const iv of invests) flows.push({ t: iv.t, amt: -per });
      investedEnd += invests.length * per;
    }
    // benchmark: the same SIP schedule on the Nifty 50 proxy, full amount
    const bpts = BENCH.series.filter(([d]) => d * DAY >= cutoff).map(([d, n]) => ({ t: d * DAY, nav: n }));
    const binvs = monthlyInvests(bpts);
    const bp = sipPath(bpts, binvs, monthly, axis);
    const benchFlows = binvs.map(iv => ({ t: iv.t, amt: -monthly }));

    const invested = axis.map((_, i) => paths.reduce((a, p) => a + p.invested[i], 0));
    const basket = axis.map((_, i) => paths.reduce((a, p) => a + p.values[i], 0));
    const tEnd = axis[axis.length - 1];
    const basketFlows = [...flows, { t: tEnd, amt: basket[basket.length - 1] }];
    const benchXFlows = [...benchFlows, { t: tEnd, amt: bp.values[bp.values.length - 1] }];
    return {
      axis, invested, basket, bench: bp.values,
      investedEnd,
      basketEnd: basket[basket.length - 1],
      benchEnd: bp.values[bp.values.length - 1],
      benchInvestedEnd: binvs.length * monthly,
      xirrB: xirr(basketFlows), xirrN: xirr(benchXFlows),
      ddB: pathDD(basket), ddN: pathDD(bp.values),
      excluded,
    };
  }

  function pathDD(arr) {
    let peak = -Infinity, dd = 0;
    for (const v of arr) { if (v > peak) peak = v; if (v > 0 && peak > 0) dd = Math.min(dd, v / peak - 1); }
    return dd;
  }

  let lastBT = null;
  function runBacktest() {
    const amt = Math.max(1000, +$('#btAmt').value || state.profile.sip);
    const years = state.btHorizon;
    const basketFunds = lastTop.slice(0, 5).map(m => m.f);
    if (!basketFunds.length) { renderShortlist(); }
    const bt = sipBacktest(basketFunds, amt, years);
    lastBT = bt;
    renderBTResult(bt, amt, years);
  }
  $('#btTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    state.btHorizon = +b.dataset.y;
    $('#btTabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    runBacktest();
  });
  $('#btAmt').onchange = () => { if (state.computed) runBacktest(); };

  function renderBTResult(bt, amt, years) {
    const wrap = $('#btOut');
    wrap.hidden = false;
    Charts.line($('#btChart'), {
      height: 300,
      series: [
        { name: `Fund basket (top 5, equal split)`, pts: bt.axis.map((t, i) => [t, bt.basket[i]]), color: 'var(--brand)', width: 2.4, vFmt: v => inr(v) },
        { name: `Nifty 50 proxy (${BENCH.name.split('(')[0].trim()})`, pts: bt.axis.map((t, i) => [t, bt.bench[i]]), color: '#94a3b8', dash: [5, 4], vFmt: v => inr(v) },
        { name: 'Amount invested', pts: bt.axis.map((t, i) => [t, bt.invested[i]]), color: '#64748b', dash: [2, 3], width: 1.5, vFmt: v => inr(v) },
      ].map(s => ({ ...s, pts: s.pts.filter(([, v]) => Number.isFinite(v)) })),
      yFmt: v => v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : `₹${(v / 1e5).toFixed(0)}L`,
    });
    const row = (h, b) => `
      <tr>
        <td><b>${h} yr</b> SIP of ${inr(amt)}/mo</td>
        <td>${inr(b.investedEnd)}</td>
        <td class="${(b.xirrB ?? -1) >= (b.xirrN ?? -1) ? 'good' : ''}">${inr(b.basketEnd)}</td>
        <td class="num ${b.xirrB >= 0 ? '' : 'negative'}">${b.xirrB != null ? pc(b.xirrB) : '—'}</td>
        <td class="num">${pc(b.ddB)}</td>
        <td>${inr(b.benchEnd)}</td>
        <td class="num ${b.xirrN >= 0 ? '' : 'negative'}">${b.xirrN != null ? pc(b.xirrN) : '—'}</td>
        <td class="num">${pc(b.ddN)}</td>
      </tr>`;
    $('#btTable').innerHTML = `
      <thead><tr>
      <th>Horizon · SIP</th><th>Invested</th>
      <th style="color:var(--brand)">Basket value</th><th style="color:var(--brand)">Basket XIRR</th><th style="color:var(--brand)">Basket max DD</th>
      <th>Nifty 50 value</th><th>Nifty 50 XIRR</th><th>Nifty 50 max DD</th>
      </tr></thead><tbody>` + row(state.btHorizon, bt) + `</tbody>`;
    const winner = (bt.xirrB ?? -1) >= (bt.xirrN ?? -1);
    $('#btVerdict').innerHTML = `
      ${winner ? '<b style="color:var(--ok)">The basket beat the Nifty 50 proxy</b>' : 'The Nifty 50 proxy beat the basket'} over ${years} year${years > 1 ? 's' : ''} on XIRR (${pc(bt.xirrB)} vs ${pc(bt.xirrN)}). Max drawdown: basket ${pc(bt.ddB)} vs index ${pc(bt.ddN)}.
      ${bt.excluded.length ? `<br><span class="bt-note">Excluded for lacking ${years}Y of history: ${bt.excluded.map(esc).join(', ')} — their share of the SIP was spread over the remaining ${5 - bt.excluded.length} funds.</span>` : ''}`;
  }

  // ------------------------------------------------------------------- explore table
  const cats = ['All', ...new Set(FUNDS.map(f => f.cat))];
  $('#catSel').innerHTML = cats.map(c => `<option>${c}</option>`).join('');
  $('#cohortChips').innerHTML = D.cohorts.map(c =>
    `<span class="chip f-chip" data-c="${c.id}" style="border-color:${COHORT_COLORS[c.id]}55">${c.name}<span style="opacity:.6">${c.count}</span></span>`).join('')
    + `<span class="chip f-chip" data-c="-1">All cohorts</span>`;
  $$('#cohortChips .f-chip').forEach(ch => ch.onclick = () => {
    state.filters.cohort = +ch.dataset.c;
    $$('#cohortChips .f-chip').forEach(x => x.classList.toggle('on', x === ch));
    renderTable();
  });
  $('[data-c="-1"]').classList.add('on');
  $('#searchBox').oninput = () => { state.filters.q = $('#searchBox').value.toLowerCase(); renderTable(); };
  $('#catSel').onchange = () => { state.filters.cat = $('#catSel').value; renderTable(); };

  function sortVal(f, key) {
    return {
      name: f.name, cat: f.cat, cohort: f.cohortId, cagr3: f.cagr3 ?? -9, cagr5: f.cagr5 ?? -9,
      vol: f.vol, sharpe: f.sharpe, dd: f.dd, ter: f.ter, aum: f.aum, level: f.level, rf: f.rf.level,
    }[key];
  }
  function renderTable() {
    let fs = FUNDS.filter(f =>
      (state.filters.cat === 'All' || f.cat === state.filters.cat) &&
      (state.filters.cohort < 0 || f.cohortId === state.filters.cohort) &&
      (!state.filters.q || (f.name + ' ' + f.house).toLowerCase().includes(state.filters.q)));
    fs = fs.sort((a, b) => {
      const va = sortVal(a, state.sort.key), vb = sortVal(b, state.sort.key);
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * state.sort.dir;
    });
    const cohMap = Object.fromEntries(D.cohorts.map(c => [c.id, c]));
    $('#fundTable').innerHTML = `
      <thead><tr>
        <th class="left" data-k="name">Fund</th><th data-k="cat">Category</th><th data-k="cohort">Cohort</th>
        <th data-k="cagr3">CAGR 3Y</th><th data-k="cagr5">CAGR 5Y</th><th data-k="vol">Vol</th><th data-k="sharpe">Sharpe</th>
        <th data-k="dd">Max DD</th><th data-k="ter">TER</th><th data-k="aum">AUM</th>
        <th data-k="level" class="left">SEBI label</th><th data-k="rf" class="left">Model check</th>
      </tr></thead>
      <tbody>${fs.map(f => `
        <tr data-code="${f.code}">
          <td class="left fname"><b>${esc(f.name)}</b><span>${esc(f.house)}</span></td>
          <td>${esc(f.cat)}</td>
          <td><span class="chip" style="color:${COHORT_COLORS[f.cohortId]};border-color:${COHORT_COLORS[f.cohortId]}55;background:${COHORT_COLORS[f.cohortId]}14">${cohMap[f.cohortId].name}</span></td>
          <td>${pc(f.cagr3)}</td><td>${pc(f.cagr5)}</td><td>${pc(f.vol)}</td><td>${f.sharpe.toFixed(2)}</td>
          <td>${pc(f.dd)}</td><td>${f.ter.toFixed(2)}%</td><td>${aumF(f.aum)}</td>
          <td class="left">${lvlChip(f.level, '')}</td>
          <td class="left"><span class="chip ${f.rf.agree ? 'ok' : 'warn'}">${LVL[f.rf.level]} ${Math.round(f.rf.conf * 100)}% ${f.rf.agree ? '✓' : '≠'}</span></td>
        </tr>`).join('')}</tbody>`;
    $$('#fundTable th[data-k]').forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: -1 };
      renderTable();
    });
    $$('#fundTable tr').forEach(tr => tr.onclick = () => openModal(+tr.dataset.code));
  }
  renderTable();

  // scatter
  const cohOf = f => D.cohorts.find(c => c.id === f.cohortId);
  function renderScatter() {
    Charts.scatter($('#scatter'), {
      height: 360,
      xLabel: `Volatility (annualised, 3Y) %`, yLabel: `CAGR 3Y %`,
      points: FUNDS.map(f => ({ x: f.vol * 100, y: f.cagr3 * 100, color: COHORT_COLORS[f.cohortId], f })),
      xFmt: v => `${Math.round(v)}%`, yFmt: v => `${Math.round(v)}%`,
      tipFmt: p => `<b>${esc(p.f.name)}</b><br>${esc(p.f.cat)} · ${cohOf(p.f).name}<br>Vol ${pc(p.f.vol)} · CAGR3 ${pc(p.f.cagr3)} · DD ${pc(p.f.dd)}<br><span style="opacity:.7">click for details</span>`,
      onPick: p => openModal(p.f.code),
    });
  }
  renderScatter();

  // ------------------------------------------------------------------- modal
  function openModal(code) {
    const f = byCode[code];
    if (!f) return;
    const cohort = cohOf(f);
    const ew = effWeights();
    const m = { f, ss: subsOf(f), comp: composite(f, ew) };
    $('#mName').textContent = f.name;
    $('#mSub').textContent = `${f.house} · ${f.cat} · ${D.cohorts[f.cohortId].name} cohort · since ${new Date(f.start).getUTCFullYear()}`;
    $('#mChips').innerHTML = lvlChip(f.level, 'SEBI: ') + modelChip(f) + `<span class="chip">TER ${f.ter.toFixed(2)}%</span><span class="chip">AUM ${aumF(f.aum)}</span>`;
    Charts.line($('#mChart'), {
      height: 250,
      series: [{ name: 'NAV (weekly)', pts: f.series.map(([d, n]) => [d * DAY, n]), color: COHORT_COLORS[f.cohortId], vFmt: v => `₹${v.toFixed(2)}` }],
      yFmt: v => `₹${v.toFixed(0)}`,
    });
    $('#mMetrics').innerHTML = [
      ['CAGR 1Y', pc(f.cagr1)], ['CAGR 3Y', pc(f.cagr3)], ['CAGR 5Y', pc(f.cagr5)],
      ['Volatility 3Y', pc(f.vol)], ['Sharpe', f.sharpe.toFixed(2)], ['Max DD 5Y', pc(f.dd)],
      ['Monthly-win %', `${Math.round(f.cons * 100)}%`], ['Composite', (m.comp * 100).toFixed(1) + '/100'],
    ].map(([l, v]) => `<div class="metric"><b class="num">${v}</b><span>${l}</span></div>`).join('');
    const probs = Object.entries(f.rfProbs).sort((a, b) => a[0] - b[0]);
    $('#mRf').innerHTML = `<h3 style="margin:18px 0 6px">RandomForest risk read (vs SEBI label)</h3>
      <div class="bt-note">Trained on ${FUNDS.length} funds · LOO-CV accuracy ${Math.round(D.clf.looAccuracy * 100)}% · features: volatility, drawdown, Sharpe, consistency.</div>
      <div class="rf-bars">${probs.map(([lv, p]) => `
        <div class="rf-row ${+lv === f.rf.level ? 'best' : (f.rf.agree || +lv !== f.level ? '' : '')}">
          <span>L${lv} · ${LVL[+lv]}${+lv === f.level ? ' ← official' : ''}</span>
          <span class="bar"><i style="width:${p * 100}%"></i></span>
          <span class="num">${Math.round(p * 100)}%</span>
        </div>`).join('')}</div>
      ${f.rf.agree
        ? `<div class="chip ok">✓ Model (${LVL[f.rf.level]}) agrees with the official label (${LVL[f.level]})</div>`
        : `<div class="chip warn">≠ Model says ${LVL[f.rf.level]} (${Math.round(f.rf.conf * 100)}% conf) — official label reads ${LVL[f.level]}. Second vote: ${LVL[f.rf.runnerUp[0]]} at ${Math.round(f.rf.runnerUp[1] * 100)}%.</div>`}`;
    const ss = subsOf(f);
    $('#mReasons').innerHTML = `<h3 style="margin:18px 0 6px">Why this fund charts the way it does</h3>
      <ul class="reasons">${reasons(f, m.ss, ew, cohort).map(r => `<li>${r}</li>`).join('')}</ul>`;
    $('#modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  $('#mClose').onclick = () => { $('#modal').classList.remove('open'); document.body.style.overflow = ''; };
  $('#modal').onclick = e => { if (e.target.id === 'modal') { $('#modal').classList.remove('open'); document.body.style.overflow = ''; } };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#modal').classList.remove('open'); document.body.style.overflow = ''; } });

  // ------------------------------------------------------------------- method stats
  $('#methodStats').innerHTML = `
    <div class="stat"><b>${FUNDS.length}</b><span>funds in universe</span></div>
    <div class="stat"><b>${D.universe.navPoints.toLocaleString('en-IN')}</b><span>weekly NAV points</span></div>
    <div class="stat"><b>${(D.builtOn ? new Date(D.builtOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')}</b><span>data built on (mfapi.in / AMFI)</span></div>`;

  // ------------------------------------------------------------------- toast
  let tt = null;
  function toast(msg) {
    let t = $('#toast'); if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;font-size:13.5px;font-weight:600;padding:11px 20px;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.25);z-index:99;transition:opacity .3s;opacity:1';
    clearTimeout(tt);
    tt = setTimeout(() => { t.style.opacity = '0'; }, 3400);
  }

  // nav active state
  const secs = ['profile', 'explore', 'method'].map(id => document.getElementById(id));
  const navLinks = $$('.topnav a');
  const onScroll = () => {
    let cur = null;
    for (const s of secs) if (s.getBoundingClientRect().top < 120) cur = s.id;
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
  };
  document.addEventListener('scroll', onScroll, { passive: true });
})();
