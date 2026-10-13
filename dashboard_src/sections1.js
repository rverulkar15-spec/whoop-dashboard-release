/* ---------- sections: read, today, trends, sleep ---------- */
let M = null;
const state = { data: null, entries: [], source: null, nowMs: Date.now() };

const bandOf = v => v >= C.bandHi ? { k: 'high', name: 'HIGH band', sym: '▲', color: '#3fc78a' } : v >= C.bandLo ? { k: 'mid', name: 'MID band', sym: '●', color: '#f2c14e' } : { k: 'low', name: 'LOW band', sym: '▼', color: '#f26d6d' };
const rangeFrom = () => M.anchor - C.chartDays + 1;

/* friendly one line comparison: last N days vs the N before */
function readCompare() {
  const R = C.readDays, a0 = M.anchor - R, a1 = M.anchor - 1, b0 = a0 - R, b1 = a0 - 1, wk = R / 7;
  const firstDi = M.days[0].di, rows = [];
  const pushRate = (label, sport, short) => {
    if (b0 < firstDi) return;
    const cnt = (a, b) => M.workouts.filter(w => w.sport === sport && w.di >= a && w.di <= b).length / wk;
    const cur = cnt(a0, a1), pri = cnt(b0, b1), d = cur - pri;
    rows.push({ label, short, pri, cur, d, dec: 2, unit: '', nP: R, nC: R, verdict: Math.abs(d) < 0.25 ? 'same' : d > 0 ? 'up' : 'down', fav: null, kind: 'load', type: 'MEASURED', basis: 'sessions in window divided by ' + nf(wk, 0) + ' weeks' });
  };
  pushRate('Lifts per week', 'weightlifting', 'lifts per week');
  pushRate('Runs per week', 'running', 'runs per week');
  const pushM = (mk, short, kind) => {
    const m = METRICS[mk], vc = valsIn(M, mk, a0, a1), vp = valsIn(M, mk, b0, b1);
    if (vc.length < 5 || vp.length < 5) return;
    const cur = mean(vc), pri = mean(vp), d = cur - pri, pooled = Math.sqrt(((sd(vc) || 0) ** 2 + (sd(vp) || 0) ** 2) / 2);
    const same = pooled > 0 ? Math.abs(d) < 0.2 * pooled : d === 0;
    const verdict = same ? 'same' : d > 0 ? 'up' : 'down';
    let fav = null; if (!same && m.better) fav = (m.better === 'up') === (d > 0) ? 'toward' : 'away';
    rows.push({ label: m.label, short, pri, cur, d, dec: m.dec, unit: m.unit, nP: vp.length, nC: vc.length, verdict, fav, kind: kind || 'dir', type: mk === 'asleep' ? 'MODELED' : 'MEASURED', basis: 'mean of included days' });
  };
  pushM('strain', 'mean daily strain', 'load');
  pushM('asleep', 'hours asleep');
  pushM('cons', 'sleep consistency');
  pushM('recovery', 'recovery score');
  pushM('hrv', 'HRV');
  pushM('rhr', 'resting heart rate');
  return { rows, R, a0, a1, b0, b1 };
}

