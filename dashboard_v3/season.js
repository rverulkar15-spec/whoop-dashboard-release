/* ---------- The Season: home, levels, badges, targets, tabs, theme ---------- */
var SEASON_SEL = null;
var SEASON_TABS = ['today', 'story', 'training', 'sleep', 'progress', 'goals', 'more'];

var SEASON_OPEN = {};
function seasonDefaults() {
  if (C.goalWorkouts == null) C.goalWorkouts = 5;
  if (C.goalZ2 == null) C.goalZ2 = 60;
  if (C.goalRun == null) C.goalRun = 5;
  if (C.goalSleep == null) C.goalSleep = 7.5;
}
function lcl(s) { return String(s).toLowerCase().replace(/\bhrv\b/g, 'HRV').replace(/\brhr\b/g, 'RHR'); }
function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: setting lasts for this visit only */ } }

/* ---------- helpers ---------- */
function sRange(a, b) { const first = M.days[0].di, ea = Math.max(a, first), eb = Math.min(b, M.anchor); return { a: ea, b: eb, len: eb - ea + 1 }; }
function sRow(prefix) { return pgRows().find(r => r.label.indexOf(prefix) === 0); }
function sIsTrain(w) { return w.scored && !NONTRAIN.includes(w.sport); }
function sChg(j) { return j.pct == null ? 'new' : Math.abs(j.pct) >= 300 ? (j.pct > 0 ? 'about ' + nf(1 + j.pct / 100, 0) + ' times as much' : 'a fraction of before') : (j.pct > 0 ? 'up ' : 'down ') + nf(Math.abs(j.pct), 0) + '%'; }
function sStreakEnds(dis, need) {           // consecutive day indices; returns {best, endAtNeed}
  const s = Array.from(new Set(dis)).sort((x, y) => x - y); let run = 0, best = 0, hit = null, prev = null;
  s.forEach(di => { run = prev != null && di === prev + 1 ? run + 1 : 1; if (run > best) best = run; if (hit == null && run >= need) hit = di; prev = di; });
  return { best, hit };
}
function sWeeks() {                          // every week since the first record
  const out = [], first = M.days[0].di;
  for (let ws = weekStart(first); ws <= M.anchor; ws += 7) {
    const we = ws + 6;
    out.push({ ws, we, partial: we > M.anchor, wk: M.workouts.filter(w => w.di >= ws && w.di <= we) });
  }
  return out;
}

/* ---------- XP and level (MODELED) ---------- */
function seasonXP() {
  const ev = new Map(), add = (di, n) => ev.set(di, (ev.get(di) || 0) + n);
  M.workouts.forEach(w => {
    if (!sIsTrain(w)) return;
    add(w.di, (w.sport === 'weightlifting' || w.sport === 'running') ? 40 : 30);
    const z = Math.round(wZoneMin(w)); if (z > 0) add(w.di, z);
  });
  if (typeof gymXPEvents === 'function') { try { gymXPEvents().forEach(e => add(e.di, e.xp)); } catch (e) { console.error('gym xp', e); } }
  if (typeof storyXPEvents === 'function') { try { storyXPEvents().forEach(e => add(e.di, e.xp)); } catch (e) { console.error('story xp', e); } }
  M.days.forEach(d => {
    if (d.okRec && d.recovery >= C.bandHi) add(d.di, 10);
    if (d.okSleep && d.main.asleep != null && d.main.asleep / HOUR >= 7) add(d.di, 10);
  });
  sWeeks().forEach(w => { if (!w.partial && w.wk.filter(x => x.scored && x.sport === 'weightlifting').length >= C.liftWeekMin) add(w.we, 50); });
  const total = sum(Array.from(ev.values())), level = Math.floor(Math.sqrt(total / 60)) + 1;
  const lo = 60 * (level - 1) * (level - 1), hi = 60 * level * level;
  const xpIn = (a, b) => { let t = 0; ev.forEach((v, di) => { if (di >= a && di <= b) t += v; }); return t; };
  const ws = weekStart(M.anchor);
  return { total, level, lo, hi, frac: (total - lo) / (hi - lo), week: xpIn(ws, M.anchor + 6), l28: xpIn(M.anchor - 27, M.anchor), p28: xpIn(M.anchor - 55, M.anchor - 28), xpIn };
}

