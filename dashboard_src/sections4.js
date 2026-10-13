/* ---------- progress: week over week, month over month, start to now ---------- */
var PG_KEY = 'whoopDash.progress.v1';
var NONTRAIN = UNSCORED_TYPES.concat(['walking']);

function pgRows() {
  const wk = (a, b) => M.workouts.filter(w => w.di >= a && w.di <= b && w.scored);
  const lifts = (a, b) => wk(a, b).filter(w => w.sport === 'weightlifting');
  const runs = (a, b) => M.workouts.filter(w => w.di >= a && w.di <= b && w.runOk);
  const train = (a, b) => wk(a, b).filter(w => !NONTRAIN.includes(w.sport));
  const dm = m => (a, b) => { const v = valsIn(M, m, a, b); return { v: mean(v), n: v.length }; };
  const dd = fn => (a, b) => { const v = []; M.days.forEach(d => { if (d.di >= a && d.di <= b && d.okStrain) { const x = fn(d); if (isNum(x)) v.push(x); } }); return { v: mean(v), n: v.length }; };
  const perWeek = (arr, len, f) => ({ v: arr.length && len > 0 ? sum(arr.map(f)) / len * 7 : (len > 0 ? 0 : null), n: arr.length });
  const avgOf = (arr, f) => { const v = arr.map(f).filter(isNum); return { v: mean(v), n: v.length }; };
  const U1 = () => ' ' + U.dU();
  return [
    { g: 'Recovery and fitness markers', label: 'Recovery score average', type: 'MEASURED', better: 'up', minN: 5, f: v => nf(v, 0) + '%', c: (a, b) => dm('recovery')(a, b) },
    { label: 'HRV average (rmssd)', type: 'MEASURED', better: 'up', minN: 5, f: v => nf(v, 1) + ' ms', c: (a, b) => dm('hrv')(a, b) },
    { label: 'Resting heart rate average', type: 'MEASURED', better: 'down', minN: 5, f: v => nf(v, 1) + ' bpm', c: (a, b) => dm('rhr')(a, b) },
    { label: 'Hours asleep per night', type: 'MEASURED', better: 'up', minN: 5, f: v => nf(v, 1) + ' h', c: (a, b) => dm('asleep')(a, b) },
    { label: 'Sleep performance', type: 'MEASURED', better: 'up', minN: 5, f: v => nf(v, 0) + '%', c: (a, b) => dm('perf')(a, b) },
    { label: 'Sleep consistency', type: 'MEASURED', better: 'up', minN: 5, f: v => nf(v, 0) + '%', c: (a, b) => dm('cons')(a, b) },

    { g: 'Training volume', label: 'Workouts per week (no walks, sauna or stretching)', type: 'MEASURED', better: 'up', count: true, f: v => nf(v, 1), c: (a, b, len) => perWeek(train(a, b), len, () => 1) },
    { label: 'Minutes in ' + zoneLabel() + ' per week', type: 'MEASURED', better: 'up', minN: 0, f: v => nf(v, 0) + ' min', c: (a, b, len) => perWeek(wk(a, b), len, wZoneMin) },
    { label: 'Daily strain average', type: 'MEASURED', better: null, minN: 5, f: v => nf(v, 1), c: (a, b) => dd(d => d.strain)(a, b) },
    { label: 'Energy burned per day (WHOOP estimate)', type: 'MODELED', better: null, minN: 5, f: v => Math.round(v).toLocaleString('en-US') + ' kcal', c: (a, b) => dd(d => d.kj != null ? d.kj / 4.184 : null)(a, b) },
    { label: 'Steps per day', type: 'MEASURED', better: 'up', minN: 5, f: v => Math.round(v).toLocaleString('en-US'), c: (a, b) => dd(d => d.steps)(a, b) },

    { g: 'Lifting: how hard you push', label: 'Lifting sessions per week', type: 'MEASURED', better: 'up', count: true, f: v => nf(v, 1), c: (a, b, len) => perWeek(lifts(a, b), len, () => 1) },
    { label: 'Lifting minutes per week', type: 'MEASURED', better: 'up', count: true, f: v => nf(v, 0) + ' min', c: (a, b, len) => perWeek(lifts(a, b), len, w => w.durMin) },
    { label: 'Lifting energy per week (WHOOP estimate)', type: 'MODELED', better: 'up', count: true, f: v => Math.round(v).toLocaleString('en-US') + ' kcal', c: (a, b, len) => perWeek(lifts(a, b), len, w => (w.kj || 0) / 4.184) },
    { label: 'Average lift strain', type: 'MEASURED', better: 'up', minN: 2, f: v => nf(v, 1), c: (a, b) => avgOf(lifts(a, b), w => w.strain) },
    { label: 'Average peak heart rate in a lift', type: 'MEASURED', better: 'up', minN: 2, f: v => nf(v, 0) + ' bpm', c: (a, b) => avgOf(lifts(a, b), w => w.maxHR) },
    { label: 'Hard minutes in lifts per week (zones 3 to 5)', type: 'MEASURED', better: 'up', count: true, f: v => nf(v, 1) + ' min', c: (a, b, len) => perWeek(lifts(a, b), len, w => w.zones ? (w.zones[3] + w.zones[4] + w.zones[5]) / MINUTE : 0) },

    { g: 'Running', label: 'Runs per week (with usable distance)', type: 'MEASURED', better: 'up', count: true, f: v => nf(v, 1), c: (a, b, len) => perWeek(runs(a, b), len, () => 1) },
    { label: 'Run distance per week', type: 'MEASURED', better: 'up', count: true, f: v => nf(v, 1) + U1(), c: (a, b, len) => perWeek(runs(a, b), len, w => U.d(w.km)) },
    { label: 'Average pace per ' + U.dU(), type: 'MEASURED', better: 'down', minN: 2, f: v => fmtPace(v), c: (a, b) => avgOf(runs(a, b), w => w.paceMin) },
    { label: 'Fastest pace (runs of 3 km or more)', type: 'MEASURED', better: 'down', minN: 1, f: v => fmtPace(v), c: (a, b) => { const v = runs(a, b).filter(w => w.km >= 3).map(w => w.paceMin); return { v: v.length ? Math.min(...v) : null, n: v.length }; } },
    { label: 'Average run heart rate', type: 'MEASURED', better: null, minN: 2, f: v => nf(v, 0) + ' bpm', c: (a, b) => avgOf(runs(a, b), w => w.avgHR) },
    { label: 'Heartbeats per ' + U.dU() + ' (lower means more efficient)', type: 'MODELED', better: 'down', minN: 2, f: v => Math.round(v).toLocaleString('en-US'), c: (a, b) => avgOf(runs(a, b), w => w.beatsPer) }
  ];
}

