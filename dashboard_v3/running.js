/* Running history: every run on file (WHOOP plus the Strava history) over all time.
   Draws nothing unless there are at least 5 usable runs. Uses only M.runs, so it works with or without Strava. */

function rhStats() {
  const runs = (M.runs || []).filter(r => r.runOk && isNum(r.km) && r.km > 0).slice().sort((a, b) => a.di - b.di);
  if (runs.length < 5) return null;
  const cur = weekStart(M.anchor), first = weekStart(runs[0].di);
  const wk = {}, mo = {};
  runs.forEach(r => {
    const u = U.d(r.km), w = weekStart(r.di), dt = new Date(r.di * DAY), mk = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
    wk[w] = (wk[w] || 0) + u; mo[mk] = (mo[mk] || 0) + u;
  });
  const weeks = []; for (let w = first; w <= cur; w += 7) weeks.push({ ws: w, v: wk[w] || 0, partial: w === cur });
  const full = weeks.filter(w => !w.partial);
  const last4 = full.slice(-4), avg4 = last4.length ? sum(last4.map(w => w.v)) / last4.length : 0;
  let best4 = 0, best4At = null;
  for (let i = 0; i + 4 <= full.length; i++) { const a = sum(full.slice(i, i + 4).map(w => w.v)) / 4; if (a > best4) { best4 = a; best4At = full[i].ws; } }
  const lastRun = runs[runs.length - 1], gap = M.anchor - lastRun.di;
  const peak = full.reduce((b, w) => w.v > b.v ? w : b, { v: 0, ws: null });
  const lastFull = full.length ? full[full.length - 1].v : 0;
  const runWeeks = full.filter(w => w.v > 0).slice(-4), baseRun = runWeeks.length ? sum(runWeeks.map(w => w.v)) / runWeeks.length : 0;
  // weekly mileage ceiling: a cautious rule of thumb, not a prescription
  let ceil = null, mode = '';
  if (gap >= 21) { ceil = baseRun * 0.5; mode = 'rebuild'; }
  else { const ref = lastFull > 0 ? lastFull : avg4; ceil = ref * (1 + C.rampPct / 100); mode = 'build'; }
  if (peak.v > 0 && ceil > peak.v) ceil = peak.v;
  const cw = weeks[weeks.length - 1], thisWk = cw ? cw.v : 0;
  const rec28 = runs.filter(r => r.di > M.anchor - 28), longest28 = rec28.length ? Math.max.apply(null, rec28.map(r => U.d(r.km))) : 0;
  return { runs, weeks, full, mo, avg4, best4, best4At, lastRun, gap, peak, lastFull, ceil, mode, thisWk, longest28, baseRun };
}

function rhBreaks(runs) {
  const out = [];
  for (let i = 1; i < runs.length; i++) { const g = runs[i].di - runs[i - 1].di; if (g >= 30) out.push({ days: g, from: runs[i - 1].di, to: runs[i].di }); }
  return out;
}

function rhEfficiency(runs) {
  const q = {};
  runs.forEach(r => {
    const u = U.d(r.km); if (u < 2.5 || u > 4.5 || r.avgHR == null || r.beatsPer == null) return;
    const dt = new Date(r.di * DAY), k = dt.getUTCFullYear() * 4 + Math.floor(dt.getUTCMonth() / 3);
    (q[k] = q[k] || []).push(r);
  });
  return Object.keys(q).map(Number).sort((a, b) => a - b).map(k => {
    const a = q[k], y = Math.floor(k / 4);
    return { label: 'Q' + (k % 4 + 1) + ' ' + y, n: a.length, pace: mean(a.map(r => r.paceMin)), hr: mean(a.map(r => r.avgHR)), bpm: mean(a.map(r => r.beatsPer)) };
  });
}