function renderRead() {
  const cmp = readCompare(), A = M.anchorDay;
  // sentence
  let line;
  if (!cmp.rows.length) line = 'Not enough history yet for a ' + C.readDays + ' day comparison. It needs at least ' + (2 * C.readDays) + ' days of data.';
  else {
    const cl = cmp.rows.map(r => {
      const w = r.verdict === 'same' ? 'about the same' : r.verdict;
      const tail = r.fav === 'toward' ? ', toward better' : r.fav === 'away' ? ', worth watching' : '';
      const cls = r.fav === 'toward' ? 'up' : r.fav === 'away' ? 'dn' : '';
      return '<span class="' + cls + '">' + esc(r.short) + ' ' + w + '</span> (' + nf(r.pri, r.dec) + ' to ' + nf(r.cur, r.dec) + esc(r.unit) + tail + ')';
    });
    line = 'Last ' + cmp.R + ' days against the ' + cmp.R + ' before: ' + cl.join('; ') + '.';
  }
  $('#readLine').innerHTML = line;

  // table
  let t = '';
  if (cmp.rows.length) {
    t = '<table><caption>Windows end the day before ' + fmtDay(M.anchor) + '. Prior window ' + fmtDay(cmp.b0) + ' to ' + fmtDay(cmp.b1) + ', last window ' + fmtDay(cmp.a0) + ' to ' + fmtDay(cmp.a1) + '.</caption>' +
      '<thead><tr><th>Measure</th><th class="n">Prior (n)</th><th class="n">Last (n)</th><th class="n">Change</th><th>Reading</th><th>Type</th></tr></thead><tbody>';
    cmp.rows.forEach(r => {
      const read = r.verdict === 'same' ? 'about the same' : r.fav === 'toward' ? arrow(r.d) + ' toward better' : r.fav === 'away' ? arrow(r.d) + ' worth watching' : arrow(r.d) + (r.kind === 'load' ? ' load changed' : ' changed');
      t += '<tr><td>' + esc(r.label) + '</td><td class="n">' + nf(r.pri, r.dec) + ' (' + r.nP + ')</td><td class="n">' + nf(r.cur, r.dec) + ' (' + r.nC + ')</td><td class="n">' + (r.d === 0 ? 'none' : (r.d > 0 ? 'up ' : 'down ') + nf(Math.abs(r.d), r.dec)) + '</td><td>' + read + '</td><td>' + tag(r.type) + '</td></tr>';
    });
    const exclLong = M.days.filter(d => d.long && !C.inclLong && d.di >= cmp.b0 && d.di <= cmp.a1).length;
    t += '</tbody></table>' + formula('Change = mean of the last window minus mean of the prior window. Session counts are sessions in the window divided by ' + nf(cmp.R / 7, 0) + ' weeks. "About the same" means the change is under 0.2 pooled standard deviations (under 0.25 sessions a week for counts). "Toward better" assumes higher is better for HRV, recovery and consistency, and lower is better for resting heart rate; strain, hours asleep and session counts are load or neutral, so no verdict.' +
      (exclLong ? ' ' + exclLong + ' day(s) with an unusually long cycle are left out of strain (control: long cycle hours).' : ''));
  }
  $('#readTable').innerHTML = t;

  // dials
  const rv = A.recovery;
  if (rv != null) { const b0 = bandOf(rv); window.ORB_VALUE = rv; window.ORB_COLOR = b0.color; document.documentElement.style.setProperty('--orb-color', b0.color); }
  if (window.ORB_INSTALLED) { /* a custom orb owns #orbSlot and reads ORB_VALUE and ORB_COLOR */ }
  else if (rv != null) {
    const b = bandOf(rv), bs = baselineAt(M, 'recovery', A.di, C.baselineDays);
    $('#orbSlot').innerHTML = gauge({ value: rv, max: 100, size: 300, color: b.color, label: 'recovery_score', aria: 'Recovery score', ticks: [{ v: C.bandLo }, { v: C.bandHi }, { v: 0 }, { v: 100 }] }) +
      '<div class="bandtxt" style="color:' + b.color + '">' + b.sym + ' ' + b.name + '</div><div class="cap">' + esc(fmtDayW(A.di)) + (A.calibrating ? ', still calibrating' : '') +
      (bs.n >= 5 ? '. ' + (rv - bs.mean >= 0 ? 'Up ' : 'Down ') + nf(Math.abs(rv - bs.mean), 0) + ' vs your ' + C.baselineDays + ' day mean ' + nf(bs.mean, 0) + ' (n=' + bs.n + ')' : '') + '</div>';
  } else $('#orbSlot').innerHTML = '<p class="muted">No recovery score yet for ' + esc(fmtDay(A.di)) + '.</p>';
  const perf = A.main && A.main.perf;
  $('#dialL').innerHTML = isNum(perf) ? gauge({ value: perf, max: 100, size: 210, color: 'var(--accent2)', label: 'sleep performance', aria: 'Sleep performance' }) + '<div class="cap">sleep_performance_percentage, efficiency ' + nf(A.main.eff, 0) + '%</div>' : '';
  const L = M.lastDone;
  $('#dialR').innerHTML = L ? gauge({ value: L.strain, max: 21, size: 210, color: 'var(--accent)', text: nf(L.strain, 1), label: 'strain, last full day', aria: 'Strain of the last completed day', ticks: [{ v: 0 }, { v: 21 }] }) + '<div class="cap">' + esc(fmtDay(L.di)) + ', ' + nf(L.lenH, 0) + ' h cycle' + (L.long ? ' (long, excluded from baselines)' : '') + '</div>' : '';
}

