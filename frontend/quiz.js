/* ============================================================
   SahiMF — quiz page
   Collects four inputs, calls POST /recommend, then hands the
   saved profile and result to results.html.
   ============================================================ */
(() => {
  const M = window.SahiMF;
  if (!M) return;

  const $ = M.$;
  const $$ = M.$$;

  const profile = { ...M.DEFAULT_PROFILE, ...(M.getProfile() || {}) };
  const controls = { age: $('#qAge'), horizon: $('#qHorizon') };
  const topics = ['', 'Investor age', 'Investment horizon', 'Investment amount', 'Risk tolerance'];

  let amountInput;
  let step = 1;
  let busy = false;

  // Initialize AmountInput component
  amountInput = new M.AmountInput('#amountInputRoot', {
    defaultMode: profile.mode || 'lumpsum',
    initialAmount: profile.amount != null ? profile.amount : 100000,
    onModeChange: (newMode, cfg) => {
      profile.mode = newMode;
      const title = $('#amountScreenTitle');
      const sub = $('#amountScreenSub');
      if (title) title.textContent = cfg.label;
      if (sub) sub.textContent = cfg.helper;
    },
    onAmountChange: (newAmount, mode) => {
      profile.amount = newAmount;
      profile.mode = mode;
    },
    onValidityChange: (isValid, newAmount, mode) => {
      profile.amount = newAmount;
      profile.mode = mode;
      const next3 = $('#btnNext3');
      if (next3) next3.disabled = !isValid;
    },
  });

  // Set initial title and subtitle
  if (amountInput) {
    const cfg = M.MODE_CONFIG[amountInput.getMode()];
    if ($('#amountScreenTitle')) $('#amountScreenTitle').textContent = cfg.label;
    if ($('#amountScreenSub')) $('#amountScreenSub').textContent = cfg.helper;
  }

  // ---------------------------------------------------------------- steps
  function setStep(next, direction = 'forward') {
    if (next < 1 || next > 4) return;
    if (next === 4 && (!amountInput || !amountInput.isValid())) {
      if (amountInput) amountInput.validateAndUpdate();
      return;
    }
    step = next;
    $('#quizStepBadge').textContent = `Question ${next} of 4`;
    $('#quizTopicTitle').textContent = topics[next];
    $('#quizProgressBar').style.width = `${next * 25}%`;

    $$('.quiz-screen').forEach((screen) => {
      const current = Number(screen.dataset.step);
      screen.classList.remove('active', 'slide-in-right', 'slide-in-left');
      if (current === next) {
        screen.classList.add('active', direction === 'forward' ? 'slide-in-right' : 'slide-in-left');
      }
    });
  }

  $$('.quiz-btn-next').forEach((button) => {
    button.onclick = () => setStep(Number(button.dataset.next), 'forward');
  });
  $$('.quiz-btn-prev').forEach((button) => {
    button.onclick = () => setStep(Number(button.dataset.prev), 'backward');
  });

  // ---------------------------------------------------------------- sync
  function sync() {
    controls.age.value = profile.age;
    controls.horizon.value = profile.horizon;

    $('#ageVal').textContent = profile.age;
    $('#horVal').textContent = profile.horizon;

    $$('.radiocards input').forEach((radio) => {
      radio.checked = radio.value === profile.appetite;
    });

    $$(`.quiz-presets[data-for="qAge"] .preset-pill`).forEach((pill) => {
      pill.classList.toggle('active', Number(pill.dataset.val) === profile.age);
    });
    $$(`.quiz-presets[data-for="qHorizon"] .preset-pill`).forEach((pill) => {
      pill.classList.toggle('active', Number(pill.dataset.val) === profile.horizon);
    });

    const retireYears = Math.max(1, 65 - profile.age);
    const hint = $('#horizonRetireHint');
    if (profile.horizon > retireYears) {
      hint.innerHTML = `<span class="warn-text">⚠ At ${profile.age}, the model caps the effective horizon at ${retireYears} years (65 − age).</span>`;
    } else {
      hint.textContent = `Horizon is capped by years left to retirement (65 − ${profile.age} = ${retireYears} yrs).`;
    }
  }

  controls.age.oninput = () => {
    profile.age = Number(controls.age.value);
    sync();
  };
  controls.horizon.oninput = () => {
    profile.horizon = Number(controls.horizon.value);
    sync();
  };

  $$('.radiocards input').forEach((radio) => {
    radio.onchange = () => {
      profile.appetite = radio.value;
      sync();
    };
  });

  $$('.quiz-presets[data-for="qAge"] .preset-pill, .quiz-presets[data-for="qHorizon"] .preset-pill').forEach((pill) => {
    pill.onclick = () => {
      const target = pill.closest('.quiz-presets').dataset.for;
      const value = Number(pill.dataset.val);
      if (target === 'qAge') profile.age = value;
      if (target === 'qHorizon') profile.horizon = value;
      sync();
    };
  });

  sync();

  // ---------------------------------------------------------------- analyzing
  function setAnalyzingStep(active) {
    ['as1', 'as2', 'as3'].forEach((id, index) => {
      const node = $(`#${id}`);
      node.className = `astep ${index < active ? 'done' : index === active ? 'active' : ''}`;
      node.querySelector('.step-icon').textContent =
        index < active ? '✓' : index === active ? '◈' : '○';
    });
  }

  function showAnalyzing() {
    $$('.quiz-screen').forEach((screen) => screen.classList.remove('active'));
    $('#quizStepBadge').textContent = 'Analyzing…';
    $('#quizTopicTitle').textContent = 'Crunching your plan';
    $('#quizProgressBar').style.width = '100%';

    const card = $('#quizAnalyzing');
    card.hidden = false;
    card.classList.add('reveal');

    $('#quizError').hidden = true;
    setAnalyzingStep(0);

    $('#analyzingTitle').textContent = 'Building your suitability target…';
    $('#analyzingSub').textContent = 'Age, horizon and SIP capacity set the equity share.';

    setTimeout(() => {
      setAnalyzingStep(1);
      $('#analyzingTitle').textContent = 'Scoring and shortlisting funds…';
      $('#analyzingSub').textContent = 'Category-relative percentiles narrow the pool to suitable funds.';
    }, 600);

    setTimeout(() => {
      setAnalyzingStep(2);
      $('#analyzingTitle').textContent = 'Optimizing and testing the portfolio…';
      $('#analyzingSub').textContent = 'Weights, a five-year replay and a Monte Carlo range are next.';
    }, 1200);
  }

  function showError(error) {
    const box = $('#quizError');
    box.hidden = false;
    box.innerHTML = `<b>Could not build the plan</b><p>${M.esc(error.message)}</p>`;
    $('#analyzingTitle').textContent = 'The backend did not answer.';
    $('#analyzingSub').textContent = 'Check that the API is running, then try again.';
    busy = false;

    const back = M.el('button', 'btn small', '← Back to the questions');
    back.onclick = () => {
      $('#quizAnalyzing').hidden = true;
      setStep(4, 'backward');
    };
    box.appendChild(back);
  }

  async function finish() {
    if (busy) return;
    busy = true;

    if (amountInput) {
      profile.mode = amountInput.getMode();
      profile.amount = amountInput.getAmount();
    }

    showAnalyzing();

    const request = M.recommendationRequest(profile);

    try {
      const [result] = await Promise.all([
        M.apiPost('/recommend', request),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);

      setAnalyzingStep(3);
      $('#analyzingTitle').textContent = 'Plan ready.';
      const isSip = result.inputs.mode === 'sip';
      $('#analyzingSub').textContent =
        `${result.allocations.length} funds · ${M.pct(result.equity_target / 100)} equity · ` +
        `${M.inr(result.inputs.amount)}${isSip ? '/month SIP' : ' invested'}`;

      M.saveProfile(profile);
      M.saveRecommendation({ request, result });
      M.toast(`Plan built — opening ${isSip ? 'SIP' : 'lump sum'} dashboard`);
      setTimeout(() => {
        window.location.href = 'results.html';
      }, 700);
    } catch (error) {
      showError(error);
    }
  }

  $('#btnCompute').onclick = finish;

  $('#btnSample').onclick = () => {
    Object.assign(profile, {
      age: 52,
      horizon: 3,
      mode: 'lumpsum',
      amount: 250000,
      appetite: 'conservative',
    });
    if (amountInput) {
      amountInput.setMode('lumpsum');
      amountInput.setAmount(250000);
    }
    sync();
    finish();
  };

  // ---------------------------------------------------------------- keyboard
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.location.href = 'index.html';
    } else if (event.key === 'Enter' && !busy) {
      if (step < 4) setStep(step + 1, 'forward');
      else finish();
    }
  });
})();