/* ---------- badges ---------- */
function seasonBadges(X) {
  const A = M.anchor, wks = sWeeks(), lifts = M.workouts.filter(w => w.scored && w.sport === 'weightlifting');
  const res = [];
  const B = (id, ic, name, desc, done, when, prog) => res.push({ id, ic, name, desc, done: !!done, when: done ? when : null, prog });
  // lifts in a week
  let bestL = 0, whenL = null;
  wks.forEach(w => { const l = w.wk.filter(x => x.scored && x.sport === 'weightlifting').sort((p, q) => p.start - q.start); bestL = Math.max(bestL, l.length); if (whenL == null && l.length >= 3) whenL = l[2].di; });
  B('lift3', '3', 'Triple Lift', 'Three lifting sessions in one week', bestL >= 3, whenL, 'best week so far: ' + bestL + ' of 3');
  // lift target streak
  let run = 0, bestRun = 0, whenH = null;
  wks.filter(w => !w.partial).forEach(w => { const n = w.wk.filter(x => x.scored && x.sport === 'weightlifting').length; run = n >= C.liftWeekMin ? run + 1 : 0; bestRun = Math.max(bestRun, run); if (whenH == null && run >= 4) whenH = w.we; });
  B('habit', '4W', 'Lift Habit', 'Hit your lifting target 4 full weeks in a row', bestRun >= 4, whenH, 'best run: ' + bestRun + ' of 4 weeks at ' + C.liftWeekMin + ' lifts');
  // 5K
  const ok = M.runs.filter(r => r.runOk), big = ok.filter(r => r.km >= 5).sort((p, q) => p.start - q.start)[0];
  const longest = ok.length ? Math.max(...ok.map(r => r.km)) : 0;
  B('5k', '5K', 'First 5K', 'A single run of 5 kilometers (3.1 miles) or more', !!big, big && big.di, 'longest run: ' + nf(U.d(longest), 1) + ' ' + U.dU() + ' of ' + nf(U.d(5), 1));
  // run miles in a week
  let bestM = 0, whenM = null;
  wks.forEach(w => { const km = sum(w.wk.filter(x => x.runOk).map(x => x.km)); bestM = Math.max(bestM, km); if (whenM == null && km >= 8.047) whenM = w.we > A ? A : w.we; });
  B('5mi', '5M', 'Five Mile Week', 'Run 5 miles (8 kilometers) in one week', bestM >= 8.047, whenM, 'best week: ' + nf(bestM * KM_MI, 1) + ' of 5 miles');
  // zone minutes in a week
  let bestZ = 0, whenZ = null;
  wks.forEach(w => {
    let t = 0; w.wk.filter(x => x.scored).sort((p, q) => p.start - q.start).forEach(x => { t += wZoneMin(x); if (whenZ == null && t >= 60) whenZ = x.di; }); bestZ = Math.max(bestZ, t);
  });
  B('z', 'Z', 'Hour in the Zone', '60 minutes in ' + zoneLabel() + ' in one week', bestZ >= 60, whenZ, 'best week: ' + nf(bestZ, 0) + ' of 60 min');
  // distinct training days
  let bestD = 0, whenD = null;
  wks.forEach(w => { const ds = Array.from(new Set(w.wk.filter(sIsTrain).map(x => x.di))).sort((p, q) => p - q); bestD = Math.max(bestD, ds.length); if (whenD == null && ds.length >= 5) whenD = ds[4]; });
  B('full5', '5D', 'Full Week', 'Train on 5 different days in one week', bestD >= 5, whenD, 'best week: ' + bestD + ' of 5 days');
  // green streak
  const gs = sStreakEnds(M.days.filter(d => d.okRec && d.recovery >= C.bandHi).map(d => d.di), 7);
  B('green7', '7G', 'Green Week', '7 green recovery days in a row', gs.best >= 7, gs.hit, 'best streak: ' + gs.best + ' of 7 days');
  const ss = sStreakEnds(M.days.filter(d => d.okSleep && d.main.asleep != null && d.main.asleep / HOUR >= 7).map(d => d.di), 7);
  B('sleep7', '7S', 'Seven for Seven', '7 nights in a row with at least 7 hours asleep', ss.best >= 7, ss.hit, 'best streak: ' + ss.best + ' of 7 nights');
  const pk = M.days.filter(d => d.okRec && d.recovery >= 90).sort((p, q) => p.di - q.di)[0], maxR = Math.max.apply(null, [0].concat(M.days.filter(d => d.okRec).map(d => d.recovery)));
  B('peak', '90', 'Peak Day', 'A recovery score of 90 or higher', !!pk, pk && pk.di, 'best score: ' + nf(maxR, 0) + ' of 90');
  const bg = M.days.filter(d => d.okStrain && d.strain >= 15).sort((p, q) => p.di - q.di)[0], maxS = Math.max.apply(null, [0].concat(M.days.filter(d => d.okStrain).map(d => d.strain)));
  B('big', '15', 'Big Day', 'A completed day with strain 15 or higher', !!bg, bg && bg.di, 'best day: ' + nf(maxS, 1) + ' of 15');
  const tr = M.workouts.filter(sIsTrain).sort((p, q) => p.start - q.start);
  B('w50', '50', 'Fifty Sessions', '50 workouts, not counting walks, sauna or stretching', tr.length >= 50, tr[49] && tr[49].di, tr.length + ' of 50 so far');
  B('w100', '100', 'Century', '100 workouts, not counting walks, sauna or stretching', tr.length >= 100, tr[99] && tr[99].di, tr.length + ' of 100 so far');
  if (typeof gymBadgeList === 'function') { try { gymBadgeList().forEach(b => res.push(b)); } catch (e) { console.error('gym badges', e); } }
  if (typeof fsBadgeList === 'function') { try { fsBadgeList().forEach(b => res.push(b)); } catch (e) { console.error('fitness badges', e); } }
  if (typeof storyBadgeList === 'function') { try { storyBadgeList().forEach(b => res.push(b)); } catch (e) { console.error('story badges', e); } }
  return res;
}

/* ---------- early warning (own baseline, needs two signals) ---------- */
function seasonWarning() {
  const A = M.anchorDay; if (!A || !A.hasRec) return null;
  const z = (m, v) => { if (!isNum(v)) return null; const b = baselineAt(M, m, A.di, 28); return b.n >= 14 && b.sd > 0 ? (v - b.mean) / b.sd : null; };
  const sig = [], strong = [], checks = [
    ['hrv', A.okRec ? A.hrv : null, x => x <= -1, x => x <= -2, 'HRV is below your usual'],
    ['rhr', A.okRec ? A.rhr : null, x => x >= 1, x => x >= 2, 'resting heart rate is above your usual'],
    ['skin', A.okRec ? A.skin : null, x => x >= 1.5, x => x >= 2, 'skin temperature is up'],
    ['resp', A.okSleep && A.main ? A.main.resp : null, x => x >= 1.5, x => x >= 2, 'breathing rate is up']];
  let usable = 0;
  checks.forEach(c => { const v = z(c[0], c[1]); if (v == null) return; usable++; if (c[2](v)) sig.push(c[4]); if (c[3](v)) strong.push(c[4]); });
  return { sig, strong, usable, flag: sig.length >= 2 || strong.length >= 1 };
}