/* ---------- today ---------- */
function tileHTML(mk, day, o) {
  o = o || {};
  const m = METRICS[mk], v = rawv(mk, day); if (v == null) return '';
  const b = baselineAt(M, mk, day.di, C.baselineDays), s = baselineAt(M, mk, day.di, C.shortDays);
  let dev;
  if (b.n >= 5) { const diff = v - b.mean; dev = arrow(diff) + ' ' + sign(diff, m.dec >= 1 ? m.dec : 1) + ' vs ' + C.baselineDays + ' day mean ' + nf(b.mean, m.dec) + ' (n=' + b.n + '). ' + ord(pctRank(v, b.vals)) + ' percentile of your range ' + nf(b.min, m.dec) + ' to ' + nf(b.max, m.dec) + '.'; }
  else dev = 'Baseline needs at least 5 days (n=' + b.n + ').';
  if (s.n >= 3) dev += ' ' + C.shortDays + ' day mean ' + nf(s.mean, m.dec) + ' (n=' + s.n + ').';
  const spark = []; for (let k = day.di - 13; k <= day.di; k++) { const d = M.days.find(x => x.di === k && x.main); spark.push(d ? incv(mk, d) : null); }
  return '<div class="tile"><div class="lab"><span>' + esc(m.label) + '</span>' + tag(o.type || 'MEASURED') + '</div><div class="val">' + nf(v, m.dec) + '<small>' + esc(m.unit.trim()) + '</small></div><div class="dev">' + dev + '</div>' + sparkline(spark) +
    formula(o.formula || ('deviation = today minus the mean of the ' + C.baselineDays + ' days before today; percentile = share of those days at or below today; sparkline = last 14 days.')) + '</div>';
}

function renderToday() {
  const A = M.anchorDay; let h = '<p class="sub">' + esc(fmtDayW(A.di)) + ' (wake date). Baselines use the ' + C.baselineDays + ' days before today and leave out ' + (C.inclCalib ? 'nothing' : 'calibration days') + '.</p><div class="grid">';
  ['recovery', 'hrv', 'rhr', 'resp', 'skin', 'spo2', 'perf', 'eff', 'cons'].forEach(k => { h += tileHTML(k, A); });
  h += tileHTML('asleep', A, { type: 'MODELED', formula: 'light + slow wave + REM sleep from the main sleep' + (C.inclNaps ? ' plus naps in the same cycle' : ' (naps excluded)') + '; deviation as above.' });
  h += tileHTML('inbed', A, { type: 'MEASURED', formula: 'total_in_bed_time_milli divided by 3,600,000; deviation as above.' });
  // stages
  if (A.main && A.main.asleep != null) {
    const s = A.main, b = baselineAt(M, 'asleep', A.di, C.baselineDays), win = M.days.filter(d => d.okSleep && d.di >= A.di - C.baselineDays && d.di < A.di && d.main.asleep != null);
    const avg = k => win.length ? mean(win.map(d => d.main[k] || 0)) : null;
    const parts = [{ name: 'Light sleep', short: 'Light', ms: s.light }, { name: 'Slow wave', short: 'SWS', ms: s.sws }, { name: 'REM', short: 'REM', ms: s.rem }, { name: 'Awake in bed', short: 'Awake', ms: s.awake || 0 }];
    h += '<div class="tile" style="grid-column:1/-1"><div class="lab"><span>Sleep stages, last night</span>' + tag('MEASURED') + '</div>' + stagesBar(parts);
    if (win.length >= 5) { const at = avg('light') + avg('sws') + avg('rem') + avg('awake'); h += '<div class="sub">' + C.baselineDays + ' day average (n=' + win.length + ')</div>' + stagesBar([{ name: 'Light sleep', short: 'Light', ms: avg('light') }, { name: 'Slow wave', short: 'SWS', ms: avg('sws') }, { name: 'REM', short: 'REM', ms: avg('rem') }, { name: 'Awake in bed', short: 'Awake', ms: avg('awake') }]); }
    h += formula('each stage divided by total time in bed; ' + s.cycles + ' sleep cycles and ' + s.dist + ' disturbances recorded last night.') + '</div>';
  }
  // strain
  const L = M.lastDone, O = M.openDay;
  if (L) {
    const b = baselineAt(M, 'strain', L.di, C.baselineDays);
    h += '<div class="tile"><div class="lab"><span>strain, last completed day</span>' + tag('MEASURED') + '</div><div class="val">' + nf(L.strain, 1) + '<small>of 21</small></div><div class="dev">' + esc(fmtDayW(L.di)) + ', ' + nf(L.lenH, 1) + ' hour cycle' + (L.long ? '. Long cycle: left out of baselines.' : '.') + (b.n >= 5 ? ' ' + arrow(L.strain - b.mean) + ' ' + sign(L.strain - b.mean, 1) + ' vs ' + C.baselineDays + ' day mean ' + nf(b.mean, 1) + ' (n=' + b.n + '), ' + ord(pctRank(L.strain, b.vals)) + ' percentile.' : '') + '</div>' +
      formula('baseline = mean strain of completed, non long cycles in the ' + C.baselineDays + ' days before that day.') + '</div>';
  }
  if (O && O.strain != null) h += '<div class="tile"><div class="lab"><span>strain, open cycle so far</span>' + tag('MEASURED') + '</div><div class="val">' + nf(O.strain, 1) + '<small>partial</small></div><div class="dev">Cycle started ' + esc(fmtDayW(dIdx(O.start, O.o))) + ' ' + fmtClock(hourOfDay(O.start, O.o)) + '. ' + (O.steps != null ? O.steps.toLocaleString('en-US') + ' steps so far. ' : '') + 'Not comparable with completed days.</div>' + formula('copied from the cycle that has no end time yet.') + '</div>';
  // composite
  const comp = []; const rv = A.recovery, pf = A.main && A.main.perf, hb = baselineAt(M, 'hrv', A.di, C.baselineDays);
  if (isNum(rv)) comp.push({ n: 'recovery_score', v: rv, w: C.wR });
  if (isNum(pf)) comp.push({ n: 'sleep_performance_percentage', v: pf, w: C.wS });
  if (isNum(A.hrv) && hb.n >= 5 && hb.sd > 0) comp.push({ n: 'HRV score', v: clamp(50 + 25 * (A.hrv - hb.mean) / hb.sd, 0, 100), w: C.wH });
  const wsum = sum(comp.map(c => c.w));
  if (comp.length && wsum > 0) h += '<div class="tile"><div class="lab"><span>Composite readiness</span>' + tag('MODELED') + '</div><div class="val">' + nf(sum(comp.map(c => c.v * c.w)) / wsum, 0) + '<small>of 100</small></div><div class="dev">' + comp.map(c => esc(c.n) + ' ' + nf(c.v, 0) + ' at weight ' + c.w).join('; ') + '.</div>' +
    formula('(' + comp.map(c => c.w + ' x ' + c.n).join(' + ') + ') divided by ' + wsum + '. HRV score = 50 + 25 x (today HRV minus ' + C.baselineDays + ' day mean) divided by the ' + C.baselineDays + ' day standard deviation, kept between 0 and 100. Weights are controls. A display number, not an instruction.') + '</div>';
  h += '</div>';
  $('#todayBody').innerHTML = h;
}

