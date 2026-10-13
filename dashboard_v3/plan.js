/* ---------- Plan your week (MODELED what-if) and a stale data notice ---------- */
/* The what-if reruns the fitness score formula for the last day of the week, with extra lifting days added. Nothing else is changed. */

function planHorizon(A) { const we = weekStart(A) + 6; return we > A ? we : A + 7; }

function planPick(cand, k) {                 // k days spread evenly across the open days
  const out = [], n = cand.length;
  for (let i = 0; i < k; i++) out.push(cand[Math.min(n - 1, Math.floor((i + 0.5) * n / k))]);
  return Array.from(new Set(out));
}

function planOptions(F) {
  const I = F.I, A = F.A, H = planHorizon(A), cand = [];
  for (let d = I.lift.has(A) ? A + 1 : A; d <= H; d++) cand.push(d);
  const rows = [], max = Math.min(cand.length, 6);
  for (let k = 0; k <= max; k++) {
    const days = planPick(cand, k), lift = new Set(I.lift), train = new Set(I.train);
    days.forEach(d => { lift.add(d); train.add(d); });
    const r = fsDay(Object.assign({}, I, { lift, train }), H);
    if (r) rows.push({ k: days.length, days, score: r.score, streak: r.streak, pen: r.pen });
  }
  const seen = new Set(), uniq = rows.filter(r => seen.has(r.k) ? false : (seen.add(r.k), true));
  const top = Math.max.apply(null, uniq.map(r => r.score)), cut = uniq.findIndex(r => r.score >= top - 0.5);
  const out = uniq.slice(0, cut + 1);               // stop at the first row that reaches the ceiling, more lifts add nothing
  try {                                             // and your own program, when a MacroFactor plan is loaded
    const gm = typeof gymModel === 'function' ? gymModel() : null;
    if (gm && gm.prog && typeof gProgAt === 'function') {
      const days = cand.filter(d => { const a = gProgAt(d); return a && !a.over && a.day && !a.day.rest; });
      if (days.length) {
        const lift = new Set(I.lift), train = new Set(I.train); days.forEach(d => { lift.add(d); train.add(d); });
        const r = fsDay(Object.assign({}, I, { lift, train }), H);
        if (r) out.push({ k: days.length, days, score: r.score, streak: r.streak, pen: r.pen, prog: true });
      }
    }
  } catch (e) { console.error('plan program', e); }
  return { H, rows: out };
}