/* ---------- home ---------- */
function seasonSummary() {
  const first = M.days[0].di, rows = pgRows(), c = sRange(M.anchor - 27, M.anchor), a = sRange(M.anchor - 89, M.anchor);
  if (M.days.length < 40) return null;
  const res = rows.map(r => { const p = r.c(a.a, a.b, a.len), q = r.c(c.a, c.b, c.len); return { r, p, c: q, j: pgJudge(r, p, q) }; });
  const t = res.filter(x => x.j.fav === 'toward'), w = res.filter(x => x.j.fav === 'away'), s = res.filter(x => x.j.fav === 'same');
  const judged = t.length + w.length + s.length, ratio = (t.length + w.length) ? t.length / (t.length + w.length) : 0.5;
  const verdict = judged < 6 ? { k: 'flat', t: 'Too early to call' } : ratio >= 0.6 ? { k: 'up', t: 'Moving up' } : ratio <= 0.4 ? { k: 'down', t: 'Slipping' } : { k: 'flat', t: 'Holding steady' };
  const rank = arr => arr.slice().sort((x, y) => Math.abs(y.j.pct == null ? 999 : y.j.pct) - Math.abs(x.j.pct == null ? 999 : x.j.pct));
  return { verdict, t, w, s, judged, top: rank(t)[0] || null, watch: rank(w)[0] || null, first };
}

function growthTiles() {
  const A = M.anchor, first = M.days[0].di;
  const picks = [['Lifting sessions per week', 'Lifting sessions per week'], ['Lifting minutes per week', 'Lifting minutes per week'], ['Run distance per week', 'Running per week'],
    ['Fastest pace', 'Fastest pace, 3 km or more'], ['Resting heart rate average', 'Resting heart rate'], ['HRV average', 'HRV'], ['Hours asleep per night', 'Sleep per night'], ['Recovery score average', 'Recovery score']];
  const cur = sRange(A - 27, A), pri = sRange(A - 55, A - 28), avg = sRange(A - 89, A);
  const hasPri = pri.b >= first && pri.len >= 14;
  const wks = []; for (let ws = weekStart(A) - 7 * 11; ws < weekStart(A); ws += 7) if (ws + 6 >= first) wks.push(sRange(ws, ws + 6));
  let h = '';
  picks.forEach(p => {
    const r = sRow(p[0]); if (!r) return;
    const c = r.c(cur.a, cur.b, cur.len); if (!c || c.v == null) return;
    const base = hasPri ? r.c(pri.a, pri.b, pri.len) : null, av = r.c(avg.a, avg.b, avg.len);
    const j = base ? pgJudge(r, base, c) : null;
    let chg = '<span class="chg s">No last month to compare yet</span>';
    if (j) {
      const cls = { toward: 't', away: 'a', same: 's', changed: 'c', thin: 's', na: 's' }[j.fav];
      chg = j.fav === 'thin' || j.fav === 'na' ? '<span class="chg s">Too few days last month</span>' :
        '<span class="chg ' + cls + '">' + (j.fav === 'same' ? '● about the same' : arrow(j.d || 0) + ' ' + esc(sChg(j))) + '</span> <span class="avg">last month: ' + esc(r.f(base.v)) + '</span>';
    }
    const sp = wks.map(w => { const x = r.c(w.a, w.b, w.len); return x && x.v != null && (r.count || x.n >= 2) ? x.v : null; });
    h += '<div class="gt"><div class="lab">' + esc(p[1]) + '</div><div class="big">' + esc(r.f(c.v)) + '</div><div>' + chg + '</div>' +
      (av && av.v != null ? '<div class="avg">your 90 day average: ' + esc(r.f(av.v)) + '</div>' : '') + sparkline(sp, 120, 28) + '</div>';
  });
  return h;
}

function weekTargets() {
  const A = M.anchor, ws = weekStart(A), we = ws + 6, left = we - A;
  const inW = M.workouts.filter(w => w.di >= ws && w.di <= we && w.scored);
  const lifts = inW.filter(w => w.sport === 'weightlifting').length, trn = inW.filter(sIsTrain).length, zm = sum(inW.map(wZoneMin));
  const rkm = sum(M.workouts.filter(w => w.di >= ws && w.di <= we && w.runOk).map(w => U.d(w.km)));
  const sl = valsIn(M, 'asleep', ws, A), slAvg = sl.length ? mean(sl) : null;
  const gp = typeof gymWeekRow === 'function' ? gymWeekRow(ws, we) : null;
  const rows = [
    ['Lifting sessions', lifts, C.liftWeekMin, n => String(n), ''],
    gp ? ['Program workouts', gp.done, gp.planned, n => String(n), ''] : null,
    ['Workouts', trn, C.goalWorkouts, n => String(n), ''],
    ['Minutes in ' + zoneLabel(), zm, C.goalZ2, n => nf(n, 0), ' min'],
    ['Running distance', rkm, C.goalRun, n => nf(n, 1), ' ' + U.dU()],
    ['Sleep per night so far', slAvg, C.goalSleep, n => nf(n, 1), ' h']].filter(Boolean);
  let h = '<p class="sub">Week of ' + esc(fmtDay(ws)) + '. ' + (left > 0 ? left + (left === 1 ? ' day' : ' days') + ' left.' : 'Last day of the week.') + ' Targets are yours to change in the Goals tab.</p>';
  rows.forEach(r => {
    const v = r[1], g = r[2], pct = v == null || !(g > 0) ? 0 : clamp(v / g * 100, 0, 100), done = v != null && g > 0 && v >= g;
    h += '<div class="tg' + (done ? ' done' : '') + '"><div class="row"><b>' + esc(r[0]) + '</b><span>' + (v == null ? 'no data yet' : esc(r[3](v)) + ' of ' + esc(r[3](g)) + r[4]) + '</span></div>' +
      '<div class="tbar" role="img" aria-label="' + esc(r[0] + ': ' + nf(pct, 0) + ' percent of target') + '"><i style="width:' + pct.toFixed(0) + '%"></i></div></div>';
  });
  return h;
}