/* ---------- trends ---------- */
function rolling(mk, from) {
  const pts = [], base = [], band = [];
  M.days.forEach(d => {
    if (d.di < from || !d.main) return;
    const v = incv(mk, d); pts.push([d.di, v]);
    const b = baselineAt(M, mk, d.di, C.baselineDays);
    if (b.n >= 7 && b.sd != null) { base.push([d.di, b.mean]); band.push([d.di, b.mean - C.bandSD * b.sd, b.mean + C.bandSD * b.sd]); } else { base.push([d.di, null]); band.push([d.di, null, null]); }
  });
  return { pts, base, band };
}
function roll7(mk, from, n) {
  const out = [];
  M.days.forEach(d => { if (d.di < from || !d.main) return; const v = valsIn(M, mk, d.di - n + 1, d.di); out.push([d.di, v.length >= Math.min(3, n) ? mean(v) : null]); });
  return out;
}

function renderTrends() {
  const from = rangeFrom(); let h = '<p class="sub">Last ' + C.chartDays + ' days. Normal band = rolling ' + C.baselineDays + ' day mean plus or minus ' + C.bandSD + ' standard deviation (controls). Hover or tap a point for its value.</p>';
  const trend = (mk, title, unitTxt) => {
    const r = rolling(mk, from), m = METRICS[mk];
    return '<h3>' + esc(m.label) + ' ' + tag('MEASURED') + ' ' + tag('MODELED') + '</h3>' + lineChart({ title: title, series: [{ label: m.label, pts: r.pts, unit: m.unit }, { label: 'rolling ' + C.baselineDays + ' day mean', pts: r.base, cls: 1, unit: m.unit }], band: r.band, bandLabel: 'mean plus or minus ' + C.bandSD + ' SD', yFmt: v => nf(v, m.dec) }) +
      formula('each day compared with the mean and standard deviation of the ' + C.baselineDays + ' days before it (needs at least 7 days). n=' + r.pts.filter(p => isNum(p[1])).length + ' days plotted.');
  };
  h += '<div class="grid g2"><div>' + trend('hrv', 'HRV with rolling baseline') + '</div><div>' + trend('rhr', 'Resting heart rate with rolling baseline') + '</div></div>';
  // recovery
  const rec = [], strainPts = [], flagged = [], sleepH = [], need = [];
  M.days.forEach(d => {
    if (d.di < from) return;
    if (d.main) { rec.push([d.di, incv('recovery', d)]); sleepH.push([d.di, incv('asleep', d)]); need.push([d.di, d.okSleep && d.main.need != null ? d.main.need / HOUR : null]); }
    if (d.strain != null) { if (d.okStrain) strainPts.push([d.di, d.strain]); else flagged.push([d.di, d.strain]); }
  });
  h += '<div class="grid g2"><div><h3>recovery_score ' + tag('MEASURED') + '</h3>' + lineChart({ title: 'Recovery score over time', y0: 0, y1: 100, series: [{ label: 'recovery_score', pts: rec, unit: '%' }, { label: '7 day mean', pts: roll7('recovery', from, 7), cls: 1, unit: '%' }], hlines: [{ y: C.bandHi, label: 'high band starts ' + C.bandHi }, { y: C.bandLo, label: 'mid band starts ' + C.bandLo }] }) +
    formula('7 day mean = average of the 7 days up to and including each day. Calibration days ' + (C.inclCalib ? 'included' : 'left out') + '. n=' + rec.filter(p => isNum(p[1])).length + '.') + '</div>';
  h += '<div><h3>strain by cycle ' + tag('MEASURED') + '</h3>' + lineChart({ title: 'Strain per completed cycle', y0: 0, y1: 21, series: [{ label: 'strain', pts: strainPts }, { label: '7 day mean', pts: roll7('strain', from, 7), cls: 1 }, { label: 'left out (open or long cycle)', pts: flagged, cls: 2 }] }) +
    formula('strain is WHOOP\'s 0 to 21 score for each cycle. Open cycles and cycles over ' + C.longH + ' hours are left out of means. n=' + strainPts.length + ' plotted, ' + flagged.length + ' left out.') + '</div></div>';
  h += '<h3>Sleep obtained vs sleep needed ' + tag('MEASURED') + '</h3>' + lineChart({ title: 'Hours asleep vs WHOOP sleep needed', series: [{ label: 'hours asleep' + (C.inclNaps ? ' (with naps)' : ''), pts: sleepH, unit: ' h' }, { label: 'WHOOP sleep needed', pts: need, cls: 1, unit: ' h' }], yFmt: v => nf(v, 1) }) +
    formula('hours asleep = light + slow wave + REM of the main sleep. Sleep needed = baseline_milli + need_from_sleep_debt_milli + need_from_recent_strain_milli + need_from_recent_nap_milli, divided by 3,600,000. A nap credit lowers the need on days after long naps.');
  $('#trendsBody').innerHTML = h;
}