function pgBuckets(mode) {
  const first = M.days[0].di, anchor = M.anchor, out = [];
  const mk = (label, a, b, partial) => { const ea = Math.max(a, first), eb = Math.min(b, anchor); return { label, a: ea, b: eb, len: eb - ea + 1, partial: !!partial }; };
  if (mode === 'week') {
    for (let ws = weekStart(first); ws <= anchor; ws += 7) out.push(mk(fmtDay(ws), ws, ws + 6, ws + 6 > anchor));
  } else if (mode === 'month') {
    const f = new Date(first * DAY), cur = new Date(anchor * DAY);
    let y = f.getUTCFullYear(), m = f.getUTCMonth();
    while (y < cur.getUTCFullYear() || (y === cur.getUTCFullYear() && m <= cur.getUTCMonth())) {
      const a = Date.UTC(y, m, 1) / DAY, b = Date.UTC(y, m + 1, 0) / DAY;
      out.push(mk(MON[m] + ' ' + y, a, b, b > anchor));
      m++; if (m > 11) { m = 0; y++; }
    }
  } else if (mode === 'avg') {
    out.push(mk('Your average, last 90 days', anchor - 89, anchor, false));
    out.push(mk('Last 28 days (' + fmtDay(anchor - 27) + ' to ' + fmtDay(anchor) + ')', anchor - 27, anchor, false));
  } else {
    out.push(mk('First 28 days (' + fmtDay(first) + ' to ' + fmtDay(first + 27) + ')', first, first + 27, false));
    out.push(mk('Last 28 days (' + fmtDay(anchor - 27) + ' to ' + fmtDay(anchor) + ')', anchor - 27, anchor, false));
  }
  return out;
}

function pgJudge(row, p, c) {
  if (!p || !c || p.v == null || c.v == null) return { fav: 'na', pct: null };
  if (!row.count && (p.n < (row.minN || 1) || c.n < (row.minN || 1))) return { fav: 'thin', pct: null };
  const d = c.v - p.v, pct = p.v !== 0 ? d / Math.abs(p.v) * 100 : null;
  if (pct != null && Math.abs(pct) < 3) return { fav: 'same', d, pct };
  if (pct == null && d === 0) return { fav: 'same', d, pct };
  if (!row.better) return { fav: 'changed', d, pct };
  return { fav: (row.better === 'up') === (d > 0) ? 'toward' : 'away', d, pct };
}