function seasonMap() {
  const A = M.anchor, first = M.days[0].di, endWs = weekStart(A), startWs = endWs - 12 * 7;
  const byDi = new Map(); M.days.forEach(d => { const o = byDi.get(d.di); if (!o || (!o.okRec && d.okRec)) byDi.set(d.di, d); });
  const recs = pgRecords(), recDi = new Set(recs.filter(r => r.di != null).map(r => r.di));
  const wo = new Map(); M.workouts.forEach(w => { if (!w.scored) return; if (!wo.has(w.di)) wo.set(w.di, []); wo.get(w.di).push(w); });
  let cols = '', lastMon = -1;
  for (let ws = startWs; ws <= endWs; ws += 7) {
    const mon = new Date(ws * DAY).getUTCMonth(), moLab = mon !== lastMon ? MON[mon] : ''; lastMon = mon;
    cols += '<div class="wk"><div class="mo">' + moLab + '</div>';
    for (let k = 0; k < 7; k++) {
      const di = ws + k, d = byDi.get(di), ws_ = wo.get(di) || [];
      if (di > A) { cols += '<div class="mc fut" aria-hidden="true"></div>'; continue; }
      if (di < first) { cols += '<div class="mc none" aria-hidden="true"></div>'; continue; }
      const band = d && d.okRec && isNum(d.recovery) ? bandOf(d.recovery).k : 'nodata';
      const hasG = typeof gymHasDay === 'function' && gymHasDay(di), hasL = hasG || ws_.some(w => w.sport === 'weightlifting'), hasR = ws_.some(w => w.sport === 'running');
      const isRec = recDi.has(di), recent = isRec && di >= A - 6;
      const lab = fmtDay(di) + ': ' + (d && d.okRec ? 'recovery ' + nf(d.recovery, 0) + ' percent' : 'no recovery score') + (hasL ? ', lifted' : '') + (hasR ? ', ran' : '') + (isRec ? ', personal record day' : '');
      cols += '<button type="button" class="mc ' + band + (di === A ? ' today' : '') + (recent ? ' pr' : '') + '" data-mc="' + di + '" aria-label="' + esc(lab) + '">' +
        (hasL ? '<i class="lift"></i>' : '') + (hasR ? '<i class="run"></i>' : '') + (isRec ? '<em>★</em>' : '') + '</button>';
    }
    cols += '</div>';
  }
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x, i) => '<span>' + (i % 2 === 0 ? x : '') + '</span>').join('');
  return '<div class="map"><div class="dow">' + dow + '</div><div class="cols">' + cols + '</div></div>' +
    '<div class="legend"><span><s style="background:var(--good)"></s>green recovery</span><span><s style="background:var(--warn)"></s>yellow</span><span><s style="background:var(--bad)"></s>red</span>' +
    '<span><s class="dot" style="background:#2f7bff"></s>lift</span><span><s class="dot" style="background:#ffd54a"></s>run</span><span>★ personal record day</span></div>' +
    '<div class="mapdetail" id="mapDetail" aria-live="polite"></div>';
}

function seasonDetail(di) {
  const el = $('#mapDetail'); if (!el || !M || M.empty) return;
  SEASON_SEL = di;
  $$('.mc.sel').forEach(x => x.classList.remove('sel'));
  const cell = $('.mc[data-mc="' + di + '"]'); if (cell) cell.classList.add('sel');
  const d = M.days.find(x => x.di === di && x.okRec) || M.days.find(x => x.di === di);
  const ws = M.workouts.filter(w => w.di === di && w.scored);
  const recs = pgRecords().filter(r => r.di === di);
  let h = '<b>' + esc(fmtDayW(di)) + '</b><br>';
  if (d && d.okRec && isNum(d.recovery)) {
    const b = bandOf(d.recovery);
    h += 'Recovery <b style="font-family:var(--num);color:' + b.color + '">' + nf(d.recovery, 0) + '%</b> ' + esc(b.name.toLowerCase()) + '. HRV ' + nf(d.hrv, 0) + ' ms, resting heart rate ' + nf(d.rhr, 0) + ' bpm' +
      (d.main && d.main.asleep != null ? ', asleep ' + nf(d.main.asleep / HOUR, 1) + ' h' : '') + (d.okStrain ? ', strain ' + nf(d.strain, 1) : '') + '.';
  } else h += '<span class="muted">No recovery score for this day.</span>';
  if (ws.length) h += '<br>' + ws.map(w => esc(sportName(w.sport)) + ' ' + Math.round(w.durMin) + ' min' + (w.strain != null ? ', strain ' + nf(w.strain, 1) : '')).join(' · ');
  if (typeof gymDayInfo === 'function') { const gi = gymDayInfo(di); if (gi) h += '<br>' + gi; }
  if (recs.length) h += '<br><span style="color:var(--gold);font-weight:700">★ ' + recs.map(r => esc(r.label + ': ' + r.v)).join('; ') + '</span>';
  el.innerHTML = h;
}