function renderRunHist() {
  const s = rhStats(); if (!s) return '';
  const u = U.dU(), now = s.weeks[s.weeks.length - 1];
  let h = '';
  // tiles
  const tl = (lab, val, small, dev) => '<div class="tile"><div class="lab"><span>' + lab + '</span></div><div class="val">' + val + '<small>' + small + '</small></div><div class="dev">' + dev + '</div></div>';
  const total = sum(s.runs.map(r => U.d(r.km)));
  h += '<div class="grid">';
  h += tl('All time', nf(total, 0), u + ' in ' + s.runs.length + ' runs', 'Since ' + esc(fmtDay(s.runs[0].di)) + ' ' + new Date(s.runs[0].di * DAY).getUTCFullYear() + '.');
  h += tl('Last 4 full weeks', nf(s.avg4, 1), u + ' per week', s.best4 > 0 ? 'Your best 4 weeks averaged ' + nf(s.best4, 1) + ' ' + u + ' per week (from ' + esc(fmtDay(s.best4At)) + ').' : 'No earlier block to compare.');
  if (s.ceil > 0) {
    const left = Math.max(0, s.ceil - s.thisWk);
    h += tl('Cautious ceiling this week', nf(s.ceil, 0), u, (s.mode === 'rebuild' ? 'Coming back after ' + s.gap + ' days without a run: about half of your recent running weeks.' : 'Last full week plus ' + C.rampPct + ' percent, never above your best week.') + ' ' + nf(s.thisWk, 1) + ' so far this week, ' + nf(left, 1) + ' left.');
  } else h += tl('Days since last run', s.gap, 'days', 'Last run ' + esc(fmtDayW(s.lastRun.di)) + '.');
  h += '</div>';
  if (s.gap >= 21) h += '<p class="sub">' + s.gap + ' days since the last run. A break this long is a fresh start for your legs, so the ceiling is set to about half of what you were running before. One easy run at a time.</p>';
  if (s.longest28 > 0) h += '<p class="sub">Long run guide: stay near ' + nf(s.longest28 * 1.1, 1) + ' ' + u + ' or less (10 percent past your longest in the last 28 days, ' + nf(s.longest28, 1) + ').</p>';

  // weekly chart, last 26 weeks
  const w26 = s.weeks.slice(-26);
  h += '<h3>Weekly distance, last ' + w26.length + ' weeks</h3>' + barChart({ title: 'Weekly run distance, last ' + w26.length + ' weeks', unit: ' ' + u, legend: [{ i: 0, name: 'run distance in ' + u }],
    cats: w26.map(w => ({ label: fmtDay(w.ws), title: 'Week of ' + fmtDay(w.ws), parts: [{ i: 0, name: 'run distance', v: w.v }], partial: w.partial })) });

  // monthly chart, all time
  const keys = Object.keys(s.mo).map(Number), k0 = Math.min.apply(null, keys), dn = new Date(M.anchor * DAY), k1 = dn.getUTCFullYear() * 12 + dn.getUTCMonth();
  const mc = []; for (let k = k0; k <= k1; k++) { const y = Math.floor(k / 12), m = k % 12; mc.push({ label: MON[m] + ' ' + String(y).slice(2), title: MON[m] + ' ' + y, parts: [{ i: 0, name: 'run distance', v: s.mo[k] || 0 }], partial: k === k1 }); }
  h += '<h3>Month by month, all time</h3>' + barChart({ title: 'Monthly run distance, all time', unit: ' ' + u, cats: mc, legend: [{ i: 0, name: 'run distance in ' + u }] });

  // records
  const big = s.runs.reduce((b, r) => r.km > b.km ? r : b, s.runs[0]);
  const mk = Object.keys(s.mo).reduce((b, k) => s.mo[k] > s.mo[b] ? k : b, Object.keys(s.mo)[0]);
  const fast = s.runs.filter(r => U.d(r.km) >= 3 && r.paceMin).reduce((b, r) => !b || r.paceMin < b.paceMin ? r : b, null);
  const rec = [['Longest run', nf(U.d(big.km), 1) + ' ' + u, fmtDayW(big.di)], ['Biggest week', nf(s.peak.v, 1) + ' ' + u, 'week of ' + fmtDay(s.peak.ws)],
    ['Biggest month', nf(s.mo[mk], 1) + ' ' + u, MON[mk % 12] + ' ' + Math.floor(mk / 12)]];
  if (fast) rec.push(['Fastest pace (3 or more ' + u + ')', fmtPace(fast.paceMin) + ' per ' + u, fmtDayW(fast.di)]);
  h += '<h3>Records</h3><div class="scroll"><table><thead><tr><th>Mark</th><th class="n">Value</th><th>When</th></tr></thead><tbody>' + rec.map(r => '<tr><td>' + esc(r[0]) + '</td><td class="n">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>').join('') + '</tbody></table></div>';

  // breaks
  const br = rhBreaks(s.runs);
  h += '<h3>Breaks of 30 days or more</h3>';
  if (!br.length) h += '<p class="sub">None between your first and last run.</p>';
  else h += '<div class="scroll"><table><thead><tr><th>From</th><th>To</th><th class="n">Days</th></tr></thead><tbody>' + br.map(b => '<tr><td>' + esc(fmtDayW(b.from)) + '</td><td>' + esc(fmtDayW(b.to)) + '</td><td class="n">' + b.days + '</td></tr>').join('') + '</tbody></table></div>' +
    '<p class="sub">' + br.length + ' in all. What you did after each one is the best guide to how fast you can come back.</p>';

  // aerobic efficiency by quarter
  const ef = rhEfficiency(s.runs).filter(r => r.n >= 3);
  if (ef.length >= 2) {
    const lo = Math.min.apply(null, ef.map(r => r.bpm));
    h += '<h3>Heartbeats per ' + u + ', by quarter ' + tag('MODELED') + '</h3><div class="scroll"><table><thead><tr><th>Quarter</th><th class="n">Runs</th><th class="n">Pace per ' + u + '</th><th class="n">Avg HR</th><th class="n">Beats per ' + u + '</th></tr></thead><tbody>' +
      ef.map(r => '<tr><td>' + esc(r.label) + (r.bpm === lo ? ' (lowest)' : '') + '</td><td class="n">' + r.n + '</td><td class="n">' + fmtPace(r.pace) + '</td><td class="n">' + nf(r.hr, 0) + '</td><td class="n">' + nf(r.bpm, 0) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  // shoes
  const gear = {};
  s.runs.forEach(r => { const g = r.gear || ''; gear[g] = gear[g] || { km: 0, n: 0 }; gear[g].km += U.d(r.km); gear[g].n++; });
  const gk = Object.keys(gear).filter(k => k);
  if (gk.length) {
    h += '<h3>Shoes</h3><div class="scroll"><table><thead><tr><th>Pair</th><th class="n">Runs</th><th class="n">' + u + '</th></tr></thead><tbody>' +
      gk.sort((a, b) => gear[b].km - gear[a].km).map(k => '<tr><td>' + esc(k) + '</td><td class="n">' + gear[k].n + '</td><td class="n">' + nf(gear[k].km, 0) + '</td></tr>').join('') +
      (gear[''] ? '<tr><td>No pair logged</td><td class="n">' + gear[''].n + '</td><td class="n">' + nf(gear[''].km, 0) + '</td></tr>' : '') + '</tbody></table></div>';
  }

  const hist = s.runs.filter(r => r.hist).length;
  h += formula('runs with a plausible speed (' + C.runMinKmh + ' to ' + C.runMaxKmh + ' km/h), ' + s.runs.length + ' in all' + (hist ? ', ' + hist + ' of them from your Strava history, which has distance and average heart rate but no heart rate zones' : '') + '. The ceiling is last full week times ' + (1 + C.rampPct / 100).toFixed(2) + ', capped at your best week; after 21 or more days without a run it is half the average of your last 4 running weeks. It is a cautious rule of thumb, not a proven limit: in a study of 874 novice runners, jumping weekly distance by more than 30 percent had a higher rate of distance related injuries than staying under 10 percent, but the difference was not statistically significant. Sleep, soreness and past injuries matter more than the number. Quarters with fewer than 3 matching runs (2.5 to 4.5 ' + u + ') are left out, and heat, hills and pace change heartbeats per ' + u + '.');
  return gFold('runhist', 'Running history', 'MEASURED', h, true);
}
