/* ---------- sections: training and drivers ---------- */
const zoneIdx = () => [1, 2, 3, 4, 5].filter(k => C['z' + k]);
const zoneLabel = () => { const z = zoneIdx(); return z.length ? 'zone ' + z.join(', ') : 'no zones selected'; };
const wZoneMin = w => w.zones ? sum(zoneIdx().map(k => w.zones[k])) / MINUTE : 0;
const isLift = w => w.sport === 'weightlifting';

function verdictCell(r) {
  if (r.rho == null) return '<span class="muted">not enough pairs (n=' + r.n + ')</span>';
  if (r.n < C.minN) return '<span class="warn">too early to trust (n=' + r.n + ' is under ' + C.minN + ')</span>';
  const dir = r.rho > 0 ? 'positive' : 'negative';
  return r.p < 0.05 ? strengthWord(r.rho) + ' ' + dir + ' link' : 'no clear link';
}

function renderTraining() {
  let h = '';
  const nW = Math.max(4, Math.min(16, Math.round(C.chartDays / 7))), wt = weeklyTable(M, nW);
  const first = M.days[0].di;
  const shown = wt.filter(w => w.we >= first);
  const wlabel = w => fmtDay(w.ws);

  // workouts per week by sport
  const counts = {}; shown.forEach(w => w.workouts.forEach(x => { counts[x.sport] = (counts[x.sport] || 0) + 1; }));
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 4), hasOther = Object.keys(counts).length > 4;
  const cats = shown.map(w => {
    const parts = top.map((s, i) => ({ i, name: sportName(s), v: w.workouts.filter(x => x.sport === s).length }));
    if (hasOther) parts.push({ i: 4, name: 'other', v: w.workouts.filter(x => !top.includes(x.sport)).length });
    return { label: wlabel(w), title: 'Week of ' + fmtDay(w.ws), parts, partial: w.partial };
  });
  const legend = top.map((s, i) => ({ i, name: sportName(s) })); if (hasOther) legend.push({ i: 4, name: 'other' });
  h += '<h3>Sessions per week by sport ' + tag('MEASURED') + '</h3>' + barChart({ title: 'Workouts per week by sport', cats, legend, unit: ' sessions' }) +
    formula('count of workouts whose start date falls in each Monday to Sunday week (' + (shown.length ? 'n=' + sum(shown.map(w => w.workouts.length)) + ' sessions over ' + shown.length + ' weeks' : 'no weeks') + '). Includes sauna, stretching and other non training entries as logged by WHOOP.');

  // mean daily strain per week
  const sPts = shown.map(w => { const v = M.days.filter(d => d.di >= w.ws && d.di <= w.we && d.okStrain).map(d => d.strain); return [w.ws, v.length >= 3 ? mean(v) : null, v.length]; });
  h += '<div class="grid g2"><div><h3>Mean daily strain per week ' + tag('MEASURED') + '</h3>' + lineChart({ title: 'Mean daily strain per week', y0: 0, y1: 21, maxGap: 8, series: [{ label: 'mean strain', pts: sPts.map(p => [p[0], p[1]]) }] }) +
    formula('mean strain of completed, non long cycles in each week; weeks with fewer than 3 such days are left blank. Days per point: ' + sPts.map(p => p[2]).join(', ') + '.') + '</div>';

  // zone minutes
  const zcats = shown.map(w => ({ label: wlabel(w), title: 'Week of ' + fmtDay(w.ws), parts: [{ i: 0, name: zoneLabel(), v: sum(w.workouts.map(wZoneMin)) }], partial: w.partial }));
  h += '<div><h3>Minutes in ' + esc(zoneLabel()) + ' per week ' + tag('MEASURED') + '</h3>' + barChart({ title: 'Weekly minutes in selected heart rate zones', cats: zcats, unit: ' min', legend: [{ i: 0, name: zoneLabel() }] }) +
    formula('sum of zone_two_milli (and any other zones you tick in Controls) across scored workouts, divided by 60,000. Only time inside a logged workout counts, so easy walking outside workouts is not here. WHOOP zones are percentages of max heart rate; whether zone 2 here matches your lab zone 2 is not verified.') + '</div></div>';

  // consistency and gaps
  const lifts = M.workouts.filter(isLift), runs = M.runs;
  const gapOf = arr => arr.length ? M.anchor - Math.max(...arr.map(w => w.di)) : null;
  const gl = gapOf(lifts), gr = gapOf(runs);
  const liftWeeks = shown.filter(w => !w.partial).map(w => w.workouts.filter(isLift).length);
  const hit = liftWeeks.filter(n => n >= C.liftWeekMin).length;
  h += '<h3>Consistency ' + tag('MEASURED') + '</h3><div class="grid">';
  h += '<div class="tile"><div class="lab"><span>Days since last lift</span></div><div class="val">' + (gl == null ? 'none' : gl) + '<small>' + (gl != null && gl >= C.gapLift ? 'over your ' + C.gapLift + ' day alert' : 'days') + '</small></div><div class="dev">' + (lifts.length ? 'Last: ' + esc(fmtDayW(Math.max(...lifts.map(w => w.di)))) + '. ' + lifts.length + ' lifts on file.' : 'No weightlifting workouts on file.') + '</div></div>';
  h += '<div class="tile"><div class="lab"><span>Days since last run</span></div><div class="val">' + (gr == null ? 'none' : gr) + '<small>' + (gr != null && gr >= C.gapRun ? 'over your ' + C.gapRun + ' day alert' : 'days') + '</small></div><div class="dev">' + (runs.length ? 'Last: ' + esc(fmtDayW(Math.max(...runs.map(w => w.di)))) + '. ' + runs.length + ' runs on file.' : 'No runs on file.') + '</div></div>';
  h += '<div class="tile"><div class="lab"><span>Weeks with ' + C.liftWeekMin + ' or more lifts</span></div><div class="val">' + hit + '<small>of ' + liftWeeks.length + ' full weeks</small></div><div class="dev">Weeks shown above, current week excluded because it is not over.</div></div></div>';
  h += formula('days since = latest wake date in the data minus the date of the latest workout of that sport. Alert lengths and the weekly lift minimum are controls, not recommendations.');

  // heatmap
  const hm = wt.slice(-12);
  h += '<h3>Training calendar ' + tag('MEASURED') + '</h3><div class="scroll"><table class="heat" aria-label="Workouts by day, last 12 weeks"><thead><tr><th>Week of</th>' + WKD.map(x => '<th>' + x + '</th>').join('') + '</tr></thead><tbody>';
  hm.forEach(w => {
    h += '<tr><th scope="row">' + esc(fmtDay(w.ws)) + '</th>';
    for (let k = 0; k < 7; k++) {
      const di = w.ws + k, ws = M.workouts.filter(x => x.di === di);
      if (di > M.anchor || di < first) { h += '<td></td>'; continue; }
      const letters = [...new Set(ws.map(x => SPORT_ICON[x.sport] || '?'))].join('');
      h += '<td' + (ws.length ? ' class="has"' : '') + ' title="' + esc(fmtDayW(di) + ': ' + (ws.length ? ws.map(x => sportName(x.sport)).join(', ') : 'no workout')) + '">' + (letters || '·') + '</td>';
    }
    h += '</tr>';
  });
  const keys = [...new Set(M.workouts.map(w => w.sport))].map(s => (SPORT_ICON[s] || '?') + ' = ' + sportName(s));
  h += '</tbody></table></div><p class="f">Key: ' + esc(keys.join(', ')) + '. A dot means no workout that day.</p>';

  // running
  h += '<h3>Running ' + tag('MEASURED') + ' ' + tag('MODELED') + '</h3>';
  if (!runs.length) h += '<p class="muted">No runs on file.</p>';
  else {
    const bad = runs.filter(r => !r.runOk), ok = runs.filter(r => r.runOk);
    h += '<p class="sub">' + runs.length + ' runs on file, ' + ok.length + ' with usable distance, ' + bad.length + ' set aside.</p>';
    const rw = wt.slice(-8).map(w => { const rr = w.workouts.filter(x => x.runOk); return { w, km: sum(rr.map(x => U.d(x.km))), n: rr.length }; });
    const rcats = rw.map(r => ({ label: fmtDay(r.w.ws), title: 'Week of ' + fmtDay(r.w.ws), parts: [{ i: 0, name: 'run distance', v: r.km }], partial: r.w.partial }));
    h += barChart({ title: 'Weekly run distance', cats: rcats, unit: ' ' + U.dU(), legend: [{ i: 0, name: 'run distance in ' + U.dU() }] });
    h += '<div class="scroll"><table><thead><tr><th>Week of</th><th class="n">Runs</th><th class="n">Distance (' + U.dU() + ')</th><th class="n">Change vs prior week</th><th>Note</th></tr></thead><tbody>';
    rw.forEach((r, i) => {
      const p = rw[i - 1]; let ch = '', note = '';
      if (p && p.km > 0) { const pc = (r.km - p.km) / p.km * 100; ch = (pc >= 0 ? 'up ' : 'down ') + nf(Math.abs(pc), 0) + '%'; if (!r.w.partial && pc > C.rampPct) note = 'above the ' + C.rampPct + '% rule of thumb'; else if (r.w.partial) note = 'week in progress'; }
      h += '<tr><td>' + esc(fmtDay(r.w.ws)) + '</td><td class="n">' + r.n + '</td><td class="n">' + nf(r.km, 1) + '</td><td class="n">' + ch + '</td><td>' + note + '</td></tr>';
    });
    h += '</tbody></table></div>' + formula('distance_meter of runs with a plausible implied speed, converted to ' + U.dU() + '. The ' + C.rampPct + '% weekly ramp line is a widely repeated rule of thumb, not a proven limit, and your hip, knee and ankle history matters more than any percentage.');
    if (bad.length) h += '<details><summary>' + bad.length + ' run(s) set aside</summary><div class="scroll"><table><thead><tr><th>Date</th><th>Reason</th></tr></thead><tbody>' + bad.slice(-12).map(r => '<tr><td>' + esc(fmtDayW(r.di)) + '</td><td>' + esc(r.runWhy) + '</td></tr>').join('') + '</tbody></table></div><p class="f">Valid speed range is a control (' + C.runMinKmh + ' to ' + C.runMaxKmh + ' km/h).</p></details>';
    if (ok.length) {
      h += '<details open><summary>Recent valid runs</summary><div class="scroll"><table><thead><tr><th>Date</th><th class="n">' + U.dU() + '</th><th class="n">Time</th><th class="n">Pace per ' + U.dU() + '</th><th class="n">Avg HR</th><th class="n">Strain</th></tr></thead><tbody>' +
        ok.slice(-10).reverse().map(r => '<tr><td>' + esc(fmtDayW(r.di)) + '</td><td class="n">' + nf(U.d(r.km), 2) + '</td><td class="n">' + fmtHM(r.durMin / 60) + '</td><td class="n">' + fmtPace(r.paceMin) + '</td><td class="n">' + (r.avgHR != null ? r.avgHR : '') + '</td><td class="n">' + nf(r.strain, 1) + '</td></tr>').join('') + '</tbody></table></div></details>';
    }
  }

  // workout log by sport
  const bySport = {}; M.workouts.forEach(w => { (bySport[w.sport] = bySport[w.sport] || []).push(w); });
  const sports = Object.keys(bySport).sort((a, b) => bySport[b].length - bySport[a].length);
  const allRec = M.days.filter(d => d.okRec).map(d => d.recovery), baseRec = mean(allRec);
  h += '<h3>Workout log by sport ' + tag('MEASURED') + '</h3><div class="scroll"><table><thead><tr><th>Sport</th><th class="n">Sessions</th><th class="n">Mean minutes</th><th class="n">Mean strain (n scored)</th><th class="n">Next morning recovery (n)</th><th>Reading</th></tr></thead><tbody>';
  sports.forEach(s => {
    const ws = bySport[s], sc = ws.filter(w => w.strain != null), nr = ws.map(w => nextRecovery(M, w.end)).filter(Boolean).map(d => d.recovery);
    let rd = '';
    if (nr.length < C.minN) rd = '<span class="warn">too early to trust</span>';
    else { const d = mean(nr) - baseRec; rd = Math.abs(d) < 3 ? 'near your overall mean' : (d > 0 ? 'above' : 'below') + ' your overall mean by ' + nf(Math.abs(d), 0); }
    h += '<tr><td>' + esc(sportName(s)) + '</td><td class="n">' + ws.length + '</td><td class="n">' + nf(mean(ws.map(w => w.durMin)), 0) + '</td><td class="n">' + (sc.length ? nf(mean(sc.map(w => w.strain)), 1) + ' (' + sc.length + ')' : 'not scored') + '</td><td class="n">' + (nr.length ? nf(mean(nr), 0) + ' (' + nr.length + ')' : '') + '</td><td>' + rd + '</td></tr>';
  });
  h += '</tbody></table></div>' + formula('next morning recovery = recovery_score of the first main sleep that starts within 36 hours after the workout ends. Overall mean recovery ' + nf(baseRec, 0) + ' (n=' + allRec.length + '). Sessions that WHOOP does not score (sauna, stretching, relaxation) show "not scored". This shows what usually follows a session, not that the session caused it.');

  // recent workouts strain
  const rec = M.workouts.filter(w => w.strain != null).slice(-14).reverse();
  if (rec.length) h += '<h3>Strain per workout, recent ' + tag('MEASURED') + '</h3><div class="scroll"><table><thead><tr><th>Date</th><th>Sport</th><th class="n">Minutes</th><th class="n">Strain</th><th class="n">Avg HR</th><th class="n">Max HR</th><th class="n">Recorded</th></tr></thead><tbody>' +
    rec.map(w => '<tr><td>' + esc(fmtDayW(w.di)) + '</td><td>' + esc(sportName(w.sport)) + '</td><td class="n">' + nf(w.durMin, 0) + '</td><td class="n">' + nf(w.strain, 1) + '</td><td class="n">' + (w.avgHR != null ? w.avgHR : '') + '</td><td class="n">' + (w.maxHR != null ? w.maxHR : '') + '</td><td class="n">' + (w.pct != null ? nf(w.pct, 0) + '%' : '') + '</td></tr>').join('') + '</tbody></table></div>' + formula('values as given by WHOOP in each workout score. "Recorded" is percent_recorded, the share of the workout with heart rate data.');
  $('#trainBody').innerHTML = h;
}