function renderSeason() {
  const el = $('#seasonHome'); if (!el) return;
  seasonDefaults();
  if (!M || M.empty) { el.innerHTML = '<div class="banner">No WHOOP data in this file yet. Run SETUP.bat to pull it, or drop a whoop_data.json onto this page.</div>'; return; }
  const A = M.anchorDay, X = seasonXP(), F = fitnessModel(), S = seasonSummary(), W = seasonWarning(), badges = seasonBadges(X);
  const recent = pgRecords().filter(r => r.di != null && r.di >= M.anchor - 6);
  const circ = 2 * Math.PI * 54, off = circ * (1 - clamp(F ? F.now.score / 100 : 0, 0, 1));
  const green28 = M.days.filter(d => d.okRec && d.di >= M.anchor - 27), g28 = green28.filter(d => d.recovery >= C.bandHi).length;
  // lifting weeks in a row, counting back from the last full week
  let streak = 0; const fullWks = sWeeks().filter(w => !w.partial);
  for (let i = fullWks.length - 1; i >= 0; i--) { if (fullWks[i].wk.filter(x => x.scored && x.sport === 'weightlifting').length >= C.liftWeekMin) streak++; else break; }
  const earned = badges.filter(b => b.done).length;

  let h = '<div class="pagehead"><h1>Where you stand</h1><p>' + esc(fmtDayW(M.anchor)) + '. ' + M.days.length + ' days of WHOOP data on file.</p></div>';

  try { h += freshnessNote(); } catch (e) { console.error('freshness', e); }
  try { h += todaysCall(); } catch (e) { console.error('call', e); }

  // hero
  h += '<section class="card"><div class="hero"><div class="lvl" role="img" aria-label="' + (F ? 'Fitness score ' + nf(F.now.score, 0) + ' of 100' : 'Fitness score not ready yet') + '"><svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="54" stroke-width="9"/>' +
    '<circle class="arc" id="lvlArc" cx="60" cy="60" r="54" stroke-width="9" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + circ.toFixed(1) + '" data-to="' + off.toFixed(1) + '"/></svg><div class="in"><small>Fitness</small><b>' + (F ? nf(F.now.score, 0) : '..') + '</b></div></div><div>';
  if (S) {
    h += '<span class="verdict ' + S.verdict.k + '">' + (S.verdict.k === 'up' ? '▲' : S.verdict.k === 'down' ? '▼' : '●') + ' ' + esc(S.verdict.t) + '</span>';
    h += '<p class="summary">Against your own 90 day average, of ' + S.judged + ' measures <b>' + S.t.length + '</b> are better, <b>' + S.w.length + '</b> worse and ' + S.s.length + ' about the same.' +
      (S.top ? ' Biggest gain: ' + esc(lcl(S.top.r.label.replace(/ \(.*\)$/, ''))) + ', ' + esc(S.top.r.f(S.top.p.v)) + ' to ' + esc(S.top.r.f(S.top.c.v)) + '.' : '') +
      (S.watch ? ' Worth a look: ' + esc(lcl(S.watch.r.label.replace(/ \(.*\)$/, ''))) + ', ' + esc(S.watch.r.f(S.watch.p.v)) + ' to ' + esc(S.watch.r.f(S.watch.c.v)) + '.' : '') + '</p>';
  } else h += '<span class="verdict flat">● Too early to call</span><p class="summary">The comparison needs about 40 days of data. You have ' + M.days.length + ' so far.</p>';
  try { h += fsHeroExtra(); } catch (e) { console.error('fitness hero', e); }
  h += '</div></div>';
  const rb = A && A.okRec && isNum(A.recovery) ? bandOf(A.recovery) : null;
  h += '<div class="score">' +
    '<div class="cell"><small>Recovery today</small><b' + (rb ? ' style="color:' + rb.color + '"' : '') + '>' + (rb ? nf(A.recovery, 0) + '%' : 'none yet') + '</b><span>' + (rb ? esc(rb.name.toLowerCase()) : 'not scored') + '</span></div>' +
    '<div class="cell"><small>Green days, last 28</small><b>' + g28 + ' of ' + green28.length + '</b><span>recovery ' + C.bandHi + ' or higher</span></div>' +
    '<div class="cell"><small>Lifting target streak</small><b>' + streak + (streak === 1 ? ' week' : ' weeks') + '</b><span>' + C.liftWeekMin + ' or more lifts per full week</span></div>' +
    '<div class="cell"><small>Badges</small><b>' + earned + ' of ' + badges.length + '</b><span>see below</span></div></div>';
  if (recent.length) h += '<div class="chips">' + recent.map(r => '<span class="chipx">★ New: ' + esc(lcl(r.label)) + ', ' + esc(r.v) + '</span>').join('') + '</div>';
  h += '</section>';

  // early warning
  if (W) {
    if (W.flag) h += '<div class="ew" role="alert"><b>Early warning.</b> ' + esc(W.sig.join(', ')) + ' this morning' + (W.sig.length < 2 ? ' (a strong signal on its own)' : '') + '. That can mean a cold coming on, a hard training block, alcohol or short sleep. It is a flag from your own baseline, not a diagnosis.</div>';
    else h += '<div class="ew ok"><b>Early warning: clear.</b> ' + (W.sig.length ? 'One signal is off (' + esc(W.sig[0]) + '). It takes two, or one strong one, to raise a flag.' : 'HRV, resting heart rate, skin temperature and breathing rate are all near your usual.') + ' <span class="muted">Checked against your last 28 days, ' + W.usable + ' of 4 signals available.</span></div>';
  }

  try { h += fsSection(); } catch (e) { console.error('fitness section', e); }
  try { h += storyStrip(); } catch (e) { console.error('story strip', e); }
  try { h += notableCard(); } catch (e) { console.error('notable', e); }

  // targets
  h += '<section class="card"><div class="sec-h"><h2>This week\'s targets</h2>' + tag('MEASURED') + '</div>' + weekTargets() + '</section>';
  try { h += planCard(); } catch (e) { console.error('plan', e); }

  // map
  h += '<section class="card"><div class="sec-h"><h2>The last 90 days</h2>' + tag('MEASURED') + '</div><p class="sub">Each square is a day, colored by recovery. Tap one for the details.</p>' + seasonMap() + '</section>';

  // growth
  h += '<details class="card fold" data-fold="growth"' + (SEASON_OPEN.growth ? ' open' : '') + '><summary class="sec-h"><h2>Growth against last month</h2>' + tag('MEASURED') + '</summary><p class="sub">The last 28 days against the 28 before. Green means it moved toward better.</p><div class="gtiles">' + growthTiles() + '</div>' +
    formula('each value is the mean (or per week total) over the last 28 days. The change compares it with the 28 days before that. A move under 3 percent counts as about the same. The line under each tile is twelve weeks of the same measure.') + '</details>';

  // badges
  h += '<details class="card fold" data-fold="badges"' + (SEASON_OPEN.badges ? ' open' : '') + '><summary class="sec-h"><h2>Badges</h2>' + tag('MODELED') + '</summary><p class="sub">' + earned + ' earned. Gold glow means earned in the last 7 days.</p><div class="bgrid">' +
    badges.slice().sort((p, q) => (q.done - p.done) || ((q.when || 0) - (p.when || 0))).map(b => {
      const fresh = b.done && b.when != null && b.when >= M.anchor - 6;
      return '<div class="bd ' + (b.done ? 'on' : 'off') + (fresh ? ' new' : '') + '"><div class="ic">' + esc(b.ic) + '</div><div><b>' + esc(b.name) + '</b><small>' + esc(b.desc) + '</small><small>' +
        (b.done ? 'Earned' + (b.when != null ? ' ' + esc(fmtDay(b.when)) : '') : esc(b.prog)) + '</small></div></div>';
    }).join('') + '</div></details>';

  el.innerHTML = h;
  const arc = $('#lvlArc'); if (arc) requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', arc.dataset.to)));
  seasonDetail(SEASON_SEL != null && SEASON_SEL <= M.anchor && SEASON_SEL >= M.days[0].di ? SEASON_SEL : M.anchor);
  renderTargetsEditor(); renderLevelsInfo(X);
  const gb = $('#gymBody'); if (gb && typeof renderGym === 'function') { try { gb.innerHTML = renderGym() + (typeof plateauCard === 'function' ? plateauCard() : ''); } catch (e) { console.error('gym', e); gb.innerHTML = '<div class="banner err">The strength section could not be drawn: ' + esc(e && e.message) + '. Everything else is unaffected.</div>'; } }
  try { renderStory(); } catch (e) { console.error('story', e); const sb = $('#storyBody'); if (sb) sb.innerHTML = '<div class="banner err">The story could not be drawn: ' + esc(e && e.message) + '. Everything else is unaffected.</div>'; }
  const lv = $('#leversBody'); if (lv) { try { lv.innerHTML = (typeof liftReadinessCard === 'function' ? liftReadinessCard() : '') + leversCard() + (typeof journalCard === 'function' ? journalCard() : ''); } catch (e) { console.error('levers', e); lv.innerHTML = ''; } }
}