function pgRecords() {
  const R = [];
  const best = (label, arr, key, f, hi) => { const a = arr.filter(x => isNum(x[key])); if (!a.length) return; const x = a.reduce((p, q) => (hi ? q[key] > p[key] : q[key] < p[key]) ? q : p); R.push({ label, v: f(x[key]), when: fmtDay(x.di), di: x.di }); };
  const rec = M.days.filter(d => d.okRec);
  best('Best recovery score', rec, 'recovery', v => nf(v, 0) + '%', true);
  best('Highest HRV', rec, 'hrv', v => nf(v, 1) + ' ms', true);
  best('Lowest resting heart rate', rec, 'rhr', v => nf(v, 0) + ' bpm', false);
  best('Highest strain day', M.days.filter(d => d.okStrain), 'strain', v => nf(v, 1), true);
  // longest green streak
  let bestRun = 0, bestEnd = null, run = 0, prev = null;
  rec.slice().sort((a, b) => a.di - b.di).forEach(d => {
    if (d.recovery >= C.bandHi) { run = prev != null && d.di === prev + 1 ? run + 1 : 1; if (run > bestRun) { bestRun = run; bestEnd = d.di; } } else run = 0;
    prev = d.di;
  });
  if (bestRun) R.push({ label: 'Longest green recovery streak', v: bestRun + (bestRun === 1 ? ' day' : ' days'), when: 'ended ' + fmtDay(bestEnd), di: bestEnd });
  const ok = M.runs.filter(r => r.runOk);
  best('Longest run', ok, 'km', v => nf(U.d(v), 2) + ' ' + U.dU(), true);
  best('Fastest pace (3 km or more)', ok.filter(r => r.km >= 3), 'paceMin', v => fmtPace(v) + ' per ' + U.dU(), false);
  const lifts = M.workouts.filter(w => w.sport === 'weightlifting' && w.scored);
  best('Longest lifting session', lifts, 'durMin', v => Math.round(v) + ' min', true);
  best('Biggest lifting session by energy', lifts, 'kj', v => Math.round(v / 4.184) + ' kcal', true);
  const wt = weeklyTable(M, 60).filter(w => !w.partial && w.ws >= M.days[0].di);
  const cnt = (w, f) => w.workouts.filter(f).length;
  if (wt.length) {
    const bw = wt.reduce((p, q) => cnt(q, x => x.scored && x.sport === 'weightlifting') > cnt(p, x => x.scored && x.sport === 'weightlifting') ? q : p);
    const n = cnt(bw, x => x.scored && x.sport === 'weightlifting'); if (n) R.push({ label: 'Most lifts in a full week', v: n + ' sessions', when: 'week of ' + fmtDay(bw.ws), di: bw.ws });
    const bt = wt.reduce((p, q) => cnt(q, x => x.scored && !NONTRAIN.includes(x.sport)) > cnt(p, x => x.scored && !NONTRAIN.includes(x.sport)) ? q : p);
    const m = cnt(bt, x => x.scored && !NONTRAIN.includes(x.sport)); if (m) R.push({ label: 'Most workouts in a full week', v: m + ' sessions', when: 'week of ' + fmtDay(bt.ws), di: bt.ws });
  }
  return R;
}