/* ---------- drivers ---------- */
function acuteChronic(di) {
  const a = valsIn(M, 'strain', di - 6, di), c = valsIn(M, 'strain', di - 27, di);
  if (a.length < 4 || c.length < 14) return null;
  const cm = mean(c); return cm > 0 ? { ratio: mean(a) / cm, a: mean(a), c: cm, na: a.length, nc: c.length } : null;
}

function renderDrivers() {
  let h = '<p class="sub">These are patterns in your own data, not proof of cause. With many factors tested, a few will look meaningful by chance. Anything under n=' + C.minN + ' is marked too early to trust.</p>';
  const recDays = M.days.filter(d => d.okRec && d.main);
  const zmin = d => sum(d.workouts.map(wZoneMin));
  const F = [
    ['Strain of the cycle before', d => d.prev && d.prev.okStrain ? d.prev.strain : null],
    ['Lifted in the cycle before (1 yes, 0 no)', d => d.prev ? (d.prev.workouts.some(isLift) ? 1 : 0) : null],
    ['Ran in the cycle before (1 yes, 0 no)', d => d.prev ? (d.prev.workouts.some(w => w.sport === 'running') ? 1 : 0) : null],
    ['Steps in the cycle before', d => d.prev && d.prev.okStrain ? d.prev.steps : null],
    ['Minutes in ' + zoneLabel() + ' before', d => d.prev ? zmin(d.prev) : null],
    ['Hours asleep that night', d => d.okSleep && d.main.asleep != null ? d.main.asleep / HOUR : null],
    ['Sleep consistency percentage', d => d.okSleep ? d.main.cons : null],
    ['Sleep performance percentage', d => d.okSleep ? d.main.perf : null],
    ['Bedtime (hour, after midnight above 24)', d => { if (!d.okSleep) return null; const b = hourOfDay(d.main.start, d.main.o); return b < 12 ? b + 24 : b; }],
    ['Disturbances during sleep', d => d.okSleep ? d.main.dist : null],
    ['Respiratory rate that night', d => d.okSleep ? d.main.resp : null]
  ];
  const rows = F.map(f => ({ name: f[0], r: spearman(recDays.map(d => [f[1](d), d.recovery])), h: spearman(recDays.map(d => [f[1](d), d.hrv])) }));
  rows.sort((a, b) => Math.abs(b.r.rho || 0) - Math.abs(a.r.rho || 0));
  h += '<h3>What moves my recovery and HRV ' + tag('MODELED') + '</h3><div class="scroll"><table><thead><tr><th>Factor</th><th class="n">vs recovery (n, rho, p)</th><th>Reading</th><th class="n">vs HRV (n, rho, p)</th><th>Reading</th></tr></thead><tbody>';
  const cell = r => r.rho == null ? 'n=' + r.n : 'n=' + r.n + ', ' + nf(r.rho, 2) + ', ' + (r.p < 0.001 ? '&lt;0.001' : nf(r.p, 3));
  rows.forEach(x => { h += '<tr><td>' + esc(x.name) + '</td><td class="n">' + cell(x.r) + '</td><td>' + verdictCell(x.r) + '</td><td class="n">' + cell(x.h) + '</td><td>' + verdictCell(x.h) + '</td></tr>'; });
  h += '</tbody></table></div>' + formula('Spearman rank correlation (rho, from negative 1 to 1) between the factor and the same morning\'s recovery_score or hrv_rmssd_milli. p is an approximation using the Fisher transform and is not corrected for testing ' + F.length + ' factors. "Before" factors come from the cycle that ended when that sleep began. Rows are sorted by strength against recovery.');

  // consistency vs hrv
  h += '<div class="grid g2"><div><h3>Sleep consistency vs HRV ' + tag('MODELED') + '</h3>' +
    scatter({ title: 'Sleep consistency against HRV', pts: recDays.filter(d => d.okSleep && d.main.cons != null && d.hrv != null).map(d => ({ x: d.main.cons, y: d.hrv, t: fmtDay(d.di) + ': consistency ' + d.main.cons + '%, HRV ' + nf(d.hrv, 1) + ' ms' })), xLabel: 'sleep_consistency_percentage', yLabel: 'hrv_rmssd_milli (ms)', yFmt: v => nf(v, 0) }) +
    formula('one dot per morning; dashed line is an ordinary least squares fit, shown for direction only. See the table above for rho and n.') + '</div>';

  // running efficiency
  const ok = M.runs.filter(r => r.runOk && r.avgHR != null);
  h += '<div><h3>Running efficiency ' + tag('MODELED') + '</h3>';
  if (ok.length < 3) h += '<p class="muted">Needs at least 3 valid runs with heart rate (n=' + ok.length + ').</p>';
  else {
    h += scatter({ title: 'Pace against average heart rate', pts: ok.map(r => ({ x: r.paceMin, y: r.avgHR, t: fmtDay(r.di) + ': ' + fmtPace(r.paceMin) + ' per ' + U.dU() + ', ' + r.avgHR + ' bpm' })), xLabel: 'pace, minutes per ' + U.dU() + ' (lower is faster)', yLabel: 'average_heart_rate (bpm)', xFmt: v => fmtPace(v), yFmt: v => nf(v, 0) });
    h += lineChart({ title: 'Heartbeats per distance over time', h: 180, maxGap: 60, series: [{ label: 'heartbeats per ' + U.dU(), pts: ok.map(r => [r.di, r.beatsPer]), unit: '' }], yFmt: v => nf(v, 0) });
    h += formula('heartbeats per ' + U.dU() + ' = average_heart_rate x minutes run divided by distance in ' + U.dU() + '. Fewer beats for the same distance means a more efficient run, but heat, hills, fatigue and pace change it, so compare runs at similar effort. n=' + ok.length + ' runs.');
  }
  h += '</div></div>';

  // weekday vs weekend
  const wk = (mk, wkend) => M.days.filter(d => (wkdOf(d.di) >= 5) === wkend).map(d => incv(mk, d)).filter(v => v != null);
  h += '<h3>Weekday vs weekend ' + tag('MEASURED') + '</h3><div class="scroll"><table><thead><tr><th>Measure</th><th class="n">Weekdays mean (n)</th><th class="n">Weekends mean (n)</th><th class="n">Difference</th></tr></thead><tbody>';
  ['recovery', 'hrv', 'rhr', 'asleep', 'cons', 'strain'].forEach(mk => {
    const a = wk(mk, false), b = wk(mk, true), m = METRICS[mk]; if (!a.length || !b.length) return;
    h += '<tr><td>' + esc(m.label) + '</td><td class="n">' + nf(mean(a), m.dec) + ' (' + a.length + ')</td><td class="n">' + nf(mean(b), m.dec) + ' (' + b.length + ')</td><td class="n">' + (mean(b) - mean(a) >= 0 ? 'up ' : 'down ') + nf(Math.abs(mean(b) - mean(a)), m.dec) + (Math.min(a.length, b.length) < C.minN ? ' <span class="warn">(too early to trust)</span>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div>' + formula('days grouped by wake date; Saturday and Sunday are weekend. Difference = weekend mean minus weekday mean.');

  // acute chronic
  const cur = acuteChronic(M.lastDone ? M.lastDone.di : M.anchor);
  h += '<h3>Recent load vs usual load ' + tag('MODELED') + '</h3>';
  if (!cur) h += '<p class="muted">Needs at least 4 completed days in the last 7 and 14 in the last 28.</p>';
  else {
    h += '<div class="grid"><div class="tile"><div class="lab"><span>Acute to chronic strain ratio</span></div><div class="val">' + nf(cur.ratio, 2) + '</div><div class="dev">Last 7 days mean strain ' + nf(cur.a, 1) + ' (n=' + cur.na + ') against the last 28 days ' + nf(cur.c, 1) + ' (n=' + cur.nc + ').</div></div></div>';
    const pts = []; M.days.forEach(d => { if (d.di >= rangeFrom() && !d.open) { const x = acuteChronic(d.di); pts.push([d.di, x ? x.ratio : null]); } });
    h += lineChart({ title: 'Acute to chronic strain ratio', h: 190, series: [{ label: 'ratio of 7 day to 28 day mean strain', pts }], hlines: [{ y: 1, label: 'equal' }], yFmt: v => nf(v, 2) });
    const pairs = []; M.days.forEach(d => { if (d.open) return; const x = acuteChronic(d.di); if (!x) return; const nxt = valsIn(M, 'recovery', d.di + 1, d.di + 7); if (nxt.length >= 4) pairs.push([x.ratio, mean(nxt)]); });
    const sp = spearman(pairs);
    h += '<p>Ratio against the average recovery over the next 7 days: ' + (sp.rho == null ? 'not enough pairs (n=' + sp.n + ')' : 'n=' + sp.n + ', rho ' + nf(sp.rho, 2) + ', p ' + (sp.p < 0.001 ? '&lt;0.001' : nf(sp.p, 3)) + '. ' + verdictCell(sp)) + '</p>';
    h += formula('ratio = mean strain of the last 7 completed days divided by mean strain of the last 28. Ratios in team sport research are often discussed around 0.8 to 1.3; that is a rule of thumb from other populations and is not validated for you. Overlapping windows make the p value optimistic.');
  }
  $('#driversBody').innerHTML = h;
}