/* ---------- targets editor and info ---------- */
function renderTargetsEditor() {
  const el = $('#targetsBody'); if (!el) return;
  const F = [['liftWeekMin', 'Lifting sessions per week', 1, 14, 1], ['goalWorkouts', 'Workouts per week', 1, 14, 1], ['goalZ2', 'Minutes in ' + zoneLabel() + ' per week', 0, 600, 5], ['goalRun', 'Running distance per week (' + U.dU() + ')', 0, 100, 0.5], ['goalSleep', 'Hours asleep per night', 4, 12, 0.25]];
  el.innerHTML = '<p class="sub">These drive the bars on the Today tab, and the lifting target also sets the Lift Habit badge and your lifting consistency. Change them whenever you like. They are saved in this browser.</p><div class="goalgrid">' +
    F.map(f => '<div class="field"><label for="sg-' + f[0] + '">' + esc(f[1]) + '</label><input id="sg-' + f[0] + '" data-sgoal="' + f[0] + '" type="number" inputmode="decimal" min="' + f[2] + '" max="' + f[3] + '" step="' + f[4] + '" value="' + esc(C[f[0]]) + '"></div>').join('') + '</div>';
}
function renderLevelsInfo(X) {
  const el = $('#levelsBody'); if (!el) return;
  const F = typeof fitnessModel === 'function' ? fitnessModel() : null;
  el.innerHTML = '<p>The fitness score has two parts. Level is a number from 0 to 100 for where you stand now: how you train, push, recover and sleep over the last four weeks. Meeting your own Goals lands near 70, so the top of the scale has to be earned by going past them and by real progress. Momentum shows which way you are moving against your own earlier weeks. Days without training cost points once they pass two in a row, and the score comes back as you do.</p>' +
    (F ? '<div class="tgs">' + fsPillars(F) + '</div>' : '<p class="sub">It needs about 45 days of WHOOP data to start.</p>') +
    (F ? fsExplain(F) : '') +
    '<p class="sub">The point values are my design, not WHOOP\'s, and you can see every piece above. Badges are checked against your records and show what is still missing.</p>';
}
function renderLook() {
  const el = $('#lookBody'); if (!el) return;
  const th = document.documentElement.getAttribute('data-theme') || 'dark', sz = document.body.getAttribute('data-size') || 'larger';
  const seg = (grp, cur, items) => '<div class="seg" role="group">' + items.map(i => '<button type="button" data-' + grp + '="' + i[0] + '" aria-pressed="' + (cur === i[0]) + '">' + i[1] + '</button>').join('') + '</div>';
  el.innerHTML = '<div class="field"><label>Theme</label>' + seg('theme', th, [['dark', 'Dark forest'], ['light', 'Light']]) + '</div>' +
    '<div class="field"><label>Text size</label>' + seg('size', sz, [['normal', 'Normal'], ['larger', 'Larger'], ['largest', 'Largest']]) + '</div>' +
    '<p class="f">The older single page layout is still built next to this one as <b>whoop_classic.html</b> in the same folder.</p>';
}