function renderProgress() {
  const el = $('#progBody'); if (!el) return;
  if (!M || M.empty) { el.innerHTML = ''; return; }
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', ev => { const b = ev.target.closest('[data-pg]'); if (!b) return; store.set(PG_KEY, { mode: b.dataset.pg }); safe('progress', renderProgress); });
  }
  const saved = store.get(PG_KEY) || {}, mode = ['avg', 'week', 'month', 'start'].includes(saved.mode) ? saved.mode : 'avg';
  const rows = pgRows(), bk = pgBuckets(mode);
  const full = bk.filter(b => !b.partial);
  const cur = full[full.length - 1], pri = full[full.length - 2];
  let h = '<div class="tabs" role="tablist" aria-label="Compare by">' + [['avg', 'Against my average'], ['start', 'Beginning to now'], ['month', 'Month over month'], ['week', 'Week over week']].map(t =>
    '<button role="tab" data-pg="' + t[0] + '" aria-selected="' + (mode === t[0]) + '">' + t[1] + '</button>').join('') + '</div>';

  if (!cur || !pri || ((mode === 'start' || mode === 'avg') && M.days.length < 40)) {
    h += '<p class="muted">Not enough history for this view yet. It needs two full ' + (mode === 'week' ? 'weeks' : mode === 'month' ? 'calendar months' : 'blocks of 28 days') + ' of data.</p>';
    el.innerHTML = h; return;
  }

  // judge every row between the prior and current complete bucket
  const res = rows.map(r => { const p = r.c(pri.a, pri.b, pri.len), c = r.c(cur.a, cur.b, cur.len); return { r, p, c, j: pgJudge(r, p, c) }; });

  // wins and watch
  const wins = res.filter(x => x.j.fav === 'toward').sort((a, b) => Math.abs(b.j.pct == null ? 999 : b.j.pct) - Math.abs(a.j.pct == null ? 999 : a.j.pct));
  const watch = res.filter(x => x.j.fav === 'away').sort((a, b) => Math.abs(b.j.pct == null ? 999 : b.j.pct) - Math.abs(a.j.pct == null ? 999 : a.j.pct));
  const chgWord = j => j.pct == null ? 'new' : Math.abs(j.pct) >= 300 ? (j.pct > 0 ? 'about ' + nf(1 + j.pct / 100, 0) + ' times as much' : 'a fraction of before') : (j.pct > 0 ? 'up ' : 'down ') + nf(Math.abs(j.pct), 0) + '%';
  const line = x => '<li><b>' + esc(x.r.label) + '</b>: ' + esc(x.r.f(x.p.v)) + ' to ' + esc(x.r.f(x.c.v)) + ' (' + chgWord(x.j) + ')</li>';
  h += '<p class="sub">Comparing <b>' + esc(cur.label) + '</b> against <b>' + esc(pri.label) + '</b>' + (mode === 'week' || mode === 'month' ? '. The current ' + (mode === 'week' ? 'week' : 'month') + ' is left out of the comparison until it is complete, but it is still shown in the table.' : mode === 'avg' ? '. The 90 day average includes the last 28 days, so it understates how far recent weeks have moved.' : '.') + '</p>';
  h += '<div class="grid g2"><div class="tile"><div class="lab"><span>Where you grew</span></div>' + (wins.length ? '<ul style="list-style:none;padding:0;margin:6px 0;line-height:1.7">' + wins.slice(0, 6).map(line).join('') + '</ul>' : '<p class="muted">Nothing moved clearly toward better in this comparison.</p>') + '</div>' +
    '<div class="tile"><div class="lab"><span>Where to look</span></div>' + (watch.length ? '<ul style="list-style:none;padding:0;margin:6px 0;line-height:1.7">' + watch.slice(0, 5).map(line).join('') + '</ul>' : '<p class="muted">Nothing moved clearly the wrong way.</p>') + '</div></div>';

  // table
  const shown = mode === 'week' ? bk.slice(-8) : mode === 'month' ? bk.slice(-12) : bk;
  h += '<div class="scroll"><table><thead><tr><th>Measure</th>' + shown.map(b => '<th class="n">' + esc(b.label) + (b.partial ? ' (so far)' : '') + '</th>').join('') + '<th class="n">Change</th><th>Reading</th><th>Type</th></tr></thead><tbody>';
  let grp = '';
  res.forEach(x => {
    if (x.r.g && x.r.g !== grp) { grp = x.r.g; h += '<tr><th colspan="' + (shown.length + 4) + '" style="color:var(--text);padding-top:14px">' + esc(grp) + '</th></tr>'; }
    const cells = shown.map(b => { const v = x.r.c(b.a, b.b, b.len); return '<td class="n">' + (v.v == null ? '<span class="muted">none</span>' : esc(x.r.f(v.v)) + (x.r.count ? '' : ' <span class="muted">(' + v.n + ')</span>')) + '</td>'; }).join('');
    const j = x.j, chg = j.fav === 'na' || j.fav === 'thin' ? '' : j.fav === 'same' && j.pct == null ? 'no change' : chgWord(j);
    const read = { toward: '<span class="good">' + arrow(j.d) + ' toward better</span>', away: '<span class="warn">' + arrow(j.d) + ' worth watching</span>', same: 'about the same', changed: arrow(j.d || 0) + ' changed', thin: '<span class="muted">too few days or runs</span>', na: '<span class="muted">no data to compare</span>' }[j.fav];
    h += '<tr><td>' + esc(x.r.label) + '</td>' + cells + '<td class="n">' + chg + '</td><td>' + read + '</td><td>' + tag(x.r.type) + '</td></tr>';
  });
  h += '</tbody></table></div>' + formula('each cell is a mean (or a per week total) over the days or workouts that fall inside that block. Numbers in brackets are how many days or runs went into the mean. Per week totals are scaled by the days of data in the block, so short blocks are fair. Reading says toward better only when the change is 3% or more and the block has enough days (5 for daily measures, 2 for run measures). It does not mean the change is caused by anything you did.');

  // charts across the whole history
  const wk = pgBuckets('week').filter(b => !b.partial && b.len >= 7);
  const lifts = (a, b) => M.workouts.filter(w => w.di >= a && w.di <= b && w.scored && w.sport === 'weightlifting');
  const lcats = wk.map(b => ({ label: b.label, title: 'Week of ' + b.label, parts: [{ i: 0, name: 'lifting sessions', v: lifts(b.a, b.b).length }] }));
  const kcats = wk.map(b => ({ label: b.label, title: 'Week of ' + b.label, parts: [{ i: 0, name: 'lifting energy', v: Math.round(sum(lifts(b.a, b.b).map(w => (w.kj || 0) / 4.184))) }] }));
  h += '<h3>Beginning to now, week by week ' + tag('MEASURED') + '</h3><div class="grid g2"><div>' +
    barChart({ title: 'Lifting sessions per week', cats: lcats, unit: ' sessions', legend: [{ i: 0, name: 'lifting sessions' }] }) + '</div><div>' +
    barChart({ title: 'Lifting energy per week', cats: kcats, unit: ' kcal', legend: [{ i: 0, name: 'lifting energy (WHOOP estimate)' }] }) + '</div></div>';
  const okRuns = M.runs.filter(r => r.runOk);
  h += '<div class="grid g2"><div>' + lineChart({ title: 'Pace of each run (lower is faster)', maxGap: 60, yFmt: v => fmtPace(v), series: [{ label: 'pace per ' + U.dU(), pts: okRuns.map(r => [r.di, r.paceMin]) }] }) +
    '</div><div>' + lineChart({ title: 'Heartbeats per ' + U.dU() + ' on each run (lower is more efficient)', maxGap: 60, series: [{ label: 'heartbeats per ' + U.dU(), pts: okRuns.filter(r => r.beatsPer != null).map(r => [r.di, r.beatsPer]) }] }) + '</div></div>';
  const wmean = (m, b) => { const v = valsIn(M, m, b.a, b.b); return v.length >= 3 ? mean(v) : null; };
  h += '<div class="grid g2"><div>' + lineChart({ title: 'HRV, weekly average (ms)', maxGap: 15, series: [{ label: 'HRV', pts: wk.map(b => [b.a, wmean('hrv', b)]) }] }) +
    '</div><div>' + lineChart({ title: 'Resting heart rate, weekly average (bpm)', maxGap: 15, series: [{ label: 'resting heart rate', pts: wk.map(b => [b.a, wmean('rhr', b)]) }] }) + '</div></div>';
  h += formula('runs plotted are the ones with a usable distance (' + okRuns.length + ' of ' + M.runs.length + ' on file); a run with a dropped GPS signal is left out, not guessed. Heartbeats per ' + U.dU() + ' = average heart rate times minutes, divided by distance, a simple way to see whether the same distance costs your heart less over time. Weekly points need at least 3 days of data.');

  // records
  const rec = pgRecords();
  if (rec.length) h += '<h3>Personal records on file ' + tag('MEASURED') + '</h3><div class="grid">' + rec.map(x => '<div class="tile"><div class="lab"><span>' + esc(x.label) + '</span></div><div class="val" style="font-size:26px">' + esc(x.v) + '</div><div class="dev muted">' + esc(x.when) + '</div></div>').join('') + '</div>' +
    formula('best value across every day or workout WHOOP has scored since your first record on ' + esc(fmtDay(M.days[0].di)) + '.');

  h += '<div class="banner"><b>About metabolism.</b> WHOOP does not measure your metabolic rate. The energy figures here are WHOOP estimates built from heart rate plus the height and weight in your profile, so they rise when you move more and say nothing on their own about your metabolism. Muscle gained or weight lifted is not visible to WHOOP either. Lifting progress here is effort and volume, not load on the bar.</div>';
  el.innerHTML = h;
}

/* Hook into the page render without touching the other source files. */
(function () {
  const base = renderAll;
  renderAll = function (keepControls) {
    base(keepControls);
    try { renderProgress(); }
    catch (e) { console.error('progress', e); const el = $('#progBody'); if (el) el.innerHTML = '<div class="banner err">This section could not be drawn (progress): ' + esc(e && e.message) + '. The other sections are unaffected.</div>'; }
  };
})();
