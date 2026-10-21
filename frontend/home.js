/* ============================================================
   SahiMF — overview page
   Loads live universe counts from the FastAPI backend.
   ============================================================ */
(() => {
  const M = window.SahiMF;
  if (!M) return;

  const $ = M.$;
  const status = $('#dataStatus');

  if (M.getProfile()) {
    $('#ctaPrimary').href = 'results.html';
    $('#ctaPrimary').textContent = 'View my plan →';
    $('#ctaSecondary').textContent = 'Retake the quiz →';
  }

  $('#btnHomeDemo').onclick = () => {
    M.saveProfile({ age: 52, horizon: 3, sip: 25000, appetite: 'conservative' });
    window.location.href = 'results.html';
  };

  function render(overview, meta) {
    const stats = overview.stats || {};
    $('#statFunds').textContent = overview.funds.toLocaleString('en-IN');
    $('#statPool').textContent = overview.selected.toLocaleString('en-IN');
    $('#statNav').textContent = (stats.nav_points || 0).toLocaleString('en-IN');
    $('#statCategories').textContent = overview.categories.length;
    $('#builtOn').textContent = M.dateLabel(overview.built_at);
    $('#pipelineDate').textContent = `Last NAV · ${stats.last_nav_date || '—'}`;

    $('#pipeCandidates').textContent =
      `${(stats.schemes_total || 0).toLocaleString('en-IN')} schemes → ` +
      `${(stats.direct_growth || 0).toLocaleString('en-IN')} Direct-Growth candidates.`;
    $('#pipeFunds').textContent =
      `${overview.funds} funds classified into five equity categories.`;
    $('#pipePool').textContent =
      `${overview.selected} funds kept for the recommendation pool.`;

    const counts = $('#categoryCounts');
    counts.innerHTML = '';

    const largest = Math.max(
      ...overview.categories.map((category) =>
        Math.max(overview.category_counts[category] || 0, 1)
      )
    );

    for (const category of overview.categories) {
      const universe = overview.category_counts[category] || 0;
      const pool = overview.top_category_counts[category] || 0;
      const row = M.el('div', 'count-row');
      row.innerHTML = `
        <span class="count-label">${M.categoryLabel(category)}</span>
        <span class="count-bars">
          <i class="count-bar muted" style="width:${(universe / largest) * 100}%"></i>
          <i class="count-bar brand" style="width:${(pool / largest) * 100}%"></i>
        </span>
        <span class="count-values">${universe} <b>→ ${pool}</b></span>`;
      counts.appendChild(row);
    }

    if (overview.status === 'ready') {
      status.className = 'hero-status reveal';
      status.innerHTML =
        `<span class="status-dot ok"></span> API connected · data built ${M.dateLabel(
          overview.built_at
        )}`;
    } else {
      status.className = 'hero-status reveal';
      status.innerHTML = `<span class="status-dot warn"></span> API status: ${overview.status}`;
    }

    // Expose the metadata for anyone inspecting the page in dev tools.
    window.SahiMF.meta = meta;
  }

  async function load() {
    try {
      const [overview, meta] = await Promise.all([M.getOverview(), M.getMeta()]);
      render(overview, meta);
    } catch (error) {
      status.className = 'hero-status reveal';
      status.innerHTML = `<span class="status-dot bad"></span> Backend unavailable`;
      M.showError($('#categoryCounts'), error);
      $('#categoryCounts').innerHTML = `
        <div class="callout bad">
          <b>The UI is ready, the API is not</b>
          <p>${M.esc(error.message)}</p>
          <p class="note">Run <code>cd backend && python -m uvicorn app.main:app --reload --port 8000</code>
            then open <code>http://localhost:8000</code>.</p>
        </div>`;
    }
  }

  load();
})();
