/* FundLens — tiny dependency-free canvas charts (line, scatter) */
(() => {
  const registry = [];
  let tooltipEl = null;

  function tooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'tt';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }
  function showTT(x, y, html) {
    const tt = tooltip();
    tt.innerHTML = html;
    tt.style.display = 'block';
    const pad = 12;
    let left = x + pad, top = y + pad;
    const r = tt.getBoundingClientRect();
    if (left + r.width > innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > innerHeight - 8) top = y - r.height - pad;
    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
  }
  function hideTT() { if (tooltipEl) tooltipEl.style.display = 'none'; }

  function setup(canvas, cfg, render) {
    canvas.__cfg = cfg;
    if (!canvas.__bound) {
      canvas.__bound = true;
      canvas.addEventListener('mousemove', (e) => cfg.__hover && cfg.__hover(e, canvas));
      canvas.addEventListener('mouseleave', () => { hideTT(); cfg.__draw && cfg.__draw(canvas); });
      canvas.addEventListener('click', (e) => cfg.__click && cfg.__click(e, canvas));
    }
    cfg.__draw = render;
    render(canvas);
    if (!registry.includes(canvas)) registry.push(canvas);
  }
  window.addEventListener('resize', () => registry.forEach(c => c.__cfg && c.__cfg.__draw && c.__cfg.__draw(c)));
  window.addEventListener('scroll', hideTT, { passive: true });

  function prep(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const h = height;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function niceTicks(min, max, count = 5) {
    if (!(max > min)) max = min + 1;
    const step0 = (max - min) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const mult = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
    const step = mult * mag;
    const start = Math.ceil(min / step) * step;
    const out = [];
    for (let v = start; v <= max + 1e-9; v += step) out.push(v);
    return out;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(t) {
    const d = new Date(t);
    return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  }
  function fmtFull(t) {
    const d = new Date(t);
    return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  function css(v, fallback) {
    if (typeof v !== 'string') return fallback;
    const probe = document.createElement('span');
    probe.style.color = '';
    document.body.appendChild(probe);
    probe.style.color = v;
    const col = getComputedStyle(probe).color;
    probe.remove();
    return col;
  }

  // ------------------------------------------------------------------ line
  function line(canvas, cfg) {
    const PADX = 54, PADR = 14, PADT = 16, PADB = 26;
    const render = (cv) => {
      const { ctx, w, h } = prep(cv, cfg.height || 280);
      const series = cfg.series.filter(s => s.pts && s.pts.length);
      if (!series.length) return;
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const s of series) for (const [t, v] of s.pts) {
        xmin = Math.min(xmin, t); xmax = Math.max(xmax, t);
        ymin = Math.min(ymin, v); ymax = Math.max(ymax, v);
      }
      if (!isFinite(xmin)) return;
      if (ymin === ymax) { ymax += 1; ymin -= 1; }
      const pad = (ymax - ymin) * 0.08;
      ymin -= pad; ymax += pad;
      const X = t => PADX + (t - xmin) / (xmax - xmin) * (w - PADX - PADR);
      const Y = v => PADT + (1 - (v - ymin) / (ymax - ymin)) * (h - PADT - PADB);
      const px = v => `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;

      // grid + y ticks
      ctx.font = '10.5px Inter, system-ui, sans-serif';
      for (const t of niceTicks(ymin, ymax, 5)) {
        ctx.strokeStyle = css('var(--line)', '#1e293b'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PADX, Y(t)); ctx.lineTo(w - PADR, Y(t)); ctx.stroke();
        ctx.fillStyle = css('var(--faint)', '#64748b');
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.yFmt ? cfg.yFmt(t) : px(t), PADX - 8, Y(t));
      }
      // optional zero line (useful for drawdowns)
      if (cfg.zeroLine && ymin < 0 && ymax > 0) {
        ctx.strokeStyle = css('var(--line-focus)', '#334155');
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PADX, Y(0)); ctx.lineTo(w - PADR, Y(0)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = css('var(--faint)', '#64748b');
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText('0%', PADX - 8, Y(0));
      }

      // x ticks
      const nt = Math.min(7, Math.max(3, Math.floor(w / 120)));
      for (let i = 0; i <= nt; i++) {
        const t = xmin + (xmax - xmin) * i / nt;
        ctx.fillStyle = css('var(--faint)', '#64748b'); ctx.textAlign = i === 0 ? 'left' : i === nt ? 'right' : 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(fmtDate(t), X(t), h - 8);
      }
      // series
      for (const s of series) {
        ctx.beginPath();
        s.pts.forEach(([t, v], i) => { const x = X(t), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = css(s.color, '#6366f1');
        ctx.lineWidth = s.width || 2;
        ctx.setLineDash(s.dash || []);
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.area) {
          ctx.lineTo(X(s.pts[s.pts.length - 1][0]), h - PADB);
          ctx.lineTo(X(s.pts[0][0]), h - PADB);
          ctx.closePath();
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = css(s.color, '#6366f1');
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // legend (top-center)
      if (series.length > 1) {
        let lx = PADX; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        for (const s of series) {
          ctx.fillStyle = css(s.color, '#6366f1'); ctx.fillRect(lx, 4, 10, 3); ctx.fillRect(lx, 4, 10, 1); lx += 14;
          ctx.fillStyle = css('var(--muted)', '#94a3b8'); ctx.font = '10.5px Inter, system-ui, sans-serif';
          ctx.fillText(s.name, lx, 9);
          lx += ctx.measureText(s.name).width + 16;
        }
      }
      // hover
      cfg.__hover = (e, c) => {
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let best = null;
        for (const s of series) for (const [t, v] of s.pts) {
          const dx = X(t) - mx, dy = Y(v) - my;
          const d = dx * dx + dy * dy;
          if (!best || d < best.d) best = { d, s, t, v, x: X(t), y: Y(v) };
        }
        if (best && best.d < 900) {
          render(c);
          const cx = best.x, cy = best.y;
          c.getContext('2d').beginPath();
          c.getContext('2d').arc(cx, cy, 4, 0, 7);
          c.getContext('2d').fillStyle = css(best.s.color, '#6366f1');
          c.getContext('2d').fill();
          c.getContext('2d').lineWidth = 2;
          c.getContext('2d').strokeStyle = css('var(--card)', '#111827');
          c.getContext('2d').stroke();
          showTT(e.clientX, e.clientY, `<b>${best.s.name}</b>${best.s.fmt ? best.s.fmt(best.v) : `<br>${fmtFull(best.t)} · ${best.s.vFmt ? best.s.vFmt(best.v) : best.v}`}`);
        } else hideTT();
      };
      if (cfg.__hoverRef) cfg.__hover = cfg.__hoverRef;
    };
    setup(canvas, cfg, render);
  }

  // --------------------------------------------------------------- scatter
  function scatter(canvas, cfg) {
    const PADX = 58, PADR = 18, PADT = 18, PADB = 40;
    const render = (cv) => {
      const { ctx, w, h } = prep(cv, cfg.height || 340);
      const pts = cfg.points;
      if (!pts || !pts.length) return;
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
      const sx = (xmax - xmin) * 0.06 || 1, sy = (ymax - ymin) * 0.06 || 1;
      xmin -= sx; xmax += sx; ymin -= sy; ymax += sy;
      const X = v => PADX + (v - xmin) / (xmax - xmin) * (w - PADX - PADR);
      const Y = v => PADT + (1 - (v - ymin) / (ymax - ymin)) * (h - PADT - PADB);
      ctx.font = '10.5px Inter, system-ui, sans-serif';
      for (const t of niceTicks(ymin, ymax, 5)) {
        ctx.strokeStyle = Math.abs(t) < 1e-9 ? css('var(--line-focus)', '#334155') : css('var(--line)', '#1e293b'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PADX, Y(t)); ctx.lineTo(w - PADR, Y(t)); ctx.stroke();
        ctx.fillStyle = css('var(--faint)', '#64748b'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.yFmt ? cfg.yFmt(t) : t, PADX - 8, Y(t));
      }
      for (const t of niceTicks(xmin, xmax, 6)) {
        ctx.strokeStyle = Math.abs(t) < 1e-9 ? css('var(--line-focus)', '#334155') : css('var(--line)', '#1e293b');
        ctx.beginPath(); ctx.moveTo(X(t), PADT); ctx.lineTo(X(t), h - PADB); ctx.stroke();
        ctx.fillStyle = css('var(--faint)', '#64748b'); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(cfg.xFmt ? cfg.xFmt(t) : t, X(t), h - PADB + 16);
      }
      ctx.fillStyle = css('var(--muted)', '#94a3b8'); ctx.textAlign = 'center';
      ctx.fillText(cfg.xLabel || '', PADX + (w - PADX - PADR) / 2, h - 4);
      ctx.save();
      ctx.translate(14, PADT + (h - PADT - PADB) / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText(cfg.yLabel || '', 0, 0);
      ctx.restore();
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), p.r || 5, 0, 7);
        ctx.fillStyle = css(p.color, '#4f46e5');
        ctx.globalAlpha = 0.75;
        ctx.fill();
        if (cfg.zeroLine && ymin < 0 && ymax > 0) { /* nothing */ }
        ctx.globalAlpha = 1;
      }
      cfg.__hover = (e, c) => {
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const dx = X(pts[i].x) - mx, dy = Y(pts[i].y) - my;
          const d = dx * dx + dy * dy;
          if (!best || d < best.d) best = { d, i, x: X(pts[i].x), y: Y(pts[i].y) };
        }
        if (best && best.d < 500) {
          const p = pts[best.i];
          showTT(e.clientX, e.clientY, cfg.tipFmt ? cfg.tipFmt(p) : `<b>${p.label}</b>`);
        } else hideTT();
      };
      cfg.__click = (e, c) => {
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const dx = X(pts[i].x) - mx, dy = Y(pts[i].y) - my;
          const d = dx * dx + dy * dy;
          if (!best || d < best.d) best = { d, i };
        }
        if (best && best.d < 500 && cfg.onPick) cfg.onPick(pts[best.i], best.i);
      };
    };
    setup(canvas, cfg, render);
  }

  // ------------------------------------------------------- projection band
  function band(canvas, cfg) {
    const PADX = 58, PADR = 16, PADT = 22, PADB = 30;

    const render = (cv) => {
      const { ctx, w, h } = prep(cv, cfg.height || 320);
      const points = cfg.bands || [];
      if (!points.length) return;

      const values = [];
      for (const point of points) {
        values.push(point.p5, point.p95);
        if (cfg.invested) values.push(cfg.invested[point.month]);
      }
      let ymin = Math.min(...values);
      let ymax = Math.max(...values);
      const pad = (ymax - ymin) * 0.08 || 1;
      ymin -= pad;
      ymax += pad;

      const maxMonth = points[points.length - 1].month;
      const X = (month) => PADX + (month / Math.max(1, maxMonth)) * (w - PADX - PADR);
      const Y = (value) => PADT + (1 - (value - ymin) / (ymax - ymin)) * (h - PADT - PADB);

      ctx.font = '10.5px Inter, system-ui, sans-serif';
      for (const tick of niceTicks(ymin, ymax, 5)) {
        ctx.strokeStyle = css('var(--line)', '#1e293b');
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PADX, Y(tick)); ctx.lineTo(w - PADR, Y(tick)); ctx.stroke();
        ctx.fillStyle = css('var(--faint)', '#64748b');
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.yFmt ? cfg.yFmt(tick) : String(tick), PADX - 8, Y(tick));
      }

      const tickCount = Math.min(6, Math.max(3, Math.floor(w / 130)));
      for (let i = 0; i <= tickCount; i++) {
        const month = Math.round((maxMonth * i) / tickCount);
        ctx.fillStyle = css('var(--faint)', '#64748b');
        ctx.textAlign = i === 0 ? 'left' : i === tickCount ? 'right' : 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(
          cfg.xFmt ? cfg.xFmt(month) : `${month}m`,
          X(month),
          h - 8
        );
      }

      function fillBand(lowKey, highKey, color, alpha) {
        ctx.beginPath();
        points.forEach((point, index) => {
          const x = X(point.month);
          const y = Y(point[highKey]);
          index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        [...points].reverse().forEach((point) => {
          ctx.lineTo(X(point.month), Y(point[lowKey]));
        });
        ctx.closePath();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = css(color, '#6366f1');
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      fillBand('p5', 'p95', 'var(--brand)', 0.12);
      fillBand('p25', 'p75', 'var(--brand)', 0.2);

      ctx.beginPath();
      points.forEach((point, index) => {
        const x = X(point.month);
        const y = Y(point.p50);
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = css('var(--brand)', '#6366f1');
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.stroke();

      if (cfg.invested) {
        ctx.beginPath();
        points.forEach((point, index) => {
          const x = X(point.month);
          const y = Y(cfg.invested[point.month] || 0);
          index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.strokeStyle = css('var(--faint)', '#64748b');
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Legend
      const legend = [
        ['var(--brand)', 'Median'],
        ['var(--brand)', '25th–75th percentile', 0.35],
        ['var(--brand)', '5th–95th percentile', 0.18],
        ['var(--faint)', 'Contributions'],
      ];
      let lx = PADX;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      for (const [color, label, alpha = 1] of legend) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = css(color, '#6366f1');
        ctx.fillRect(lx, 5, 12, 4);
        ctx.globalAlpha = 1;
        lx += 17;
        ctx.fillStyle = css('var(--muted)', '#94a3b8');
        ctx.font = '10.5px Inter, system-ui, sans-serif';
        ctx.fillText(label, lx, 10);
        lx += ctx.measureText(label).width + 16;
      }

      cfg.__hover = (event, c) => {
        const rect = c.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        let closest = points[0];
        for (const point of points) {
          if (Math.abs(X(point.month) - mouseX) < Math.abs(X(closest.month) - mouseX)) {
            closest = point;
          }
        }
        render(c);
        const context = c.getContext('2d');
        context.beginPath();
        context.arc(X(closest.month), Y(closest.p50), 4, 0, 7);
        context.fillStyle = css('var(--brand)', '#6366f1');
        context.fill();
        context.strokeStyle = css('var(--card)', '#212124');
        context.lineWidth = 2;
        context.stroke();
        showTT(
          event.clientX,
          event.clientY,
          `<b>Month ${closest.month}</b><br>` +
            `Median ${cfg.yFmt ? cfg.yFmt(closest.p50) : closest.p50}<br>` +
            `5th–95th ${cfg.yFmt ? cfg.yFmt(closest.p5) : closest.p5} – ` +
            `${cfg.yFmt ? cfg.yFmt(closest.p95) : closest.p95}`
        );
      };
    };

    setup(canvas, cfg, render);
  }

  window.Charts = { line, scatter, band };
})();
