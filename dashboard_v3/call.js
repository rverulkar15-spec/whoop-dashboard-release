/* ---------- Today's call, tonight's bedtime and your levers (MODELED from your own history) ---------- */

function cQuant(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
}
function cBand(v) { return v >= C.bandHi ? 'high' : v >= C.bandLo ? 'mid' : 'low'; }

// strain you usually land on, on days with this recovery band (last 90 days, finished cycles)
function callStrainRange(band) {
  const xs = M.days.filter(d => d.okRec && d.okStrain && isNum(d.recovery) && d.di >= M.anchor - 89 && d.di < M.anchor && cBand(d.recovery) === band).map(d => d.strain);
  if (xs.length < 8) return null;
  return { lo: cQuant(xs, 0.5), hi: cQuant(xs, 0.75), n: xs.length };
}

// when to be in bed tonight (clock hours, may be below 0 or above 24)
function callBedtime() {
  const mains = M.days.filter(d => d.main && d.okSleep && d.di >= M.anchor - 13);
  if (mains.length < 5) return null;
  const wake = median(mains.map(d => hourOfDay(d.main.end, d.main.o)));
  const needs = M.days.filter(d => d.main && d.main.need != null && d.di >= M.anchor - 6).map(d => d.main.need / HOUR);
  const needH = needs.length >= 3 ? mean(needs) : C.goalSleep;
  const asl = sum(mains.map(d => d.main.asleep || 0)), bed = sum(mains.map(d => d.main.inBed || 0));
  const ratio = bed > 0 ? clamp(asl / bed, 0.7, 1) : 0.88;
  const inBedH = needH / ratio;
  return { wake, needH, ratio, inBedH, bed: wake - inBedH, fromWhoop: needs.length >= 3 };
}

function todaysCall() {
  const A = M.anchorDay; if (!A) return '';
  const W = seasonWarning();
  const todayDi = dIdx(Date.now(), A.o), lag = todayDi - M.anchor;
  const rec = A.okRec && isNum(A.recovery) ? A.recovery : null, band = rec == null ? null : cBand(rec), b = rec == null ? null : bandOf(rec);
  const ws = weekStart(M.anchor), we = ws + 6, daysLeft = we - M.anchor + 1;
  const inW = M.workouts.filter(w => w.di >= ws && w.di <= we && w.scored);
  const lifts = inW.filter(w => w.sport === 'weightlifting').length, need = Math.max(0, C.liftWeekMin - lifts);
  const liftedToday = M.workouts.some(w => w.di === M.anchor && w.scored && w.sport === 'weightlifting');
  const z2 = sum(inW.map(wZoneMin));
  const flag = W && W.sig.length >= 2;
  const lines = [];
  let gl = null;       // program aware lifting lines, when a MacroFactor log is loaded
  if (rec != null && !flag && typeof gymCallLines === 'function') { try { gl = gymCallLines(band, M.anchor, liftedToday); } catch (e) { console.error('gym call', e); } }

  let head, cls;
  if (rec == null) { head = 'Recovery is not scored yet'; cls = 'flat'; lines.push('Wear the strap while you sleep and check back after you wake up. The call fills in once WHOOP scores the night.'); }
  else if (flag) { head = 'Go easy today'; cls = 'low'; lines.push('Early warning is up (' + esc(W.sig.join(', ')) + '). Keep it to walking, mobility or an easy session, and protect tonight\'s sleep.'); }
  else if (band === 'high') {
    head = 'Green light, push today'; cls = 'high';
    if (gl) gl.forEach(x => lines.push(x));
    else if (liftedToday) lines.push('You already lifted today. Anything more can be easy zone work.');
    else if (need > 0 && daysLeft >= need) lines.push('Lift today. You have ' + lifts + ' of ' + C.liftWeekMin + ' lifts this week and ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left including today' + (daysLeft === need ? ', so every day counts' : '') + '.');
    else if (need > 0) lines.push('You have ' + lifts + ' of ' + C.liftWeekMin + ' lifts this week and not enough days left to finish. Lift anyway and reset next week.');
    else lines.push('Lift target is done for the week. A good day for zone 2 or a run' + (z2 < C.goalZ2 ? ' (' + nf(z2, 0) + ' of ' + C.goalZ2 + ' zone minutes so far)' : '') + '.');
  } else if (band === 'mid') {
    head = 'Solid day, train but do not max out'; cls = 'mid';
    if (gl) gl.forEach(x => lines.push(x));
    else if (liftedToday) lines.push('You already lifted today. Keep the rest easy.');
    else if (need > 0 && daysLeft >= need) lines.push('A lift is fine (' + lifts + ' of ' + C.liftWeekMin + ' this week, ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left). Leave a rep or two in reserve.');
    else lines.push('Moderate work is fine today. Save the hard effort for a green morning.');
  } else {
    head = 'Recovery day'; cls = 'low';
    if (gl) { lines.push('Walk, mobility or sauna are the better use of today.'); gl.forEach(x => lines.push(x)); }
    else lines.push('Walk, mobility or sauna.' + (need > 0 && daysLeft - 1 >= need ? ' Lifting can wait: you still have ' + (daysLeft - 1) + ' more days to reach ' + C.liftWeekMin + ' lifts.' : ' Hard lifting can wait a day.'));
  }
  if (gl && gl.head) head = gl.head;
  if (rec != null) {
    const sr = callStrainRange(band);
    if (sr && !flag && band !== 'low') lines.push('On ' + (band === 'high' ? 'green' : band === 'mid' ? 'yellow' : 'red') + ' days you usually finish at strain ' + nf(sr.lo, 1) + ' to ' + nf(sr.hi, 1) + ' (middle to upper half, ' + sr.n + ' days).');
  }
  const bt = callBedtime();
  if (bt) lines.push('Tonight: be in bed by <b>' + esc(fmtClock(bt.bed)) + '</b>. That gives you about ' + nf(bt.needH, 1) + ' h asleep at your usual wake time of ' + esc(fmtClock(bt.wake)) + '.');

  let h = '<section class="card callcard"><div class="sec-h"><h2>Today\'s call</h2>' + tag('MODELED') + '</div>';
  if (lag > 0) h += '<p class="sub">Latest data is from ' + esc(fmtDayW(M.anchor)) + ', so this is that morning\'s call. Refresh to bring it up to date.</p>';
  h += '<div class="callhead"><span class="dot ' + cls + '"></span><div><b>' + esc(head) + '</b>' + (rec != null ? '<small>Recovery ' + nf(rec, 0) + '%, ' + esc(b.name.toLowerCase()) + '</small>' : '') + '</div></div>';
  h += '<ul class="calllist">' + lines.map(l => '<li>' + l + '</li>').join('') + '</ul>';
  h += '<details class="fm"><summary>How this is worked out</summary>' + formula('The training line uses your recovery band (high ' + C.bandHi + ' and up, low under ' + C.bandLo + '), your early warning flag and your weekly lift target. The strain range is the 50th to 75th percentile of strain on your own days in that band over the last 90 days. Bedtime = usual wake time (median of 14 days) minus hours in bed needed, where hours in bed = ' + (bt && bt.fromWhoop ? 'WHOOP sleep needed averaged over the last 7 nights' : 'your sleep goal') + ' divided by the share of time in bed you actually sleep' + (bt ? ' (' + nf(bt.ratio * 100, 0) + '%)' : '') + '. General fitness guidance from your own history, not medical advice.') + '</details>';
  return h + '</section>';
}

