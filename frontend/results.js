/* ============================================================
   SahiMF — results dashboard
   Fetches /meta, /overview, /funds and POST /recommend, then
   renders every section from the same API response.
   ============================================================ */
(() => {
  const M = window.SahiMF;
  if (!M) return;

  const $ = M.$;
  const $$ = M.$$;
  const profile = M.getProfile();

  // ---------------------------------------------------------------- gate
  if (!profile) {
    $('#loadingCard').hidden = true;
    $('#resultsGate').hidden = false;
    $('#btnGateSample').onclick = () => {
      M.saveProfile({ age: 52, horizon: 3, sip: 25000, appetite: 'conservative' });
      window.location.reload();
    };
    return;
  }

  const request = M.recommendationRequest(profile);
  const state = {
    meta: null,
    overview: null,
    funds: [],
    fundMap: {},
    recommendation: null,
    filters: { query: '', category: 'all', poolOnly: true, sort: 'score', showAll: false },
    scoreFund: null,
  };

  const loading = $('#loadingCard');
  const main = $('#resultsMain');

  // ---------------------------------------------------------------- start
  async function start() {
    try {
      const [meta, overview, funds] = await Promise.all([
        M.getMeta(),
        M.getOverview(),
        M.getAllFunds(),
      ]);

      state.meta = meta;
      state.overview = overview;
      state.funds = funds;
      state.fundMap = Object.fromEntries(funds.map((fund) => [fund.code, fund]));

      let recommendation = M.cachedRecommendation();
      if (!recommendation || !recommendation.backtest.history || !recommendation.projection.bands) {
        recommendation = await M.apiPost('/recommend', request);
      }
      state.recommendation = recommendation;

      renderAll();
      loading.hidden = true;
      main.hidden = false;
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      loading.innerHTML = `
        <span class="asterisk-pulse">✕</span>
        <h2>The plan could not be loaded</h2>
        <p class="sub">${M.esc(error.message)}</p>
        <div class="launch-actions">
          <a class="btn primary" href="quiz.html">Rebuild my profile →</a>
          <button class="btn" id="retryLoad" type="button">Try again</button>
        </div>
        <p class="note">The backend usually runs at <code>http://localhost:8000</code>.</p>`;
      $('#retryLoad').onclick = () => window.location.reload();
    }
  }

  function renderAll() {
    $('#builtOn').textContent = M.dateLabel(state.overview.built_at);
    renderSummary();
    renderOverview();
    renderAllocation();
    renderPerformance();
    renderProjection();
    renderScoring();
    renderUniverse();
    renderMethod();
    setupSectionNav();
  }

  // ---------------------------------------------------------------- shared
  function kpi(label, value, note, tone = '') {
    return `
      <div class="kpi ${tone}">
        <span>${label}</span>
        <b>${value}</b>
        <small>${note || ''}</small>
      </div>`;
  }

  function weightedQuality() {
    const rec = state.recommendation;
    const total = rec.allocations.reduce((sum, fund) => sum + fund.weight, 0) || 1;
    return (
      rec.allocations.reduce((sum, fund) => sum + (fund.score || 0) * fund.weight, 0) /
      total
    );
  }

  function actualCategoryMix() {
    const mix = {};
    for (const fund of state.recommendation.allocations) {
      mix[fund.category] = (mix[fund.category] || 0) + fund.weight;
    }
    return mix;
  }

  // ---------------------------------------------------------------- summary
  function renderSummary() {
    const rec = state.recommendation;
    const appetite = M.APPETITES[profile.appetite] || M.APPETITES.balanced;

    $('#sumAge').textContent = profile.age;
    $('#sumHorizon').textContent = profile.horizon;
    $('#sumSip').textContent = M.inr(profile.sip);
    $('#sumRisk').textContent = `${appetite.label} · ${rec.inputs.risk_tolerance}/5`;
    $('#builtOn').textContent = M.dateLabel(state.overview.built_at);
  }

  // ---------------------------------------------------------------- overview
  function renderOverview() {
    const rec = state.recommendation;
    const stats = state.overview.stats || {};
    const equity = rec.equity_target;
    const equityAmount = (rec.inputs.amount * equity) / 100;
    const profileName = M.planLabel(equity);

    $('#planKpis').innerHTML = [
      kpi('Equity target', M.pct(equity / 100), `${profileName} suitability profile`, 'accent'),
      kpi('Debt / cash gap', M.pct(rec.debt_gap / 100), 'Outside this equity universe'),
      kpi('Monthly equity plan', M.inr(equityAmount), `${M.pct(equity / 100)} of ${M.inr(rec.inputs.amount)} SIP`),
      kpi('Funds selected', rec.allocations.length, `${stats.selected || 0} funds in the quality pool`),
      kpi('Weighted quality score', M.scoreText(weightedQuality()), 'Average score, weighted by allocation'),
      kpi('5-year portfolio CAGR', M.pct(rec.backtest.portfolio.cagr), 'Historical replay, not a forecast'),
    ].join('');

    $('#profileLabel').textContent = profileName;
    $('#planRange').textContent = `${rec.inputs.horizon_years}Y horizon`;

    const firstDate = rec.backtest.history[0]?.date;
    const lastDate = rec.backtest.history[rec.backtest.history.length - 1]?.date;

    $('#pipeline').innerHTML = `
      <li>
        <b>1 · Screen</b>
        <span>${(stats.schemes_total || 0).toLocaleString('en-IN')} schemes →
          ${(stats.direct_growth || 0).toLocaleString('en-IN')} Direct-Growth candidates →
          ${stats.quality || 0} funds with enough live history.</span>
      </li>
      <li>
        <b>2 · Score</b>
        <span>Nine metrics are percentile-ranked inside five categories. The top
          ${state.meta.top_n} funds form the candidate pool.</span>
      </li>
      <li>
        <b>3 · Fit the investor</b>
        <span>Age ${rec.inputs.age}, horizon ${rec.inputs.horizon_years} years and risk
          ${rec.inputs.risk_tolerance}/5 set a ${M.pct(equity / 100)} equity target and the
          category mix.</span>
      </li>
      <li>
        <b>4 · Optimize and test</b>
        <span>The optimizer chose ${rec.allocations.length} funds, then the sleeve was replayed
          from ${M.dateLabel(firstDate)} to ${M.dateLabel(lastDate)} and simulated
          ${(rec.projection.months / 12).toFixed(0)} years forward.</span>
      </li>`;

    $('#pipelineNote').textContent =
      `Debt / cash gap: ${M.inr(rec.inputs.amount * rec.debt_gap / 100)} per month. ` +
      'It is not a recommendation to hold cash; it is the part this equity data cannot fill.';

    const mix = actualCategoryMix();
    const maxValue = Math.max(
      1,
      ...state.meta.categories.map((category) =>
        Math.max((rec.category_targets[category] || 0) * 100, (mix[category] || 0) * 100)
      )
    );

    $('#categoryMix').innerHTML = state.meta.categories
      .filter((category) => (rec.category_targets[category] || 0) > 0 || (mix[category] || 0) > 0)
      .map((category) => {
        const target = (rec.category_targets[category] || 0) * 100;
        const actual = (mix[category] || 0) * 100;
        return `
          <div class="mix-row">
            <div class="mix-head">
              <span><i class="dot" style="background:${M.categoryColor(category)}"></i>
                ${M.categoryLabel(category)}</span>
              <span>Target <b>${target.toFixed(1)}%</b> · Optimizer <b>${actual.toFixed(1)}%</b></span>
            </div>
            <div class="mix-track">
              <i class="mix-target" style="width:${(target / maxValue) * 100}%"></i>
              <i class="mix-actual" style="width:${(actual / maxValue) * 100}%"></i>
            </div>
          </div>`;
      })
      .join('');

    renderWarnings();
  }

  function renderWarnings() {
    const rec = state.recommendation;
    const panel = $('#warningPanel');

    if (rec.warnings?.length) {
      panel.innerHTML = `
        <div class="callout warn">
          <b>Suitability notes for this run</b>
          <ul>${rec.warnings.map((warning) => `<li>${M.esc(warning)}</li>`).join('')}</ul>
          <p class="note">These are warnings, not defects. The plan still follows your inputs.</p>
        </div>`;
    } else {
      panel.innerHTML = `
        <div class="callout ok">
          <b>No suitability warnings were raised</b>
          <p>The allocation stayed inside the model’s category, position and volatility limits.</p>
        </div>`;
    }
  }

  // ---------------------------------------------------------------- allocation
  function renderAllocation() {
    const rec = state.recommendation;
    const allocations = [...rec.allocations].sort((a, b) => b.weight - a.weight);
    const maxWeight = Math.max(...allocations.map((fund) => fund.weight), 0.01);

    $('#allocationCount').textContent = `${allocations.length} funds · ${M.pct(rec.equity_target / 100)} equity`;

    $('#weightList').innerHTML = allocations.map((fund) => `
      <button class="weight-row" type="button" data-code="${fund.code}">
        <span class="weight-name">
          ${M.esc(M.shortName(fund.name))}
          <small>${M.categoryLabel(fund.category)} · score ${M.scoreText(fund.score)}</small>
        </span>
        <span class="weight-track">
          <i style="width:${(fund.weight / maxWeight) * 100}%"></i>
        </span>
        <b>${M.pct(fund.weight)}</b>
      </button>`).join('');

    $$('#weightList .weight-row').forEach((row) => {
      row.onclick = () => openFundModal(Number(row.dataset.code));
    });

    const buckets = rec.buckets || [];
    $('#bucketSummary').innerHTML = buckets.map((bucket) => {
      const label =
        bucket.bucket === 'Equity funds' ? 'Equity funds' : 'Debt / cash gap';
      const tone = bucket.bucket === 'Equity funds' ? 'brand' : 'muted';
      return `
        <div class="bucket-row">
          <div class="bucket-head">
            <span>${label}</span>
            <b>${M.pct(bucket.share / 100)} · ${M.inr(bucket.amount)}</b>
          </div>
          <div class="bucket-track">
            <i class="${tone}" style="width:${bucket.share}%"></i>
          </div>
        </div>`;
    }).join('');

    const equityBucket = buckets.find((bucket) => bucket.bucket === 'Equity funds');
    const gapBucket = buckets.find((bucket) => bucket.bucket !== 'Equity funds');
    $('#bucketNote').textContent =
      `${M.inr(equityBucket?.amount || 0)} goes into equity funds each month; ` +
      `${M.inr(gapBucket?.amount || 0)} is the explicit debt / cash gap. ` +
      'The gap is outside the fund universe and is not an instruction to hold cash.';

    $('#allocationTable').innerHTML = `
      <thead>
        <tr>
          <th class="left">Fund</th>
          <th class="left">Category</th>
          <th>Weight</th>
          <th>Amount</th>
          <th>Score</th>
          <th>3Y CAGR</th>
          <th>Sharpe</th>
          <th>Max DD</th>
          <th class="left">Why it is here</th>
        </tr>
      </thead>
      <tbody>
        ${allocations.map((fund) => `
          <tr data-code="${fund.code}">
            <td class="left fname"><b>${M.esc(M.shortName(fund.name))}</b><span>${M.esc(fund.amc)}</span></td>
            <td class="left">${categoryChip(fund.category)}</td>
            <td>${M.pct(fund.weight)}</td>
            <td>${M.inr(fund.amount)}${rec.inputs.mode === 'sip' ? '<span class="unit">/mo</span>' : ''}</td>
            <td><span class="score-text">${M.scoreText(fund.score)}</span></td>
            <td>${M.pct(fund.cagr_3y)}</td>
            <td>${M.scoreText(fund.sharpe_3y, 2)}</td>
            <td>${M.pct(fund.max_drawdown)}</td>
            <td class="left why-cell">${M.esc(M.fundReason(fund, state.funds))}</td>
          </tr>`).join('')}
      </tbody>`;

    $$('#allocationTable tr[data-code]').forEach((row) => {
      row.onclick = () => openFundModal(Number(row.dataset.code));
    });
  }

  function categoryChip(category) {
    return `<span class="chip category-chip" style="--cat:${M.categoryColor(category)}">
      ${M.categoryLabel(category)}</span>`;
  }

  // ---------------------------------------------------------------- performance
  function renderPerformance() {
    const rec = state.recommendation;
    const backtest = rec.backtest;
    const history = backtest.history || [];

    $('#performanceKpis').innerHTML = [
      kpi('Portfolio CAGR', M.pct(backtest.portfolio.cagr), `Nifty 500 proxy ${M.pct(backtest.market.cagr)}`, 'accent'),
      kpi('Volatility', M.pct(backtest.portfolio.volatility), `Proxy ${M.pct(backtest.market.volatility)}`),
      kpi('Sharpe ratio', M.scoreText(backtest.portfolio.sharpe, 2), `Risk-free ${M.pct(state.meta.risk_free)}`),
      kpi('Maximum drawdown', M.pct(backtest.portfolio.max_drawdown), `Proxy ${M.pct(backtest.market.max_drawdown)}`),
      kpi('SIP XIRR', M.pct(backtest.sip_xirr), 'Money-weighted, five years'),
    ].join('');

    if (!history.length) {
      $('#perfWindow').textContent = 'No history';
      return;
    }

    $('#perfWindow').textContent =
      `${M.dateLabel(history[0].date)} – ${M.dateLabel(history[history.length - 1].date)}`;

    const points = history.map((point) => ({
      time: Date.parse(point.date),
      portfolio: point.portfolio,
      market: point.market,
    }));

    window.Charts.line($('#perfChart'), {
      height: 330,
      series: [
        {
          name: 'Portfolio',
          pts: points.map((point) => [point.time, point.portfolio]),
          color: 'var(--brand)',
          width: 2.4,
          vFmt: (value) => `₹${value.toFixed(2)}`,
        },
        {
          name: 'Nifty 500 proxy',
          pts: points.map((point) => [point.time, point.market]),
          color: '#94a3b8',
          dash: [5, 4],
          width: 1.8,
          vFmt: (value) => `₹${value.toFixed(2)}`,
        },
      ],
      yFmt: (value) => `₹${value.toFixed(2)}`,
    });

    const drawdown = (values) => {
      let peak = -Infinity;
      return values.map((value) => {
        peak = Math.max(peak, value);
        return peak > 0 ? value / peak - 1 : 0;
      });
    };

    const portfolioDrawdown = drawdown(points.map((point) => point.portfolio));
    const marketDrawdown = drawdown(points.map((point) => point.market));

    window.Charts.line($('#drawdownChart'), {
      height: 330,
      zeroLine: true,
      series: [
        {
          name: 'Portfolio',
          pts: points.map((point, index) => [point.time, portfolioDrawdown[index]]),
          color: 'var(--brand)',
          width: 2.2,
          vFmt: (value) => M.pct(value),
        },
        {
          name: 'Nifty 500 proxy',
          pts: points.map((point, index) => [point.time, marketDrawdown[index]]),
          color: '#94a3b8',
          dash: [5, 4],
          width: 1.6,
          vFmt: (value) => M.pct(value),
        },
      ],
      yFmt: (value) => M.pct(value),
    });
  }

  // ---------------------------------------------------------------- projection
  function renderProjection() {
    const projection = state.recommendation.projection;

    $('#projectionKpis').innerHTML = [
      kpi('Total invested', M.inr(projection.invested), `${projection.months} monthly SIPs`),
      kpi('Median outcome', M.inr(projection.median), 'Middle of 2,000 paths', 'accent'),
      kpi('Downside (5th percentile)', M.inr(projection.p5), 'Plan for this, not the median'),
      kpi('Upside (95th percentile)', M.inr(projection.p95), 'Better than 95% of paths'),
      kpi('Below contributions', M.pct(projection.prob_below_contributions), 'Probability of ending below invested'),
      kpi('Median max drawdown', M.pct(projection.median_max_drawdown), `Worst 5%: ${M.pct(projection.worst_5pct_drawdown)}`),
    ].join('');

    $('#projectionYears').textContent = `${(projection.months / 12).toFixed(0)} years`;
    $('#projectionNote').textContent =
      'The dark band is the 25th–75th percentile; the light band is the 5th–95th. ' +
      'The dashed line is money contributed. Returns are resampled from the last five years of ' +
      'portfolio monthly returns.';

    if (projection.bands?.length) {
      window.Charts.band($('#projectionChart'), {
        height: 360,
        bands: projection.bands,
        invested: projection.invested_path,
        xFmt: (month) => `${(month / 12).toFixed(1).replace('.0', '')}y`,
        yFmt: (value) => M.inrShort(value),
      });
    }
  }

  // ---------------------------------------------------------------- scoring
  function renderScoring() {
    const weights = state.meta.score_weights;
    const maxWeight = Math.max(...Object.values(weights), 0.01);

    $('#scoreWeights').innerHTML = Object.entries(weights).map(([metric, weight]) => `
      <div class="score-weight-row">
        <div class="score-weight-head">
          <span>${M.METRIC_LABELS[metric] || metric}</span>
          <b>${(weight * 100).toFixed(0)}%</b>
        </div>
        <div class="score-weight-track">
          <i style="width:${(weight / maxWeight) * 100}%"></i>
        </div>
      </div>`).join('');

    $('#scoreFormula').textContent =
      'Score = 100 × Σ(weight × category percentile) ÷ Σ(available weight). ' +
      'Missing metrics are removed from the denominator, not filled with zero.';

    const options = [...state.funds]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((fund) => `
        <option value="${fund.code}">
          ${M.esc(M.shortName(fund.name))} · score ${M.scoreText(fund.score)}
        </option>`)
      .join('');

    $('#scoreFundSelect').innerHTML = options;
    const defaultFund = state.recommendation.allocations[0]?.code || state.funds[0]?.code;
    $('#scoreFundSelect').value = defaultFund;
    $('#scoreFundSelect').onchange = () => loadScore(Number($('#scoreFundSelect').value));
    loadScore(defaultFund);
  }

  function metricValue(part) {
    if (part.value == null) return '—';
    const percentMetrics = new Set([
      'cagr_3y', 'cagr_5y', 'sip_xirr', 'consistency',
      'max_drawdown', 'momentum_12m',
    ]);
    return percentMetrics.has(part.metric) ? M.pct(part.value) : part.value.toFixed(2);
  }

  async function loadScore(code) {
    const summary = $('#scoreSummary');
    const partsBox = $('#scoreParts');
    summary.innerHTML = '<p class="muted-line">Loading score evidence…</p>';
    partsBox.innerHTML = '';

    try {
      const data = await M.getScore(code);
      const fund = state.fundMap[code];
      const categoryPeers = state.funds.filter((peer) => peer.category === fund.category);

      summary.innerHTML = `
        <div class="score-summary-grid">
          <div><span>Composite</span><b>${M.scoreText(data.score)}</b></div>
          <div><span>Category</span><b>${M.categoryLabel(data.category)}</b></div>
          <div><span>Pool rank</span><b>${data.rank ? '#' + data.rank : '—'}</b></div>
          <div><span>3Y CAGR</span><b>${M.pct(fund.cagr_3y)}</b></div>
          <div><span>Sharpe</span><b>${M.scoreText(fund.sharpe_3y, 2)}</b></div>
          <div><span>Max DD</span><b>${M.pct(fund.max_drawdown)}</b></div>
        </div>
        <p class="note">${M.esc(M.fundReason(fund, categoryPeers))}</p>`;

      $('#scoreMissing').textContent = data.missing.length
        ? `Unavailable: ${data.missing.join(', ')}. Weights were rescaled.`
        : 'All nine metrics were available.';

      partsBox.innerHTML = data.parts
        .filter((part) => part.percentile != null)
        .map((part) => `
          <div class="score-part">
            <div class="score-part-head">
              <span>${part.label}</span>
              <span>${M.pct(part.percentile, 0)} percentile · +${part.contribution.toFixed(1)} pts</span>
            </div>
            <div class="score-part-track">
              <i style="width:${part.percentile * 100}%"></i>
            </div>
            <small>Value ${metricValue(part)} · weight ${(part.weight * 100).toFixed(0)}%</small>
          </div>`)
        .join('');
    } catch (error) {
      summary.innerHTML = `<div class="callout bad"><b>Could not load the score</b><p>${M.esc(error.message)}</p></div>`;
    }
  }

  // ---------------------------------------------------------------- universe
  function renderUniverse() {
    const categories = ['all', ...state.meta.categories];
    $('#categoryFilter').innerHTML = categories
      .map((category) => `
        <option value="${category}">
          ${category === 'all' ? 'All categories' : M.categoryLabel(category)}
        </option>`)
      .join('');

    $('#fundSearch').oninput = (event) => {
      state.filters.query = event.target.value.trim().toLowerCase();
      state.filters.showAll = false;
      renderUniverseViews();
    };
    $('#categoryFilter').onchange = (event) => {
      state.filters.category = event.target.value;
      state.filters.showAll = false;
      renderUniverseViews();
    };
    $('#sortFilter').onchange = (event) => {
      state.filters.sort = event.target.value;
      state.filters.showAll = false;
      renderUniverseViews();
    };
    $('#poolOnly').onchange = (event) => {
      state.filters.poolOnly = event.target.checked;
      state.filters.showAll = false;
      renderUniverseViews();
    };

    renderUniverseViews();
  }

  function filteredFunds() {
    const filters = state.filters;
    return state.funds.filter((fund) => {
      if (filters.poolOnly && !fund.selected) return false;
      if (filters.category !== 'all' && fund.category !== filters.category) return false;
      if (filters.query) {
        const haystack = `${fund.name} ${fund.amc}`.toLowerCase();
        if (!haystack.includes(filters.query)) return false;
      }
      return true;
    });
  }

  function sortedFunds(funds) {
    const key = state.filters.sort;
    const ascending = key === 'vol_3y' || key === 'max_drawdown';
    return [...funds].sort((a, b) => {
      const left = a[key];
      const right = b[key];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return (left - right) * (ascending ? 1 : -1);
    });
  }

  function renderUniverseViews() {
    const allFunds = sortedFunds(filteredFunds());
    const visibleLimit = state.filters.showAll ? allFunds.length : 40;
    const funds = allFunds.slice(0, visibleLimit);
    $('#universeCount').textContent = `${allFunds.length} funds`;

    const table = $('#fundTable');
    table.innerHTML = `
      <thead>
        <tr>
          <th class="left">Fund</th>
          <th class="left">Category</th>
          <th>Score</th>
          <th>3Y CAGR</th>
          <th>5Y CAGR</th>
          <th>SIP XIRR</th>
          <th>Volatility</th>
          <th>Sharpe</th>
          <th>Max DD</th>
          <th>History</th>
        </tr>
      </thead>
      <tbody>
        ${funds.map((fund) => `
          <tr data-code="${fund.code}">
            <td class="left fname"><b>${M.esc(M.shortName(fund.name))}</b><span>${M.esc(fund.amc)}</span></td>
            <td class="left">${categoryChip(fund.category)}</td>
            <td>
              <div class="score-cell">
                <b>${M.scoreText(fund.score)}</b>
                <i><em style="width:${fund.score || 0}%"></em></i>
              </div>
            </td>
            <td>${M.pct(fund.cagr_3y)}</td>
            <td>${M.pct(fund.cagr_5y)}</td>
            <td>${M.pct(fund.sip_xirr)}</td>
            <td>${M.pct(fund.vol_3y)}</td>
            <td>${M.scoreText(fund.sharpe_3y, 2)}</td>
            <td>${M.pct(fund.max_drawdown)}</td>
            <td>${fund.years ? fund.years.toFixed(1) + 'y' : '—'}</td>
          </tr>`).join('')}
      </tbody>`;

    $$('#fundTable tr[data-code]').forEach((row) => {
      row.onclick = () => openFundModal(Number(row.dataset.code));
    });

    const more = $('#universeMore');
    if (allFunds.length > 40) {
      more.innerHTML = `
        <button class="btn small" type="button" id="toggleUniverseRows">
          ${state.filters.showAll ? 'Show first 40 only' : `Show all ${allFunds.length} funds`}
        </button>
        <span class="note-inline">Showing ${funds.length} of ${allFunds.length}</span>`;
      $('#toggleUniverseRows').onclick = () => {
        state.filters.showAll = !state.filters.showAll;
        renderUniverseViews();
      };
    } else {
      more.innerHTML = '';
    }

    const points = allFunds
      .filter((fund) => fund.vol_3y != null && fund.cagr_3y != null)
      .map((fund) => ({
        x: fund.vol_3y * 100,
        y: fund.cagr_3y * 100,
        color: M.categoryColor(fund.category),
        fund,
      }));

    window.Charts.scatter($('#scatter'), {
      height: 380,
      xLabel: 'Volatility (annualised, 3Y) %',
      yLabel: 'CAGR 3Y %',
      points,
      xFmt: (value) => `${Math.round(value)}%`,
      yFmt: (value) => `${Math.round(value)}%`,
      tipFmt: (point) => `
        <b>${M.esc(M.shortName(point.fund.name))}</b><br>
        ${M.categoryLabel(point.fund.category)} · score ${M.scoreText(point.fund.score)}<br>
        Vol ${M.pct(point.fund.vol_3y)} · CAGR3 ${M.pct(point.fund.cagr_3y)}<br>
        <span style="opacity:.7">Click for details</span>`,
      onPick: (point) => openFundModal(point.fund.code),
    });
  }

  // ---------------------------------------------------------------- method
  function renderMethod() {
    const meta = state.meta;
    const rec = state.recommendation;
    const stats = state.overview.stats || {};

    const cards = [
      ['Universe', 'mfapi.in → AMFI NAV history. Direct-Growth schemes only, classified into large, mid, small, flexi and broad-market index. At least 1.5 years and 300 daily NAVs are required.'],
      ['Score', 'Nine metrics are converted to category percentiles. The weighted average is rescaled when a metric is missing. The result is 0–100 within the category, not a return forecast.'],
      ['Suitability', 'Age, horizon and risk tolerance set an equity target with hard caps for short horizons. A short horizon blocks mid and small caps entirely.'],
      ['Optimizer', 'Up to two funds per category enter a long-only mean-variance optimizer with 3–30% position bounds, category bands and a risk-based volatility budget.'],
      ['Performance', 'Monthly portfolio returns are replayed over the last five years against an equal-weight index-fund composite. XIRR is money-weighted, not a simple average.'],
      ['Monte Carlo', 'Two thousand paths resample the last five years of monthly portfolio returns. The chart shows 5th–95th and 25th–75th percentile ranges plus total contributions.'],
      ['ML gate', 'The notebook tested a Ridge model against next-year rank IC. It did not clear the threshold, so this app keeps a transparent rule-based score instead of blending a noisy model.'],
    ];

    $('#methodGrid').innerHTML = cards.map(([title, body], index) => `
      <article class="mcard">
        <div class="step">${String(index + 1).padStart(2, '0')} · ${title}</div>
        <p>${body}</p>
      </article>`).join('');

    $('#settingsTable').innerHTML = `
      <tr><td>Equity categories</td><td>${meta.categories.map(M.categoryLabel).join(', ')}</td></tr>
      <tr><td>Minimum history</td><td>${meta.min_years} years · ${meta.min_obs} daily NAVs</td></tr>
      <tr><td>Quality pool</td><td>Top ${meta.top_n} · ${meta.base_quota} per category minimum</td></tr>
      <tr><td>Risk-free rate</td><td>${M.pct(meta.risk_free)}</td></tr>
      <tr><td>Profile</td><td>Age ${rec.inputs.age} · horizon ${rec.inputs.horizon_years}y · risk ${rec.inputs.risk_tolerance}/5</td></tr>
      <tr><td>Plan</td><td>${M.inr(rec.inputs.amount)} ${rec.inputs.mode === 'sip' ? 'per month' : 'one-time'}</td></tr>
      <tr><td>Score metrics</td><td>${Object.keys(meta.score_weights).length} rule-based inputs</td></tr>`;

    $('#methodStats').innerHTML = [
      `<div class="stat"><b>${state.overview.funds}</b><span>funds with metrics</span></div>`,
      `<div class="stat"><b>${state.overview.selected}</b><span>funds in the quality pool</span></div>`,
      `<div class="stat"><b>${(stats.nav_points || 0).toLocaleString('en-IN')}</b><span>daily NAV observations</span></div>`,
      `<div class="stat"><b>${M.dateLabel(state.overview.built_at)}</b><span>data built</span></div>`,
    ].join('');

    $('#disclaimer').textContent =
      `${meta.disclaimer} The debt / cash gap is outside this equity universe. ` +
      'This is an educational research tool, not a SEBI-registered advisory service.';
  }

  // ---------------------------------------------------------------- modal
  let modalFund = null;

  async function openFundModal(code) {
    const fund = state.fundMap[code];
    if (!fund) return;

    modalFund = fund;
    const modal = $('#fundModal');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    $('#mName').textContent = M.shortName(fund.name);
    $('#mSub').textContent = `${fund.amc} · ${fund.category ? M.categoryLabel(fund.category) : ''}`;
    $('#mChips').innerHTML = `
      ${categoryChip(fund.category)}
      <span class="chip">Score ${M.scoreText(fund.score)}</span>
      <span class="chip">${fund.rank ? '#' + fund.rank + ' in pool' : 'Outside pool'}</span>
      <span class="chip">${fund.years ? fund.years.toFixed(1) + ' years' : '—'}</span>`;
    $('#mLoading').hidden = false;
    $('#mMetrics').innerHTML = '';
    $('#mReason').innerHTML = '';
    $('#mScore').innerHTML = '';

    $('#mMetrics').innerHTML = [
      ['CAGR 1Y', M.pct(fund.cagr_1y)],
      ['CAGR 3Y', M.pct(fund.cagr_3y)],
      ['CAGR 5Y', M.pct(fund.cagr_5y)],
      ['Volatility 3Y', M.pct(fund.vol_3y)],
      ['Sharpe 3Y', M.scoreText(fund.sharpe_3y, 2)],
      ['Max drawdown', M.pct(fund.max_drawdown)],
      ['SIP XIRR', M.pct(fund.sip_xirr)],
      ['Consistency', M.pct(fund.consistency)],
    ].map(([label, value]) => `
      <div class="metric"><b>${value}</b><span>${label}</span></div>`).join('');

    $('#mReason').innerHTML = `
      <b>Why it stands out</b>
      <p>${M.esc(M.fundReason(fund, state.funds))}</p>`;

    try {
      const [nav, score] = await Promise.all([
        M.getNav(code),
        M.getScore(code),
      ]);

      if (nav.points?.length) {
        window.Charts.line($('#mNavChart'), {
          height: 260,
          series: [{
            name: 'NAV',
            pts: nav.points.map((point) => [Date.parse(point.date), point.nav]),
            color: M.categoryColor(fund.category),
            width: 2,
            vFmt: (value) => `₹${value.toFixed(2)}`,
          }],
          yFmt: (value) => `₹${value.toFixed(0)}`,
        });
      }

      $('#mScore').innerHTML = `
        <h3 class="modal-subhead">Score evidence</h3>
        <div class="score-parts">
          ${score.parts.filter((part) => part.percentile != null).map((part) => `
            <div class="score-part">
              <div class="score-part-head">
                <span>${part.label}</span>
                <span>${M.pct(part.percentile, 0)} percentile · +${part.contribution.toFixed(1)} pts</span>
              </div>
              <div class="score-part-track"><i style="width:${part.percentile * 100}%"></i></div>
            </div>`).join('')}
        </div>`;
      $('#mLoading').hidden = true;
    } catch (error) {
      $('#mLoading').hidden = false;
      $('#mLoading').innerHTML = `<span class="warn-text">${M.esc(error.message)}</span>`;
    }
  }

  function closeModal() {
    $('#fundModal').classList.remove('open');
    document.body.style.overflow = '';
    modalFund = null;
  }

  $('#mClose').onclick = closeModal;
  $('#fundModal').onclick = (event) => {
    if (event.target.id === 'fundModal') closeModal();
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });

  // ---------------------------------------------------------------- section nav
  function setupSectionNav() {
    const links = $$('.section-nav a');
    const sections = $$('.dash-section');

    const highlight = () => {
      let current = sections[0]?.id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 160) current = section.id;
      }
      links.forEach((link) => {
        link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
      });
    };

    document.addEventListener('scroll', highlight, { passive: true });
    highlight();
  }

  start();
})();
