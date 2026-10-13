/* ---------- the orb: original, drawn on a canvas, driven by ORB_VALUE and ORB_COLOR ---------- */
window.ORB_INSTALLED = true;
(function () {
  let raf = 0, cv = null, val = 0, col = '#ff9f1a', shown = 0, t0 = performance.now();
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rgba = (hex, a) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) || [0, 'ff', '9f', '1a']; return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')'; };
  function draw(now) {
    if (!cv || !cv.isConnected) { raf = 0; return; }
    const S = 320, dpr = Math.min(2, window.devicePixelRatio || 1), still = reduce();
    if (cv.width !== S * dpr) { cv.width = S * dpr; cv.height = S * dpr; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
    const t = (now - t0) / 1000, c = S / 2;
    shown += (val - shown) * (still ? 1 : 0.06);
    const f = clamp(shown / 100, 0, 1), breathe = still ? 0 : Math.sin(t * 1.3) * 0.5 + 0.5;
    // soft halo
    const halo = g.createRadialGradient(c, c, 60, c, c, 150); halo.addColorStop(0, rgba(col, 0.20 + 0.10 * breathe)); halo.addColorStop(1, rgba(col, 0));
    g.fillStyle = halo; g.fillRect(0, 0, S, S);
    // sphere
    const R = 92 + 3 * breathe, sp = g.createRadialGradient(c - 28, c - 34, 8, c, c, R);
    sp.addColorStop(0, rgba(col, 0.95)); sp.addColorStop(0.45, rgba(col, 0.55)); sp.addColorStop(1, 'rgba(10,11,13,0.96)');
    g.beginPath(); g.arc(c, c, R, 0, 6.2832); g.fillStyle = sp; g.fill();
    g.lineWidth = 1; g.strokeStyle = rgba(col, 0.5); g.stroke();
    // specular glint
    const gl = g.createRadialGradient(c - 34, c - 40, 0, c - 34, c - 40, 34); gl.addColorStop(0, 'rgba(255,255,255,0.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(c, c, R - 1, 0, 6.2832); g.fill();
    // progress ring
    const rr = 128, a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    g.lineCap = 'round'; g.lineWidth = 9; g.strokeStyle = '#2a2e38'; g.beginPath(); g.arc(c, c, rr, a0, a0 + span); g.stroke();
    if (f > 0.004) { g.save(); g.shadowColor = col; g.shadowBlur = 14; g.strokeStyle = col; g.beginPath(); g.arc(c, c, rr, a0, a0 + span * f); g.stroke(); g.restore(); }
    // slow rotating dashed ring
    g.save(); g.translate(c, c); g.rotate(still ? 0 : t * 0.12); g.setLineDash([2, 9]); g.lineWidth = 1.5; g.strokeStyle = rgba(col, 0.45); g.beginPath(); g.arc(0, 0, R + 14, 0, 6.2832); g.stroke(); g.restore();
    // number
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 8;
    g.font = '600 78px Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif'; g.fillText(String(Math.round(shown)), c, c + 22);
    g.shadowBlur = 0; g.fillStyle = 'rgba(236,238,242,.8)'; g.font = '13px system-ui, sans-serif'; g.fillText('recovery_score', c, c + 46);
    g.fillStyle = '#a8aebb'; g.font = '11px system-ui, sans-serif'; g.fillText('0', c - 92, c + 126); g.fillText('100', c + 92, c + 126);
    raf = still && Math.abs(shown - val) < 0.5 ? 0 : requestAnimationFrame(draw);
  }
  window.onOrbUpdate = function (value, color) {
    const slot = document.getElementById('orbSlot'); if (!slot) return;
    const A = M && M.anchorDay;
    if (!isNum(value)) { slot.innerHTML = '<p class="muted">No recovery score yet for ' + esc(A ? fmtDay(A.di) : 'today') + '.</p>'; return; }
    const b = bandOf(value), bs = baselineAt(M, 'recovery', A.di, C.baselineDays);
    slot.innerHTML = '<canvas role="img" aria-label="Recovery score ' + value + ' of 100, ' + b.name + '" style="width:100%;max-width:340px;aspect-ratio:1/1"></canvas>' +
      '<div class="bandtxt" style="color:' + b.color + '">' + b.sym + ' ' + b.name + '</div><div class="cap">' + esc(fmtDayW(A.di)) + (A.calibrating ? ', still calibrating' : '') +
      (bs.n >= 5 ? '. ' + (value - bs.mean >= 0 ? 'Up ' : 'Down ') + nf(Math.abs(value - bs.mean), 0) + ' vs your ' + C.baselineDays + ' day mean ' + nf(bs.mean, 0) + ' (n=' + bs.n + ')' : '') + '</div>';
    cv = slot.querySelector('canvas'); val = value; col = color || b.color; if (!shown) shown = 0; t0 = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
  };
})();