// split days at the median of a driver; compare mean recovery above vs below
function leverSplit(label, unit, getX, fmtX, hint) {
  const rows = M.days.filter(d => d.okRec && isNum(d.recovery) && d.di >= M.anchor - 89 && d.di <= M.anchor).map(d => ({ x: getX(d), r: d.recovery })).filter(p => isNum(p.x));
  if (rows.length < 20) return null;
  const m = median(rows.map(p => p.x)), hi = rows.filter(p => p.x > m), lo = rows.filter(p => p.x <= m);
  if (hi.length < 8 || lo.length < 8) return null;
  const a = mean(hi.map(p => p.r)), c = mean(lo.map(p => p.r));
  return { label, unit, m, a, c, diff: a - c, nHi: hi.length, nLo: lo.length, fmtX, hint };
}

function leversCard() {
  const L = [
    leverSplit('Hours asleep', 'h', d => d.main && d.main.asleep != null ? d.main.asleep / HOUR : null, v => nf(v, 1) + ' h'),
    leverSplit('Strain the day before', '', d => d.prev && d.prev.okStrain ? d.prev.strain : null, v => 'strain ' + nf(v, 1)),
    leverSplit('Bedtime', '', d => { if (!d.main) return null; const x = hourOfDay(d.main.start, d.main.o); return x < 12 ? x + 24 : x; }, v => fmtClock(v)),
    leverSplit('Time awake in bed', '', d => d.main && d.main.awake != null ? d.main.awake / HOUR : null, v => nf(v, 1) + ' h'),
  ].filter(Boolean);
  const wd = M.days.filter(d => d.okRec && isNum(d.recovery) && d.di >= M.anchor - 89), we = wd.filter(d => wkdOf(d.di) >= 5), wk = wd.filter(d => wkdOf(d.di) < 5);
  if (we.length >= 8 && wk.length >= 20) L.push({ label: 'Weekend mornings', wend: true, a: mean(wk.map(d => d.recovery)), c: mean(we.map(d => d.recovery)), diff: mean(we.map(d => d.recovery)) - mean(wk.map(d => d.recovery)), nHi: we.length, nLo: wk.length });
  if (!L.length) return '';
  L.sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff));
  let h = '<section class="card"><div class="sec-h"><h2>What moves your recovery</h2>' + tag('MODELED') + '</div><p class="sub">Your last 90 days, split in half on each habit. These are patterns in your own data, not proof of cause.</p><div class="levers">';
  L.slice(0, 4).forEach(l => {
    const big = Math.abs(l.diff) >= 8, small = Math.abs(l.diff) < 4;
    let txt;
    if (l.wend) txt = 'Saturday and Sunday mornings average <b>' + nf(l.c, 0) + '%</b> recovery against <b>' + nf(l.a, 0) + '%</b> on weekdays (' + l.nHi + ' and ' + l.nLo + ' days). These come after Friday and Saturday nights, so later bedtimes are the likely reason.';
    else txt = 'Above ' + esc(l.fmtX(l.m)) + ' (your median): <b>' + nf(l.a, 0) + '%</b> recovery. At or below: <b>' + nf(l.c, 0) + '%</b>. (' + l.nHi + ' and ' + l.nLo + ' days)';
    h += '<div class="lv ' + (small ? 'weak' : big ? 'strong' : '') + '"><div class="lvh"><b>' + esc(l.label) + '</b><span>' + (l.diff > 0 ? '+' : l.diff < 0 ? 'minus ' : '') + nf(Math.abs(l.diff), 0) + ' pts' + (l.wend ? ' on weekends' : '') + '</span></div><p>' + txt + (small ? ' Little difference here.' : '') + '</p></div>';
  });
  h += '</div>' + formula('For each habit, days in the last 90 days are split at your median. The numbers are the mean recovery score in each half. A gap under 4 points is flagged as little difference. Bedtime is read after midnight as hours past 24.') + '</section>';
  return h;
}