/* ---------- sleep ---------- */
function renderSleep() {
  const A = M.anchorDay, from = rangeFrom(); let h = '';
  const dbt = sleepDebt(M, A.di), whoopDebt = A.main && A.main.debtNeed != null ? A.main.debtNeed / HOUR : null;
  h += '<div class="grid"><div class="tile"><div class="lab"><span>Sleep debt balance</span>' + tag('MODELED') + '</div>';
  if (dbt) {
    const b = dbt.balance;
    h += '<div class="val">' + nf(Math.abs(b), 1) + '<small>hours ' + (b > 0.05 ? 'of debt' : b < -0.05 ? 'of surplus' : 'even') + '</small></div><div class="dev">Over the last ' + dbt.n + ' nights ending ' + esc(fmtDay(A.di)) + '. WHOOP\'s own need_from_sleep_debt_milli last night: ' + (whoopDebt != null ? nf(whoopDebt, 1) + ' h' : 'not given') + '.</div>';
    h += formula('for each of the last ' + C.debtDays + ' nights: need (' + (C.debtNeed === 'baseline' ? 'baseline_milli, your baseline need' : 'full WHOOP need including strain and naps') + ') minus hours asleep' + (C.inclNaps ? ' including naps' : '') + '; then ' + (C.debtMode === 'net' ? 'add them up, so a long night pays back a short one' : 'add only the shortfalls, so a long night does not pay back a short one') + '. n=' + dbt.n + ' nights. Note sleep_performance_percentage cannot be reproduced from these fields, so WHOOP may count things differently.');
  } else h += '<div class="dev">Not enough sleep data to compute a balance.</div>';
  h += '</div></div>';
  const dp = []; M.days.forEach(d => { if (d.di >= from && d.main) { const x = sleepDebt(M, d.di); dp.push([d.di, x ? x.balance : null]); } });
  h += '<h3>Debt balance over time ' + tag('MODELED') + '</h3>' + lineChart({ title: 'Sleep debt balance over time', series: [{ label: 'balance in hours (above zero = debt)', pts: dp, unit: ' h' }], hlines: [{ y: 0, label: 'even' }], yFmt: v => nf(v, 1) }) + formula('same calculation, rolling over every night in range.');

  // bed and wake
  const bw = M.days.filter(d => d.okSleep && d.di >= from).map(d => { const b = hourOfDay(d.main.start, d.main.o); return { di: d.di, bed: b < 12 ? b + 24 : b, wake: hourOfDay(d.main.end, d.main.o) }; });
  const win = M.days.filter(d => d.okSleep && d.di >= A.di - C.baselineDays && d.di < A.di).map(d => { const b = hourOfDay(d.main.start, d.main.o); return { bed: b < 12 ? b + 24 : b, wake: hourOfDay(d.main.end, d.main.o) }; });
  h += '<h3>Bedtime and wake time consistency ' + tag('MODELED') + '</h3>';
  if (win.length >= 5) {
    const sb = sd(win.map(w => w.bed)) * 60, sw = sd(win.map(w => w.wake)) * 60, mb = mean(win.map(w => w.bed)), mw = mean(win.map(w => w.wake));
    h += '<div class="grid"><div class="tile"><div class="lab"><span>Typical bedtime</span></div><div class="val" style="font-size:26px">' + fmtClock(mb) + '</div><div class="dev">Spread (standard deviation) ' + nf(sb, 0) + ' minutes over ' + win.length + ' nights.</div></div>' +
      '<div class="tile"><div class="lab"><span>Typical wake time</span></div><div class="val" style="font-size:26px">' + fmtClock(mw) + '</div><div class="dev">Spread ' + nf(sw, 0) + ' minutes over ' + win.length + ' nights.</div></div></div>';
  }
  h += lineChart({ title: 'Bedtime and wake time', series: [{ label: 'bedtime', pts: bw.map(x => [x.di, x.bed]) }, { label: 'wake time', pts: bw.map(x => [x.di, x.wake]), cls: 1 }], yFmt: v => fmtClock(v) }) +
    formula('clock time of the start and end of each main sleep, in the time zone setting you chose. Bedtimes after midnight plot above 24. Spread = sample standard deviation over the ' + C.baselineDays + ' nights before today.');

  // naps
  const naps = []; M.days.forEach(d => d.naps.forEach(n => naps.push(n)));
  naps.sort((a, b) => b.start - a.start);
  h += '<h3>Naps ' + tag('MEASURED') + '</h3><p class="sub">' + naps.length + ' sleeps are flagged as naps in this file. ' + (C.inclNaps ? 'They are added to daily sleep totals.' : 'They are left out of daily sleep totals (control).') + '</p>';
  if (naps.length) {
    h += '<div class="scroll"><table><thead><tr><th>Date</th><th>Start</th><th class="n">In bed</th><th class="n">Asleep</th><th>Note</th></tr></thead><tbody>';
    naps.slice(0, 10).forEach(n => { const long = n.asleep != null && n.asleep >= 3 * HOUR; h += '<tr><td>' + esc(fmtDayW(dIdx(n.start, n.o))) + '</td><td>' + fmtClock(hourOfDay(n.start, n.o)) + '</td><td class="n">' + fmtHM((n.inBed || 0) / HOUR) + '</td><td class="n">' + fmtHM((n.asleep || 0) / HOUR) + '</td><td>' + (long ? 'long: may really be a main sleep' : '') + '</td></tr>'; });
    h += '</tbody></table></div><p class="f"><b>Why this matters:</b> WHOOP starts a new cycle only after a sleep it labels as a main sleep. A long sleep labeled as a nap stretches the day, which can distort strain and leave a morning without a recovery score.</p>';
  }
  $('#sleepBody').innerHTML = h;
}