function planCard() {
  const F = fitnessModel(); if (!F || F.series.length < 7) return '';
  const P = planOptions(F), I = F.I, A = F.A, tgt = Math.max(1, C.liftWeekMin || 3);
  if (P.rows.length < 2) return '';
  const done = fsCount(I.lift, P.H - 6, A), rest = P.rows[0], now = F.now.score;
  const hit = P.rows.find(r => !r.prog && done + r.k >= tgt), best = P.rows.reduce((b, r) => r.score > b.score ? r : b, P.rows[0]);
  let h = '<section class="card"><div class="sec-h"><h2>Plan your week</h2>' + tag('MODELED') + '</div>';
  h += '<p class="sub">Where the fitness score would land on ' + esc(fmtDayW(P.H)) + ', with everything else as it is today. You have ' + done + ' of ' + tgt + ' lifts in this window so far.</p>';
  h += '<div class="scroll"><table><thead><tr><th>More lifts</th><th>Days</th><th class="n">Score then</th><th class="n">Against today</th></tr></thead><tbody>' +
    P.rows.map(r => {
      const d = r.score - now;
      return '<tr' + (hit && !r.prog && r.k === hit.k ? ' class="hl"' : '') + '><td>' + (r.prog ? 'Your program (' + r.k + ')' : r.k === 0 ? 'None' : r.k) + (hit && !r.prog && r.k === hit.k ? ' (target)' : '') + '</td><td>' + (r.days.length ? esc(r.days.map(x => WKD[wkdOf(x)]).join(', ')) : 'rest') +
        '</td><td class="n">' + nf(r.score, 0) + '</td><td class="n">' + (Math.abs(d) < 0.5 ? 'same' : (d > 0 ? 'up ' : 'down ') + nf(Math.abs(d), 0)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  const gap = best.score - rest.score, pr = P.rows.find(r => r.prog);
  if (gap >= 1) h += '<p class="st-text">' + (hit && hit.k > 0 ? 'Hitting your target of ' + tgt + ' lifts lands near ' + nf(hit.score, 0) + ', against ' + nf(rest.score, 0) + ' if the rest of the week is off. ' : 'Resting the whole way lands near ' + nf(rest.score, 0) + '. ') +
    (rest.pen > 0 ? 'The idle penalty alone is ' + nf(rest.pen, 0) + ' points of that. ' : '') + (pr ? 'Following your program for the rest of the week lands near ' + nf(pr.score, 0) + '.' : '') + '</p>';
  h += formula('the same fitness score formula run for ' + fmtDay(P.H) + ', with the listed days counted as lifting days spread across the open days. Hours slept, recovery trend, cardio and personal bests are held as they stand today, so a good week of sleep or a new best would only add to this. Open days run from ' + fmtDay(I.lift.has(A) ? A + 1 : A) + '. It is a what-if, not a prediction.');
  return h + '</section>';
}

function freshnessNote() {
  if (!M || M.empty || !M.anchorDay) return '';
  const items = [], today = dIdx(Date.now(), M.anchorDay.o), gap = today - M.anchor;
  if (gap >= 2) items.push('Your newest WHOOP day is ' + fmtDayW(M.anchor) + ', ' + stD(gap) + ' ago. Refreshes run on their own while the computer is on. To pull now, run refresh_whoop.bat, or DOCTOR.bat if this keeps happening.');
  const g = typeof gymModel === 'function' ? gymModel() : null;
  if (g && g.lastDi != null) {
    const days = new Set(M.workouts.filter(w => w.scored && w.sport === 'weightlifting' && w.di > g.lastDi).map(w => w.di));
    if (days.size >= 2) items.push('WHOOP shows ' + days.size + ' lifting days since your last logged MacroFactor session on ' + fmtDay(g.lastDi) + '. Export from MacroFactor again to log those weights.');
  }
  if (!items.length) return '';
  return '<div class="dh" role="note"><b>Worth a look.</b> ' + items.map(esc).join(' ') + '</div>';
}

/* ---------- Notable lately: records and streaks found in your own history (MEASURED averages) ---------- */
function notableItems() {
  const A = M.anchor, first = M.days[0].di, out = [];
  if (A - first < 42) return out;
  const defs = [['hrv', 'HRV', 'up', v => nf(v, 0) + ' ms'], ['rhr', 'Resting heart rate', 'down', v => nf(v, 0) + ' bpm'], ['recovery', 'Recovery', 'up', v => nf(v, 0) + '%'], ['asleep', 'Hours asleep', 'up', v => nf(v, 1) + ' h']];
  defs.forEach(d => {
    const ser = []; for (let di = first + 6; di <= A; di++) { const v = valsIn(M, d[0], di - 6, di); if (v.length >= 5) ser.push({ di, v: mean(v) }); }
    if (ser.length < 35) return;
    const cur = ser[ser.length - 1], hist = ser.slice(0, -1), good = d[2] === 'up' ? (a, b) => a > b : (a, b) => a < b;
    if (hist.every(x => good(cur.v, x.v))) { out.push({ w: 3, t: 'Your 7 day ' + lcl(d[1]) + ' average, ' + d[3](cur.v) + ', is the best on file.' }); return; }
    const prev = hist.slice().reverse().find(x => !good(cur.v, x.v)); // the latest day that was as good or better
    if (prev && A - prev.di >= 21 && good(cur.v, hist[hist.length - 1].v)) out.push({ w: 2, t: 'Your 7 day ' + lcl(d[1]) + ' average, ' + d[3](cur.v) + ', is the best in ' + stD(A - prev.di) + '.' });
    const worst = d[2] === 'up' ? (a, b) => a < b : (a, b) => a > b;
    if (hist.every(x => worst(cur.v, x.v))) out.push({ w: 3, t: 'Your 7 day ' + lcl(d[1]) + ' average, ' + d[3](cur.v) + ', is the worst on file. Worth easing off and sleeping more.' });
  });
  const cur = (pred) => { let n = 0; for (let di = A; di >= first; di--) { const d = M.days.find(x => x.di === di && x.okRec); if (d && pred(d)) n++; else break; } return n; };
  const g = cur(d => d.recovery >= C.bandHi); if (g >= 3) out.push({ w: 1, t: g + ' green recovery days in a row.' });
  const s = cur(d => d.main && d.main.asleep != null && d.main.asleep / HOUR >= 7); if (s >= 3) out.push({ w: 1, t: s + ' nights in a row with 7 hours or more asleep.' });
  return out.sort((x, y) => y.w - x.w).slice(0, 4);
}
function notableCard() {
  const it = notableItems(); if (!it.length) return '';
  return '<section class="card"><div class="sec-h"><h2>Notable lately</h2>' + tag('MEASURED') + '</div><ul class="calllist">' + it.map(x => '<li>' + esc(x.t) + '</li>').join('') + '</ul>' +
    formula('each 7 day average is the mean of the days with a value in that window (at least 5). A record needs at least 35 days of 7 day averages to compare with. Streaks count back from your newest day.') + '</section>';
}

/* ---------- Do you lift better when you recover better? (MEASURED counts) ---------- */
function liftReadinessCard() {
  const g = typeof gymModel === 'function' ? gymModel() : null; if (!g || !g.prs) return '';
  const recBy = new Map(); M.days.forEach(d => { if (d.okRec && isNum(d.recovery) && !recBy.has(d.di)) recBy.set(d.di, d.recovery); });
  const prDays = new Set(g.prs.map(p => p.di)), by = { high: [], mid: [], low: [] };
  Array.from(g.days).forEach(di => { if (!g.byDi.has(di) || !recBy.has(di)) return; by[bandOf(recBy.get(di)).k].push(prDays.has(di)); });
  const total = by.high.length + by.mid.length + by.low.length; if (total < 12) return '';
  const name = { high: 'Green recovery', mid: 'Yellow recovery', low: 'Red recovery' };
  const row = k => { const a = by[k], n = a.length, p = a.filter(Boolean).length; return '<tr><td>' + name[k] + '</td><td class="n">' + n + '</td><td class="n">' + (n ? p : '') + '</td><td class="n">' + (n >= 3 ? nf(p / n * 100, 0) + '%' : '<span class="muted">too few</span>') + '</td></tr>'; };
  const ok = ['high', 'mid', 'low'].filter(k => by[k].length >= 5).map(k => ({ k, r: by[k].filter(Boolean).length / by[k].length }));
  let read = 'Not enough sessions in more than one band yet to compare.';
  if (ok.length >= 2) { const hi = ok.reduce((a, b) => b.r > a.r ? b : a), lo = ok.reduce((a, b) => b.r < a.r ? b : a); read = hi.r - lo.r < 0.1 ? 'New bests came at about the same rate whatever the recovery score was.' : 'New bests came most often on ' + name[hi.k].toLowerCase() + ' days (' + nf(hi.r * 100, 0) + '% of sessions) and least on ' + name[lo.k].toLowerCase() + ' days (' + nf(lo.r * 100, 0) + '%).'; }
  return '<section class="card"><div class="sec-h"><h2>Lifting and recovery</h2>' + tag('MEASURED') + '</div><p class="sub">For each logged lifting day, the WHOOP recovery score that morning and whether any lift set a new best.</p>' +
    '<div class="scroll"><table><thead><tr><th>Recovery that morning</th><th class="n">Sessions</th><th class="n">With a new best</th><th class="n">Share</th></tr></thead><tbody>' + row('high') + row('mid') + row('low') + '</tbody></table></div><p class="st-text">' + esc(read) + '</p>' +
    formula('a session counts once per day, using the recovery score of the same day. New best uses your rule: a heavier weight, or the same weight for more reps. A band needs 5 sessions before it is compared. This shows a pattern in your own log, not proof that recovery causes it; early sessions in a program also set bests more easily.') + '</section>';
}

/* ---------- Plateau watch: lifts that have not set a new best for a while (MEASURED from your log) ---------- */
function plateauItems() {
  const g = typeof gymModel === 'function' ? gymModel() : null; if (!g) return [];
  const out = [];
  Object.keys(g.E).forEach(ex => {
    const E = g.E[ex]; if (E.length < 8) return;
    const lastE = E[E.length - 1]; if (M.anchor - lastE.di > 35) return;           // not being trained now
    const mine = g.prs.filter(p => p.ex === ex), lastPr = mine.length ? mine[mine.length - 1].di : E[2].di;
    const since = E.filter(p => p.di > lastPr).length, days = M.anchor - lastPr;
    if (since < 4 || days < 21) return;
    let top = E[0]; E.forEach(p => { if (p.w > top.w || (p.w === top.w && (p.reps || 0) > (top.reps || 0))) top = p; });
    out.push({ ex, since, days, top, lastW: lastE.w, lastR: lastE.reps });
  });
  return out.sort((a, b) => b.days - a.days).slice(0, 5);
}
function plateauCard() {
  const it = plateauItems(); if (!it.length) return '';
  const rp = r => nf(r, r % 1 ? 1 : 0), fmt = (ex, p) => gWt(ex, p.w) + (p.reps ? ' for ' + rp(p.reps) : '');
  return '<section class="card"><div class="sec-h"><h2>Plateau watch</h2>' + tag('MEASURED') + '</div><p class="sub">Lifts you are still training that have not set a new best for a while. A flat stretch is normal. If several lifts sit here together and your recovery trend is down, a lighter week is the usual answer.</p>' +
    '<div class="scroll"><table><thead><tr><th>Lift</th><th class="n">Sessions since a best</th><th class="n">Days</th><th class="n">Best so far</th><th class="n">Last session</th></tr></thead><tbody>' +
    it.map(x => '<tr><td>' + esc(x.ex) + '</td><td class="n">' + x.since + '</td><td class="n">' + x.days + '</td><td class="n">' + esc(fmt(x.ex, x.top)) + '</td><td class="n">' + esc(gWt(x.ex, x.lastW) + (x.lastR ? ' for ' + rp(x.lastR) : '')) + '</td></tr>').join('') + '</tbody></table></div>' +
    formula('a best is a heavier weight, or the same weight for more reps, than any earlier session on that lift. A lift is listed when it has at least 8 sessions, was trained in the last 35 days, and has had at least 4 sessions and 21 days since its last best. Weights are the ones you logged, never estimates.') + '</section>';
}
