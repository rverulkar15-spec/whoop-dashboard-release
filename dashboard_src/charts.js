/* ---------- SVG chart builders: no libraries, readable without color alone ---------- */
const DEFS = '<defs><pattern id="hatch1" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#4aa0e6"/><rect width="3" height="6" fill="#2a6aa3"/></pattern>' +
  '<pattern id="hatch2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#d9a7ff"/><rect width="3" height="6" fill="#8d5fb3"/></pattern>' +
  '<pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#5fd39a"/><circle cx="3" cy="3" r="1.4" fill="#1d6b48"/></pattern></defs>';

function niceTicks(lo, hi, n) {
  n = n || 5;
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), nm = raw / mag;
  const step = (nm < 1.5 ? 1 : nm < 3 ? 2 : nm < 7 ? 5 : 10) * mag, t = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) t.push(+v.toFixed(10));
  return t;
}
function dayTicks(x0, x1) {
  const span = x1 - x0, steps = [1, 2, 7, 14, 30, 60, 90, 180];
  const step = steps.find(s => span / s <= 7) || 365, t = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) t.push(v);
  return t;
}
const yFmtAuto = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : (Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : String(Math.round(v * 10) / 10));
const legendLine = i => '<svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" class="s' + i + '"/></svg>';

function lineChart(o) {
  const W = o.w || 720, H = o.h || 230, m = { l: 46, r: 14, t: 12, b: 26 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const series = (o.series || []).filter(s => s.pts.some(p => isNum(p[1])));
  if (!series.length) return '<p class="muted">Not enough data to draw this chart yet.</p>';
  const xs = []; let ys = [];
  series.forEach(s => s.pts.forEach(p => { if (isNum(p[1])) { xs.push(p[0]); ys.push(p[1]); } }));
  (o.band || []).forEach(b => { if (isNum(b[1])) ys.push(b[1]); if (isNum(b[2])) ys.push(b[2]); });
  (o.hlines || []).forEach(h => ys.push(h.y));
  const x0 = o.x0 != null ? o.x0 : Math.min(...xs), x1r = o.x1 != null ? o.x1 : Math.max(...xs), x1 = x1r === x0 ? x0 + 1 : x1r;
  let y0 = o.y0 != null ? o.y0 : Math.min(...ys), y1 = o.y1 != null ? o.y1 : Math.max(...ys);
  const pad = ((y1 - y0) || 1) * 0.08; if (o.y0 == null) y0 -= pad; if (o.y1 == null) y1 += pad;
  const X = x => m.l + (x - x0) / (x1 - x0) * iw, Y = y => m.t + (1 - (y - y0) / (y1 - y0)) * ih;
  const yf = o.yFmt || yFmtAuto, maxGap = o.maxGap || 2.5;
  let g = '<g class="ax">';
  niceTicks(y0, y1, 4).forEach(v => { g += '<line class="gridl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + esc(yf(v)) + '</text>'; });
  dayTicks(x0, x1).forEach(v => { g += '<line class="gridl" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + m.t + '" y2="' + (H - m.b) + '"/><text x="' + X(v) + '" y="' + (H - 8) + '" text-anchor="middle">' + fmtDay(v) + '</text>'; });
  g += '</g>';
  // band
  if (o.band) {
    let run = [];
    const flush = () => { if (run.length > 1) { let d = 'M' + X(run[0][0]) + ' ' + Y(run[0][1]); run.slice(1).forEach(p => d += 'L' + X(p[0]) + ' ' + Y(p[1])); for (let i = run.length - 1; i >= 0; i--) d += 'L' + X(run[i][0]) + ' ' + Y(run[i][2]); g += '<path class="band" d="' + d + 'Z"/>'; } run = []; };
    o.band.forEach(b => { if (isNum(b[1]) && isNum(b[2])) run.push(b); else flush(); }); flush();
  }
  (o.hlines || []).forEach(h => { g += '<line class="hline" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(h.y) + '" y2="' + Y(h.y) + '"/><text class="ax" x="' + (W - m.r - 2) + '" y="' + (Y(h.y) - 4) + '" text-anchor="end" style="fill:var(--muted);font:11px var(--ui)">' + esc(h.label || '') + '</text>'; });
  let leg = '', desc = [];
  series.forEach((s, i) => {
    const k = s.cls != null ? s.cls : i % 4;
    let d = '', prev = null;
    s.pts.forEach(p => { if (!isNum(p[1])) { prev = null; return; } d += (prev && p[0] - prev[0] <= maxGap ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); prev = p; });
    g += '<path class="s' + k + '" d="' + d + '"/>';
    const real = s.pts.filter(p => isNum(p[1]));
    if (real.length <= 160) real.forEach(p => { g += '<circle class="pt' + k + '" cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.3"/>'; });
    if (real.length <= 500) real.forEach(p => { g += '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="8" fill="transparent"><title>' + esc((s.label || '') + ': ' + yf(p[1]) + (s.unit || '') + ' on ' + fmtDayW(p[0])) + '</title></circle>'; });
    leg += '<span class="leg">' + legendLine(k) + esc(s.label || '') + '</span>';
    const lp = last(real); desc.push((s.label || 'series') + ' ends at ' + yf(lp[1]) + (s.unit || ''));
  });
  if (o.band) leg += '<span class="leg"><span class="chip" style="background:rgba(124,196,255,.35)"></span>' + esc(o.bandLabel || 'normal band') + '</span>';
  const id = 'lc' + Math.random().toString(36).slice(2, 7);
  return '<figure class="chart"><figcaption>' + leg + '</figcaption><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="' + id + 't ' + id + 'd" preserveAspectRatio="xMidYMid meet">' +
    '<title id="' + id + 't">' + esc(o.title || 'Line chart') + '</title><desc id="' + id + 'd">' + esc(desc.join('. ')) + '</desc>' + g + '</svg></figure>';
}

function barChart(o) {
  const cats = o.cats || [];
  if (!cats.length || !cats.some(c => sum(c.parts.map(p => p.v || 0)) > 0)) return '<p class="muted">Not enough data to draw this chart yet.</p>';
  const W = o.w || 720, H = o.h || 220, m = { l: 42, r: 10, t: 14, b: 30 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const totals = cats.map(c => sum(c.parts.map(p => p.v || 0)));
  const ticks = niceTicks(0, Math.max(...totals) * 1.1, 4), y1 = Math.max(last(ticks), Math.max(...totals) * 1.05);
  const Y = v => m.t + (1 - v / y1) * ih, bw = iw / cats.length, barW = Math.min(46, bw * 0.72);
  let g = '<g class="ax">';
  ticks.forEach(v => { g += '<line class="gridl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + esc(yFmtAuto(v)) + '</text>'; });
  const every = cats.length > 16 ? Math.ceil(cats.length / 12) : 1;
  cats.forEach((c, i) => {
    const x = m.l + i * bw + (bw - barW) / 2; let acc = 0;
    c.parts.forEach(p => { if (!(p.v > 0)) return; const y = Y(acc + p.v), h = Y(acc) - y; g += '<rect class="bar' + (p.i % 5) + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '"><title>' + esc((c.title || c.label) + ': ' + (p.name ? p.name + ' ' : '') + yFmtAuto(p.v) + (o.unit || '')) + '</title></rect>'; acc += p.v; });
    if (cats.length <= 16 && totals[i] > 0) g += '<text x="' + (x + barW / 2) + '" y="' + (Y(totals[i]) - 4) + '" text-anchor="middle" style="fill:var(--text);font:600 11px var(--ui)">' + esc(yFmtAuto(totals[i])) + (c.partial ? '*' : '') + '</text>';
    if (i % every === 0) g += '<text x="' + (x + barW / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(c.label) + '</text>';
  });
  g += '</g>';
  let leg = '';
  (o.legend || []).forEach(l => { leg += '<span class="leg"><svg width="16" height="12" aria-hidden="true"><rect class="bar' + (l.i % 5) + '" width="16" height="12"/></svg>' + esc(l.name) + '</span>'; });
  const id = 'bc' + Math.random().toString(36).slice(2, 7);
  return '<figure class="chart"><figcaption>' + leg + (cats.some(c => c.partial) ? '<span class="leg">* week still in progress</span>' : '') + '</figcaption><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="' + id + '">' + DEFS +
    '<title id="' + id + '">' + esc(o.title || 'Bar chart') + '. Latest bar ' + yFmtAuto(last(totals)) + (o.unit || '') + '.</title>' + g + '</svg></figure>';
}

function scatter(o) {
  const pts = (o.pts || []).filter(p => isNum(p.x) && isNum(p.y));
  if (pts.length < 3) return '<p class="muted">Not enough points to plot (n=' + pts.length + ').</p>';
  const W = o.w || 520, H = o.h || 260, m = { l: 46, r: 14, t: 12, b: 36 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xv = pts.map(p => p.x), yv = pts.map(p => p.y);
  let x0 = Math.min(...xv), x1 = Math.max(...xv), y0 = Math.min(...yv), y1 = Math.max(...yv);
  const px = (x1 - x0 || 1) * 0.06, py = (y1 - y0 || 1) * 0.08; x0 -= px; x1 += px; y0 -= py; y1 += py;
  const X = x => m.l + (x - x0) / (x1 - x0) * iw, Y = y => m.t + (1 - (y - y0) / (y1 - y0)) * ih;
  let g = '<g class="ax">';
  niceTicks(y0, y1, 4).forEach(v => { g += '<line class="gridl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + esc((o.yFmt || yFmtAuto)(v)) + '</text>'; });
  niceTicks(x0, x1, 5).forEach(v => { g += '<text x="' + X(v) + '" y="' + (H - 18) + '" text-anchor="middle">' + esc((o.xFmt || yFmtAuto)(v)) + '</text>'; });
  g += '<text x="' + (m.l + iw / 2) + '" y="' + (H - 3) + '" text-anchor="middle">' + esc(o.xLabel || '') + '</text>';
  g += '<text x="' + m.l + '" y="' + (m.t - 2) + '">' + esc(o.yLabel || '') + '</text></g>';
  const mx = mean(xv), my = mean(yv); let sxy = 0, sxx = 0; pts.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; });
  if (o.trend !== false && sxx > 0) { const b = sxy / sxx, a = my - b * mx; g += '<line class="hline" style="stroke:var(--accent2);stroke-width:1.6;stroke-dasharray:7 4" x1="' + X(x0 + px) + '" y1="' + Y(a + b * (x0 + px)) + '" x2="' + X(x1 - px) + '" y2="' + Y(a + b * (x1 - px)) + '"/>'; }
  pts.forEach(p => { g += '<circle class="pt0" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="4" stroke="#0a0b0d"><title>' + esc(p.t || '') + '</title></circle>'; });
  const id = 'sc' + Math.random().toString(36).slice(2, 7);
  return '<figure class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="' + id + '"><title id="' + id + '">' + esc(o.title || 'Scatter plot') + ', ' + pts.length + ' points</title>' + g + '</svg></figure>';
}

function gauge(o) {
  const S = o.size || 240, cx = S / 2, cy = S / 2 + 4, r = S * 0.38, a0 = 135, a1 = 405, sw = S * 0.07;
  const frac = clamp((o.value || 0) / o.max, 0, 1);
  const pt = (a, rr) => [cx + rr * Math.cos(a * Math.PI / 180), cy + rr * Math.sin(a * Math.PI / 180)];
  const arc = (f, t, rr) => { const A = pt(f, rr), B = pt(t, rr); return 'M' + A[0].toFixed(2) + ' ' + A[1].toFixed(2) + ' A' + rr + ' ' + rr + ' 0 ' + ((t - f) > 180 ? 1 : 0) + ' 1 ' + B[0].toFixed(2) + ' ' + B[1].toFixed(2); };
  let g = '<path d="' + arc(a0, a1, r) + '" fill="none" stroke="#2a2e38" stroke-width="' + sw + '" stroke-linecap="round"/>';
  g += '<path class="needle" data-frac="' + frac + '" d="' + arc(a0, a1, r) + '" fill="none" stroke="' + (o.color || 'var(--accent)') + '" stroke-width="' + sw + '" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + (100 * (1 - frac)) + '"/>';
  (o.ticks || []).forEach(t => {
    const a = a0 + (a1 - a0) * t.v / o.max, A = pt(a, r - sw * 0.9), B = pt(a, r + sw * 0.9), T = pt(a, r + sw * 1.9);
    g += '<line x1="' + A[0] + '" y1="' + A[1] + '" x2="' + B[0] + '" y2="' + B[1] + '" stroke="#eceef2" stroke-width="1.6"/><text x="' + T[0] + '" y="' + (T[1] + 3) + '" text-anchor="middle" style="fill:var(--muted);font:10px var(--ui)">' + esc(t.label || t.v) + '</text>';
  });
  g += '<text x="' + cx + '" y="' + (cy + S * 0.07) + '" text-anchor="middle" style="fill:var(--text);font:600 ' + (S * 0.27) + 'px var(--num)">' + esc(o.text != null ? o.text : nf(o.value, 0)) + '</text>';
  g += '<text x="' + cx + '" y="' + (cy + S * 0.19) + '" text-anchor="middle" style="fill:var(--muted);font:' + (S * 0.058) + 'px var(--ui)">' + esc(o.label || '') + '</text>';
  return '<svg viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-label="' + esc((o.aria || o.label || 'gauge') + ': ' + (o.text != null ? o.text : nf(o.value, 0)) + ' of ' + o.max) + '">' + g + '</svg>';
}

function sparkline(vals, w, h) {
  w = w || 130; h = h || 30;
  const real = vals.filter(isNum); if (real.length < 2) return '';
  const lo = Math.min(...real), hi = Math.max(...real), n = vals.length;
  const X = i => 2 + i * (w - 4) / Math.max(1, n - 1), Y = v => h - 3 - (v - lo) / ((hi - lo) || 1) * (h - 8);
  let d = '', prev = false, lastP = null;
  vals.forEach((v, i) => { if (!isNum(v)) { prev = false; return; } d += (prev ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); prev = true; lastP = [X(i), Y(v)]; });
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Last ' + n + ' days trend, from ' + nf(real[0], 1) + ' to ' + nf(last(real), 1) + '"><path d="' + d + '" fill="none" stroke="var(--accent2)" stroke-width="1.8"/>' + (lastP ? '<circle cx="' + lastP[0] + '" cy="' + lastP[1] + '" r="3" fill="var(--accent)"/>' : '') + '</svg>';
}

function stagesBar(parts) {
  const total = sum(parts.map(p => p.ms)); if (!(total > 0)) return '';
  let bar = '<div class="stagebar" role="img" aria-label="' + esc(parts.map(p => p.name + ' ' + nf(p.ms / total * 100, 0) + '%').join(', ')) + '">', leg = '<div class="sub">';
  parts.forEach((p, i) => {
    const pc = p.ms / total * 100;
    bar += '<div class="sg' + i + '" style="width:' + pc + '%" title="' + esc(p.name + ' ' + fmtHM(p.ms / HOUR)) + '">' + (pc >= 9 ? esc(p.short || p.name) + ' ' + nf(pc, 0) + '%' : '') + '</div>';
    leg += '<span style="margin-right:14px"><span class="chip sg' + i + '"></span> ' + esc(p.name) + ' ' + fmtHM(p.ms / HOUR) + ' (' + nf(pc, 0) + '%)</span>';
  });
  return bar + '</div>' + leg + '</div>';
}
