/* ============================================================
   SahiMF — shared helpers
   API access, formatting, profile storage and small utilities.
   Every page loads this before its own script.
   ============================================================ */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const el = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  };

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    }[char]));

  // ------------------------------------------------------------- API
  // When the backend serves the UI these are same-origin requests.
  // The small static dev server runs on 8788, so it points at port 8000.
  const API_BASE =
    window.SAHIMF_API_BASE ||
    (window.location.port === '8788' ? 'http://localhost:8000' : '');

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(API_BASE + path, options);
    } catch (error) {
      throw new Error(
        'Cannot reach the API. Start the backend with: cd backend && ' +
          'python -m uvicorn app.main:app --reload --port 8000'
      );
    }

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const detail = data?.detail;
      const message =
        typeof detail === 'string'
          ? detail
          : detail?.message || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return response.json();
  }

  const apiGet = (path) => request(path);
  const apiPost = (path, body) =>
    request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  // Cache list/meta calls for the current page load.
  let metaPromise;
  let overviewPromise;
  let fundsPromise;

  const getMeta = () => {
    if (!metaPromise) {
      metaPromise = apiGet('/meta').catch((error) => {
        metaPromise = null;
        throw error;
      });
    }
    return metaPromise;
  };

  const getOverview = () => {
    if (!overviewPromise) {
      overviewPromise = apiGet('/overview').catch((error) => {
        overviewPromise = null;
        throw error;
      });
    }
    return overviewPromise;
  };

  const getHealth = () => apiGet('/health');

  async function getAllFunds() {
    if (fundsPromise) return fundsPromise;

    fundsPromise = (async () => {
      const pageSize = 500;
      const funds = [];
      let offset = 0;

      while (true) {
        const page = await apiGet(
          `/funds?selected_only=false&limit=${pageSize}&offset=${offset}`
        );
        funds.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      return funds;
    })().catch((error) => {
      fundsPromise = null;
      throw error;
    });

    return fundsPromise;
  }

  const scoreCache = new Map();
  function getScore(code) {
    if (!scoreCache.has(code)) {
      scoreCache.set(code, apiGet(`/funds/${code}/score`));
    }
    return scoreCache.get(code);
  }

  const navCache = new Map();
  function getNav(code) {
    if (!navCache.has(code)) {
      navCache.set(code, apiGet(`/funds/${code}/nav?limit=4000`));
    }
    return navCache.get(code);
  }

  // ------------------------------------------------------------- labels
  const CATEGORY_LABELS = {
    large: 'Large cap',
    mid: 'Mid cap',
    small: 'Small cap',
    flexi: 'Flexi cap',
    index: 'Index',
  };

  const CATEGORY_COLORS = {
    large: '#60a5fa',
    mid: '#a78bfa',
    small: '#f87171',
    flexi: '#34d399',
    index: '#fbbf24',
  };

  const METRIC_LABELS = {
    cagr_3y: '3-year CAGR',
    cagr_5y: '5-year CAGR',
    sip_xirr: 'SIP XIRR',
    sharpe_3y: '3-year Sharpe',
    sortino_3y: '3-year Sortino',
    calmar_3y: '3-year Calmar',
    consistency: '1-year consistency',
    max_drawdown: 'Maximum drawdown',
    momentum_12m: '12-month momentum',
  };

  const METRIC_HELP = {
    cagr_3y: 'Annualised return over the last 36 months.',
    cagr_5y: 'Annualised return over the last 60 months, when available.',
    sip_xirr: 'Money-weighted return of a monthly SIP over five years.',
    sharpe_3y: 'Excess return per unit of total volatility.',
    sortino_3y: 'Excess return per unit of downside volatility.',
    calmar_3y: '3-year CAGR divided by the absolute maximum drawdown.',
    consistency: 'Share of rolling 12-month windows that ended positive.',
    max_drawdown: 'Worst peak-to-trough fall in daily NAV.',
    momentum_12m: 'Trailing 12-month return.',
  };

  const APPETITES = {
    conservative: {
      risk: 2,
      label: 'Conservative',
      summary: 'Protect capital first; accept lower long-term growth.',
    },
    balanced: {
      risk: 3,
      label: 'Balanced',
      summary: 'Steady growth with moderate temporary falls.',
    },
    aggressive: {
      risk: 5,
      label: 'Aggressive',
      summary: 'Maximise growth; can hold through deep corrections.',
    },
    unsure: {
      risk: 3,
      label: 'Not sure',
      summary: 'Use a moderate risk setting and let the other answers lead.',
    },
  };

  const RISK_LABELS = {
    1: 'Very low',
    2: 'Low',
    3: 'Moderate',
    4: 'High',
    5: 'Very high',
  };

  // ------------------------------------------------------------- profile
  const PROFILE_KEY = 'sahimf.profile';
  const RESULT_KEY = 'sahimf.recommendation';
  const DEFAULT_PROFILE = { age: 30, horizon: 15, sip: 10000, appetite: 'balanced' };

  function getProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY));
      return saved ? { ...DEFAULT_PROFILE, ...saved } : null;
    } catch {
      return null;
    }
  }

  function saveProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    sessionStorage.removeItem(RESULT_KEY);
  }

  function recommendationRequest(profile) {
    const appetite = APPETITES[profile.appetite] || APPETITES.balanced;
    return {
      age: profile.age,
      horizon_years: profile.horizon,
      risk_tolerance: appetite.risk,
      mode: 'sip',
      amount: profile.sip,
    };
  }

  function saveRecommendation(payload) {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(payload));
  }

  function cachedRecommendation() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(RESULT_KEY));
      if (!saved) return null;
      const profile = getProfile();
      if (!profile) return null;
      const request = recommendationRequest(profile);
      if (JSON.stringify(saved.request) !== JSON.stringify(request)) return null;
      return saved.result;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------- format
  const pct = (value, decimals = 1) =>
    value == null || Number.isNaN(value)
      ? '—'
      : `${(value * 100).toFixed(decimals)}%`;

  const scoreText = (value, decimals = 1) =>
    value == null || Number.isNaN(value) ? '—' : value.toFixed(decimals);

  const inr = (value) =>
    value == null
      ? '—'
      : `₹${Math.round(value).toLocaleString('en-IN')}`;

  const inrShort = (value) => {
    if (value == null) return '—';
    const absolute = Math.abs(value);
    if (absolute >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
    if (absolute >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
    return inr(value);
  };

  const dateLabel = (value) =>
    value
      ? new Date(value).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—';

  const ordinal = (number) => {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const value = number % 100;
    return number + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
  };

  const shortName = (name) =>
    String(name || '')
      .replace(' - Direct Plan - Growth Option', '')
      .replace(' - Direct Plan - Growth', '')
      .replace(' Direct Plan - Growth Option', '')
      .replace(' Direct Plan - Growth', '')
      .trim();

  const categoryLabel = (category) =>
    CATEGORY_LABELS[category] || category;

  const categoryColor = (category) =>
    CATEGORY_COLORS[category] || '#818cf8';

  const planLabel = (equityTarget) => {
    if (equityTarget < 45) return 'Conservative';
    if (equityTarget < 70) return 'Moderate';
    return 'Aggressive';
  };

  function percentileRank(value, values) {
    const clean = values.filter((item) => item != null).sort((a, b) => a - b);
    if (value == null || !clean.length) return 0;
    const index = clean.findIndex((item) => item >= value);
    return (index < 0 ? clean.length : index + 1) / clean.length;
  }

  // A short, data-backed reason for a fund within its own category.
  function fundReason(fund, peers) {
    const categoryPeers = peers.filter(
      (peer) => peer.category === fund.category && peer.code !== fund.code
    );
    const reasons = [];

    const add = (condition, text) => {
      if (condition) reasons.push(text);
    };

    const cagrRank = percentileRank(
      fund.cagr_3y,
      categoryPeers.map((peer) => peer.cagr_3y)
    );
    const sharpeRank = percentileRank(
      fund.sharpe_3y,
      categoryPeers.map((peer) => peer.sharpe_3y)
    );
    const drawdownRank = percentileRank(
      fund.max_drawdown,
      categoryPeers.map((peer) => peer.max_drawdown)
    );
    const sipRank = percentileRank(
      fund.sip_xirr,
      categoryPeers.map((peer) => peer.sip_xirr)
    );

    add(
      cagrRank >= 0.8,
      `Top ${Math.max(5, Math.round((1 - cagrRank) * 100))}% 3Y return in ${
        categoryLabel(fund.category)
      } (${pct(fund.cagr_3y)} p.a.)`
    );
    add(
      sharpeRank >= 0.8,
      `Strong risk-adjusted return (Sharpe ${scoreText(fund.sharpe_3y, 2)})`
    );
    add(
      drawdownRank >= 0.8,
      `Relatively shallow worst fall (${pct(fund.max_drawdown)})`
    );
    add(
      sipRank >= 0.8,
      `Top ${Math.max(5, Math.round((1 - sipRank) * 100))}% SIP experience (${pct(
        fund.sip_xirr
      )} XIRR)`
    );

    return (
      reasons.slice(0, 2).join(' · ') ||
      `Balanced metrics within the ${categoryLabel(fund.category)} category`
    );
  }

  // ------------------------------------------------------------- toast
  let toastTimer = null;
  function toast(message) {
    let node = $('#toast');
    if (!node) {
      node = el('div');
      node.id = 'toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3400);
  }

  function showError(container, error) {
    if (!container) return;
    container.hidden = false;
    container.innerHTML = `
      <div class="callout bad">
        <b>Could not load data</b>
        <p>${esc(error.message || error)}</p>
      </div>`;
  }

  // ------------------------------------------------------------- nav
  function markNav() {
    const page = document.body.dataset.page;
    $$('.topnav a[data-nav]').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === page);
    });
  }
  markNav();

  window.SahiMF = {
    $, $$, el, esc, toast, showError,
    apiGet, apiPost,
    getMeta, getOverview, getHealth, getAllFunds, getScore, getNav,
    CATEGORY_LABELS, CATEGORY_COLORS, CATEGORY_ORDER: ['large', 'mid', 'small', 'flexi', 'index'],
    METRIC_LABELS, METRIC_HELP, APPETITES, RISK_LABELS,
    getProfile, saveProfile, recommendationRequest, saveRecommendation, cachedRecommendation,
    DEFAULT_PROFILE,
    pct, scoreText, inr, inrShort, dateLabel, ordinal, shortName,
    categoryLabel, categoryColor, planLabel, percentileRank, fundReason,
  };
})();