/* ---------- how you compare with other WHOOP members (published averages, not percentiles) ---------- */
var PEER_SRC = {
  stats: 'https://www.whoop.com/us/en/thelocker/member-averages-recovery-strain-sleep-hrv/',
  hrv: 'https://www.whoop.com/us/en/thelocker/normal-hrv-range-age-gender/'
};
var PEER_REF = {
  men:   { name: 'men', hrv: 65, rhr: 55.2, range: [50, 100] },
  women: { name: 'women', hrv: 62, rhr: 58.8, range: [45, 90] },
  all:   { name: 'all members', hrv: 65, rhr: null, range: null }
};
function renderPeers() {
  const el = $('#peersBody'); if (!el) return;
  if (!M || M.empty) { el.innerHTML = ''; return; }
  const sex = PEER_REF[sget('season.peer')] ? sget('season.peer') : 'men', R = PEER_REF[sex];
  const c = sRange(M.anchor - 27, M.anchor);
  const mean28 = k => { const v = valsIn(M, k, c.a, c.b); return v.length >= 5 ? mean(v) : null; };
  const rows = [
    ['HRV', mean28('hrv'), R.hrv, v => nf(v, 1) + ' ms', 'up', R.range],
    ['Resting heart rate', mean28('rhr'), R.rhr, v => nf(v, 1) + ' bpm', 'down', null],
    ['Recovery score', mean28('recovery'), 58, v => nf(v, 0) + '%', 'up', null],
    ['Sleep performance', mean28('perf'), 82, v => nf(v, 0) + '%', 'up', null],
    ['Hours asleep per night', mean28('asleep'), 7 + 11 / 60, v => nf(v, 1) + ' h', 'up', null],
    ['Hours in bed per night', mean28('inbed'), 8 + 2 / 60, v => nf(v, 1) + ' h', null, null],
    ['Daily strain', mean28('strain'), 11.0, v => nf(v, 1), null, null]];
  let h = '<p class="sub">Your last 28 days against the published averages for ' + esc(R.name) + '. These are averages, so I can show which side of the average you are on, not a true percentile.</p>' +
    '<div class="seg" role="group" aria-label="Compare with">' + [['men', 'Men'], ['women', 'Women'], ['all', 'All members']].map(x => '<button type="button" data-peer="' + x[0] + '" aria-pressed="' + (sex === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' +
    '<div class="scroll"><table><thead><tr><th>Measure</th><th class="n">You, last 28 days</th><th class="n">Member average</th><th class="n">Difference</th><th>Where you stand</th></tr></thead><tbody>';
  rows.forEach(r => {
    const you = r[1], ref = r[2];
    if (you == null || ref == null) { h += '<tr><td>' + esc(r[0]) + '</td><td class="n">' + (you == null ? '<span class="muted">too few days</span>' : esc(r[3](you))) + '</td><td class="n"><span class="muted">not published</span></td><td class="n"></td><td></td></tr>'; return; }
    const d = you - ref, pct = d / ref * 100, near = Math.abs(pct) < 3;
    let read = near ? 'about average' : (d > 0 ? 'above average' : 'below average');
    if (!near && r[4]) read = '<span class="' + ((r[4] === 'up') === (d > 0) ? 'good' : 'warn') + '">' + read + '</span>';
    if (r[5]) read += '. ' + (you < r[5][0] ? 'Under the middle half of members at 25 (' + r[5][0] + ' to ' + r[5][1] + ' ms).' : you > r[5][1] ? 'Over the middle half of members at 25 (' + r[5][0] + ' to ' + r[5][1] + ' ms).' : 'Inside the middle half of members at 25 (' + r[5][0] + ' to ' + r[5][1] + ' ms).');
    h += '<tr><td>' + esc(r[0]) + '</td><td class="n">' + esc(r[3](you)) + '</td><td class="n">' + esc(r[3](ref)) + '</td><td class="n">' + (d > 0 ? 'up ' : 'down ') + nf(Math.abs(pct), 0) + '%</td><td>' + read + '</td></tr>';
  });
  h += '</tbody></table></div>' +
    '<div class="banner"><b>Read this before you judge the numbers.</b> WHOOP members are people who chose to wear a fitness tracker, so the average is not the average person. WHOOP does not publish full distributions, only these averages and one range for HRV, so a real percentile is not possible from public data. HRV also varies a lot between people, which is why your own trend matters more than the comparison. The range shown is for age 25 and is rounded in WHOOP\'s text.</div>' +
    formula('your value = mean of your included days in the last 28; difference = (you minus average) divided by the average. Averages come from WHOOP\'s member data pages: <a href="' + PEER_SRC.stats + '" target="_blank" rel="noopener">member averages</a> (page dated May 15, 2026) and <a href="' + PEER_SRC.hrv + '" target="_blank" rel="noopener">HRV by age and sex</a> (April 2, 2026). Sample sizes are not stated. Hours in bed and daily strain have no better or worse direction, so they carry no color.');
  el.innerHTML = h;
}

/* ---------- theme, size, tabs ---------- */
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t); sset('season.theme', t);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'light' ? '#f4f1e6' : '#0e1a14');
  renderLook();
}
function setSize(s) { document.body.setAttribute('data-size', s); sset('season.size', s); renderLook(); }
function route() {
  let t = (location.hash || '').replace('#', ''); if (t === 'drivers') t = 'progress';
  if (SEASON_TABS.indexOf(t) < 0) t = sget('season.tab'); if (SEASON_TABS.indexOf(t) < 0) t = 'today';
  const changed = document.body.dataset.tab !== t;
  document.body.dataset.tab = t; sset('season.tab', t);
  $$('#tabbar a').forEach(a => { if (a.dataset.go === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (changed) window.scrollTo(0, 0);
}

(function () {
  const base = renderAll;
  renderAll = function (keepControls) {
    base(keepControls);
    try { renderSeason(); renderLook(); renderPeers(); }
    catch (e) { console.error('season', e); const el = $('#seasonHome'); if (el) el.innerHTML = '<div class="banner err">This section could not be drawn (home): ' + esc(e && e.message) + '. The other tabs are unaffected.</div>'; }
  };
  const sz = sget('season.size'); if (sz === 'normal' || sz === 'largest') document.body.setAttribute('data-size', sz);
  document.addEventListener('click', ev => {
    const mc = ev.target.closest('[data-mc]'); if (mc) { seasonDetail(Number(mc.dataset.mc)); return; }
    const th = ev.target.closest('[data-theme]'); if (th && th.tagName === 'BUTTON') { setTheme(th.dataset.theme); return; }
    const sx = ev.target.closest('[data-size]'); if (sx && sx.tagName === 'BUTTON') { setSize(sx.dataset.size); return; }
    const fr = ev.target.closest('[data-fsr]'); if (fr && fr.tagName === 'BUTTON') { sset('season.fsrange', fr.dataset.fsr); const F = fitnessModel(), bx = $('#fsChartBox'); if (F && bx) { bx.innerHTML = fsChartBox(F, Number(fr.dataset.fsr)); $$('[data-fsr]').forEach(b => b.setAttribute('aria-pressed', String(b === fr))); } return; }
    const pe = ev.target.closest('[data-peer]'); if (pe) { sset('season.peer', pe.dataset.peer); renderPeers(); return; }
    if (ev.target.closest('#themeBtn')) setTheme((document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark');
  });
  document.addEventListener('toggle', ev => { const d = ev.target; if (d && d.dataset && d.dataset.fold) SEASON_OPEN[d.dataset.fold] = d.open; }, true);
  document.addEventListener('change', ev => {
    const t = ev.target; if (!t.dataset || !t.dataset.sgoal) return;
    const v = parseFloat(t.value); if (!isFinite(v) || v < 0) { renderTargetsEditor(); return; }
    C[t.dataset.sgoal] = v; saveControls(); renderAll(true);
  });
  function a11yScroll() {
    $$('.scroll:not([tabindex])').forEach(el => { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Scrollable table'); });
  }
  // on a phone, wide tables become one card per row: the first cell is the title, every other cell carries its column name
  function stackTables() {
    $$('table:not([data-stk])').forEach(t => {
      t.setAttribute('data-stk', '1');
      if (t.classList.contains('heat')) return;
      const labs = Array.from(t.querySelectorAll('thead th')).map(x => x.textContent.trim());
      if (labs.length < 3) return;
      t.classList.add('stack'); t.setAttribute('role', 'table');
      t.querySelectorAll('thead tr, tbody tr').forEach(tr => {
        tr.setAttribute('role', 'row'); let i = 0;
        if (tr.children.length === 1 && tr.children[0].colSpan > 1) tr.classList.add('sec');
        Array.from(tr.children).forEach(td => {
          const span = td.colSpan > 1; td.setAttribute('role', td.tagName === 'TH' ? 'columnheader' : 'cell');
          if (tr.parentNode.tagName === 'THEAD') return;
          if (span) { td.classList.add('span'); i += td.colSpan; return; }
          if (!td.textContent.trim()) td.classList.add('blank');
          td.setAttribute('data-label', labs[i] || '');
          if (i > 0 && td.childNodes.length > 1) { const w = document.createElement('span'); w.className = 'v'; while (td.firstChild) w.appendChild(td.firstChild); td.appendChild(w); }
          i++;
        });
      });
    });
  }
  function tidy() { a11yScroll(); stackTables(); }
  new MutationObserver(tidy).observe(document.body, { childList: true, subtree: true }); tidy();
  let lastCw = document.documentElement.clientWidth, rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const w = document.documentElement.clientWidth; if (Math.abs(w - lastCw) > 40) { lastCw = w; try { renderAll(true); } catch (e) { console.error('resize', e); } } }, 250); });
  window.addEventListener('hashchange', route);
  route();
})();
