/* ---------- Fitness score: Level (where you stand) and Momentum (which way you are moving) (MODELED) ---------- */
/* Level is scored for every day from the 28 days (56 for strength) that end on it, so the line can be drawn back in time.
   Momentum compares the latest 28 days with the 90 days before them. Your Goals are the reference point on each area:
   meeting them lands near 70, and the points above that are earned by going past them and by real progress. */
var FS = null;
const FS_W = { train: 20, strength: 20, effort: 15, cardio: 15, recovery: 15, sleep: 15 };
const FS_NAME = { train: 'Lifting consistency', strength: 'Strength', effort: 'Effort', cardio: 'Cardio', recovery: 'Recovery', sleep: 'Sleep' };
const FS_ORDER = ['train', 'strength', 'effort', 'cardio', 'recovery', 'sleep'];
const FS_HARD_REF = 20;      // minutes a week in the two hardest zones that count as "on plan" (my design; WHOOP's published minimum is 10)
const FS_LIFTMIN_REF = 100;  // minutes a week of lifting that count as "on plan" (WHOOP's published floor is 40, with no extra benefit past 120)
const FS_BASE_LEN = 90, FS_WIN = 28, FS_MIN_BASE = 14;

// goal ratio to a 0..100 level: meeting the goal is 70, then diminishing returns toward 100
function fsLv(x) { if (!(x > 0)) return 0; return x <= 1 ? 70 * x : 70 + 30 * (1 - Math.exp(-(x - 1) / 0.5)); }

function fsInputs() {
  const g = typeof gymModel === 'function' ? gymModel() : null;
  const lift = new Set(typeof stLiftDays === 'function' ? stLiftDays().map(x => x.di) : []);
  const train = new Set(lift); M.workouts.forEach(w => { if (sIsTrain(w)) train.add(w.di); });
  const hrv = new Map(), rhr = new Map(), slp = new Map(), rec = new Map(), cons = new Map();
  M.days.forEach(d => {
    if (d.okRec && isNum(d.hrv) && !hrv.has(d.di)) hrv.set(d.di, d.hrv);
    if (d.okRec && isNum(d.rhr) && !rhr.has(d.di)) rhr.set(d.di, d.rhr);
    if (d.okRec && isNum(d.recovery) && !rec.has(d.di)) rec.set(d.di, d.recovery);
    if (d.okSleep && d.main && d.main.asleep != null && !slp.has(d.di)) slp.set(d.di, d.main.asleep / HOUR);
    if (d.okSleep && d.main && isNum(d.main.cons) && !cons.has(d.di)) cons.set(d.di, d.main.cons);
  });
  const tracked = {}; if (g) Object.keys(g.E).forEach(ex => { if (g.E[ex].length >= 5) tracked[ex] = g.E[ex][4].di; });
  const wos = M.workouts.filter(w => w.scored);
  return { g, lift, train, hrv, rhr, slp, rec, cons, tracked, wos, firstLift: lift.size ? Math.min.apply(null, Array.from(lift)) : null, firstW: wos.length ? Math.min.apply(null, wos.map(w => w.di)) : null };
}
function fsCount(set, a, b) { let n = 0; for (let d = a; d <= b; d++) if (set.has(d)) n++; return n; }
function fsVals(map, a, b) { const o = []; for (let d = a; d <= b; d++) if (map.has(d)) o.push(map.get(d)); return o; }
function fsHardMin(w) { return w.zones ? ((w.zones[4] || 0) + (w.zones[5] || 0)) / MINUTE : 0; }

function fsDay(I, d) {
  const P = {}, tgt = Math.max(1, C.liftWeekMin || 3);
  // 1. lifting consistency: the last four weeks against your weekly target, newest week counting most. Meeting it every week is 70
  if (I.firstLift != null && d >= I.firstLift) {
    const wgt = [0.4, 0.3, 0.2, 0.1]; let x = 0;
    for (let i = 0; i < 4; i++) x += wgt[i] * Math.min(2, fsCount(I.lift, d - 7 * (i + 1) + 1, d - 7 * i) / tgt);
    P.train = fsLv(x);
  }
  // 2. strength: new bests across your tracked lifts in 56 days, and how close your recent top weights are to your best ever
  if (I.g) {
    const act = Object.keys(I.tracked).filter(ex => I.tracked[ex] <= d && I.g.E[ex].some(p => p.di > d - 56 && p.di <= d));
    if (act.length >= 3) {
      const hit = new Set(); I.g.prs.forEach(p => { if (p.di > d - 56 && p.di <= d && act.indexOf(p.ex) >= 0) hit.add(p.ex); });
      let fm = 0;
      act.forEach(ex => {
        const pts = I.g.E[ex].filter(p => p.di <= d), best = Math.max.apply(null, pts.map(p => p.w)), rec = Math.max.apply(null, pts.filter(p => p.di > d - 56).map(p => p.w));
        fm += best > 0 ? rec / best : 1;
      });
      const prLv = fsLv(hit.size / act.length / 0.5), formLv = clamp(100 - (1 - fm / act.length) * 300, 0, 100);
      P.strength = 0.5 * prLv + 0.5 * formLv;
    }
  }
  // 3. effort: time in your two hardest zones and time lifting, per week over 28 days
  // 4. cardio: zone minutes and running distance per week over 28 days, against your Goals
  if (I.firstW != null && d >= I.firstW) {
    const w = I.wos.filter(x => x.di > d - FS_WIN && x.di <= d);
    P.effort = fsLv(((sum(w.map(fsHardMin)) / 4) / FS_HARD_REF + (sum(w.filter(isLift).map(x => x.durMin)) / 4) / FS_LIFTMIN_REF) / 2);
    const rat = [];
    if (C.goalZ2 > 0) rat.push(Math.min(2, sum(w.map(wZoneMin)) / 4 / C.goalZ2));
    if (C.goalRun > 0) rat.push(Math.min(2, sum(w.filter(x => x.runOk).map(x => U.d(x.km))) / 4 / C.goalRun));
    if (rat.length) P.cardio = fsLv(mean(rat));
  }
  // 5. recovery: your average WHOOP recovery over 28 days (HRV and resting heart rate changes show on the growth board)
  const rv = fsVals(I.rec, d - 27, d);
  if (rv.length >= 14) P.recovery = clamp(mean(rv), 0, 100);
  // 6. sleep: hours against your goal, nights of 7 hours or more, and sleep consistency against WHOOP's 70 percent mark
  const sv = fsVals(I.slp, d - 27, d);
  if (sv.length >= 14) {
    const parts = [[0.4, fsLv(mean(sv) / (C.goalSleep || 7.5))], [0.3, fsLv(sv.filter(x => x >= 7).length / sv.length / 0.85)]];
    const cv = fsVals(I.cons, d - 27, d); if (cv.length >= 14) parts.push([0.3, fsLv(mean(cv) / 70)]);
    const tw = sum(parts.map(p => p[0]));
    P.sleep = sum(parts.map(p => p[0] * p[1])) / tw;
  }
  let earned = 0, avail = 0; Object.keys(P).forEach(k => { earned += P[k] * FS_W[k]; avail += FS_W[k]; });
  if (avail < 50 || P.train == null && P.sleep == null) return null;
  // weeks in a row at your lifting target (shown in the text, already counted inside lifting consistency)
  let streak = 0; for (let i = 0; i < 5; i++) { if (fsCount(I.lift, d - 7 * (i + 1) + 1, d - 7 * i) >= tgt) streak++; else break; }
  // idle penalty: after 2 days with no training, 3 points a day, up to 30
  let idle = 60; for (let k = 0; k <= 60; k++) if (I.train.has(d - k)) { idle = k; break; }
  const pen = idle > 2 ? Math.min(30, 3 * (idle - 2)) : 0, base = earned / avail;
  return { di: d, score: clamp(base - pen, 0, 100), base, bonus: 1, streak, idle, pen, P, avail, earned };
}

/* ---------- Momentum: the latest 28 days against the 90 days before them ---------- */
function fsMomentum(byDi, d) {
  const a = d - FS_WIN - FS_BASE_LEN + 1, b = d - FS_WIN, cur = byDi.get(d); if (!cur) return null;
  const rows = []; for (let x = a; x <= b; x++) if (byDi.has(x)) rows.push(byDi.get(x));
  if (rows.length < FS_MIN_BASE) return null;
  // like for like: each area is compared with its own earlier average, and the overall figure is the weighted mean of those changes
  const per = {}; let ws = 0, wm = 0;
  FS_ORDER.forEach(k => {
    const v = rows.filter(r => r.P[k] != null).map(r => r.P[k]);
    if (v.length >= FS_MIN_BASE && cur.P[k] != null) { const m = cur.P[k] - mean(v); per[k] = { base: mean(v), m }; ws += FS_W[k]; wm += FS_W[k] * m; }
  });
  if (ws < 40) return null;
  return { m: wm / ws - cur.pen, base: mean(rows.map(r => r.score)), n: rows.length, per };
}
function fsDeloadWeek(d) {
  try { const a = typeof gProgAt === 'function' ? gProgAt(d) : null, g = GYM; return !!(a && !a.over && g && g.prog && a.cycle === g.prog.cycles && /last/i.test(g.prog.deload || '')); } catch (e) { return false; }
}
function fsStatus(mo, r, d) {
  if (!mo) return null;
  if (r.idle >= 10 || mo.m <= -10) return { k: 'detraining', t: 'Detraining' };
  if (mo.m <= -4) return fsDeloadWeek(d) ? { k: 'recovery', t: 'Recovery week' } : { k: 'slipping', t: 'Slipping' };
  if (mo.m >= 4) return { k: 'building', t: 'Building' };
  return { k: 'holding', t: 'Holding' };
}

function fitnessModel() {
  if (FS && FS.key === M) return FS.val;
  let val = null;
  try {
    if (M && !M.empty && M.days.length >= 45) {
      const I = fsInputs(), A = M.anchor, first = M.days[0].di, all = [], byDi = new Map();
      for (let d = first; d <= A; d++) { const r = fsDay(I, d); if (r) { all.push(r); byDi.set(d, r); } }
      all.forEach(r => { r.mo = fsMomentum(byDi, r.di); r.status = fsStatus(r.mo, r, r.di); });
      const okd = r => r.P.recovery != null && r.P.sleep != null;      // days scored on the WHOOP areas too, so the line is not a different mix of areas early on
      const shown = all.filter(okd), series = shown.filter(x => x.di >= A - 89);
      if (series.length) {
        const now = series[series.length - 1], back = series.filter(x => x.di <= A - 28).pop() || null;
        val = { I, A, all: shown, byDi, series, now, back, change: back ? now.score - back.score : null, best: Math.max.apply(null, series.map(x => x.score)), mo: now.mo, status: now.status };
      }
    }
  } catch (e) { console.error('fitness', e); }
  FS = { key: M, val };
  return val;
}

/* ---------- how far back is this the highest ---------- */
function fsAgo(n) { return n < 14 ? n + (n === 1 ? ' day' : ' days') : n < 70 ? Math.round(n / 7) + ' weeks' : Math.round(n / 30.4) + ' months'; }
function fsHighest(F) {
  const now = F.now.score, full = F.all.filter(r => r.di < F.A);
  if (full.length < 21) return '';
  const prev = full.filter(r => r.score >= now + 1).pop();
  if (!prev) return 'Your highest level in the ' + fsAgo(F.A - full[0].di + 1) + ' of data the score can use.';
  const n = F.A - prev.di; return n < 3 ? '' : 'Highest in ' + fsAgo(n) + '.';
}
function fsLiftLong(F) {            // lifting days in every 4 week stretch since you began logging, which reaches back before WHOOP
  const days = Array.from(F.I.lift).sort((a, b) => a - b); if (days.length < 8) return '';
  const cnt = d => fsCount(F.I.lift, d - 27, d), cur = cnt(F.A), f = days[0];
  if (F.A - f < 70) return '';
  let prev = null; for (let e = F.A - FS_WIN; e >= f + 27; e--) if (cnt(e) >= cur) { prev = e; break; }
  return prev == null ? cur + ' lifting days in the last 4 weeks is the most of any 4 weeks since you began logging on ' + fmtDay(f) + '.' : cur + ' lifting days in the last 4 weeks is the most since ' + fmtDay(prev) + '.';
}

/* ---------- the growth board: measured signals, latest 28 days against the 90 before ---------- */
function fsSignals(F) {
  const I = F.I, A = F.A, nA = A - FS_WIN + 1, bA = A - FS_WIN - FS_BASE_LEN + 1, bB = A - FS_WIN, rows = [];
  const first = M.days[0].di;
  const add = (key, label, now, base, dir, tol, fmt, extra, dfmt) => {
    if (now == null || base == null || !isFinite(now) || !isFinite(base)) return;
    const dl = now - base, read = Math.abs(dl) <= tol ? 'flat' : (dl * dir > 0 ? 'better' : 'worse');
    rows.push({ key, label, now, base, dl, read, fmt, dfmt: dfmt || fmt, extra: extra || '' });
  };
  const mAvg = (map, a, b, min) => { const v = fsVals(map, Math.max(a, first), b); return v.length >= min ? mean(v) : null; };
  // lifting
  if (I.firstLift != null) {
    const s = Math.max(bA, I.firstLift), len = bB - s + 1;
    if (len >= 28) add('lift', 'Lifting days per week', fsCount(I.lift, nA, A) / 4, fsCount(I.lift, s, bB) / len * 7, 1, 0.2, v => nf(v, 1));
  }
  // strength: change in the heaviest working weight per lift, 56 days against the 90 before that
  if (I.g) {
    const chg = [];
    Object.keys(I.tracked).forEach(ex => {
      if (I.tracked[ex] > A) return;
      const pts = I.g.E[ex], nw = pts.filter(p => p.di > A - 56), bs = pts.filter(p => p.di > A - 56 - FS_BASE_LEN && p.di <= A - 56);
      if (nw.length && bs.length) chg.push(Math.max.apply(null, nw.map(p => p.w)) / Math.max.apply(null, bs.map(p => p.w)) - 1);
    });
    if (chg.length >= 3) {
      const up = chg.filter(x => x > 0.005).length, dn = chg.filter(x => x < -0.005).length;
      add('str', 'Heaviest working weights (median change per lift)', median(chg) * 100, 0, 1, 1, v => (v > 0 ? 'up ' : v < 0 ? 'down ' : '') + nf(Math.abs(v), 0) + '%', up + ' of ' + chg.length + ' lifts up, ' + dn + ' down');
    }
  }
  // effort
  const f0 = I.firstW == null ? bA : Math.max(bA, I.firstW), bLen = bB - f0 + 1;
  const wn = I.wos.filter(x => x.di >= nA && x.di <= A), wb = I.wos.filter(x => x.di >= f0 && x.di <= bB);
  if (I.firstW != null && bLen >= 28) {
    add('hard', 'Hard minutes per week (top two zones)', sum(wn.map(fsHardMin)) / 4, sum(wb.map(fsHardMin)) / bLen * 7, 1, 2, v => nf(v, 0) + ' min');
    add('liftmin', 'Minutes lifting per week', sum(wn.filter(isLift).map(x => x.durMin)) / 4, sum(wb.filter(isLift).map(x => x.durMin)) / bLen * 7, 1, 8, v => nf(v, 0) + ' min');
  }
  // speed
  const rn = wn.filter(x => x.runOk), rb = wb.filter(x => x.runOk);
  if (rn.length >= 2 && rb.length >= 2) add('pace', 'Running pace (middle run)', median(rn.map(x => x.paceMin)), median(rb.map(x => x.paceMin)), -1, 0.25, v => Math.floor(v) + ':' + ('0' + (Math.round((v - Math.floor(v)) * 60) % 60)).slice(-2) + ' per ' + U.dU(), rn.length + ' runs now, ' + rb.length + ' before');
  // recovery and sleep
  add('rec', 'Recovery', mAvg(I.rec, nA, A, 14), mAvg(I.rec, bA, bB, 14), 1, 2, v => nf(v, 0) + '%');
  add('hrv', 'Heart rate variability', mAvg(I.hrv, nA, A, 14), mAvg(I.hrv, bA, bB, 14), 1, 2, v => nf(v, 0) + ' ms');
  add('rhr', 'Resting heart rate', mAvg(I.rhr, nA, A, 14), mAvg(I.rhr, bA, bB, 14), -1, 1, v => nf(v, 0) + ' bpm');
  add('slp', 'Sleep per night', mAvg(I.slp, nA, A, 14), mAvg(I.slp, bA, bB, 14), 1, 0.15, v => Math.floor(v) + ' h ' + (Math.round((v - Math.floor(v)) * 60) % 60) + ' min', '', v => Math.round(v * 60) + ' min');
  return rows;
}
function fsDelta(r) {
  if (r.read === 'flat') return 'about the same';
  if (r.key === 'str') return r.fmt(r.dl);
  if (r.key === 'pace') return (r.dl < 0 ? 'faster by ' : 'slower by ') + Math.round(Math.abs(r.dl) * 60) + ' sec';
  return (r.dl > 0 ? 'up ' : 'down ') + r.dfmt(Math.abs(r.dl));
}

/* ---------- your goals, shown next to the score and not part of it ---------- */
function fsGoals(F) {
  const I = F.I, A = F.A, nA = A - FS_WIN + 1, w = I.wos.filter(x => x.di >= nA && x.di <= A), out = [];
  if (C.liftWeekMin > 0 && I.firstLift != null) out.push(['Lifting days per week', fsCount(I.lift, nA, A) / 4, C.liftWeekMin, v => nf(v, 1)]);
  if (C.goalZ2 > 0 && I.firstW != null) out.push(['Minutes in ' + zoneLabel() + ' per week', sum(w.map(wZoneMin)) / 4, C.goalZ2, v => nf(v, 0)]);
  if (C.goalRun > 0 && I.firstW != null) out.push(['Running distance per week (' + U.dU() + ')', sum(w.filter(x => x.runOk).map(x => U.d(x.km))) / 4, C.goalRun, v => nf(v, 1)]);
  const sv = fsVals(I.slp, nA, A); if (C.goalSleep > 0 && sv.length >= 14) out.push(['Hours asleep per night', mean(sv), C.goalSleep, v => nf(v, 1)]);
  return out;
}

/* ---------- display ---------- */
function fsLine(F) {
  const n = F.now, mo = F.mo, st = F.status;
  let t = 'Level ' + nf(n.score, 0) + '.';
  if (mo && st) t += ' Momentum: ' + st.t.toLowerCase() + ', ' + (Math.abs(mo.m) < 1 ? 'level with' : (mo.m > 0 ? 'up ' : 'down ') + nf(Math.abs(mo.m), 0) + ' points against') + ' your baseline (' + fsAgo(mo.n) + ' of history).';
  else t += ' Momentum needs ' + FS_MIN_BASE + ' days of history before the latest 28 days, and it is still building.';
  const hi = fsHighest(F); if (hi) t += ' ' + hi;
  if (n.streak >= 2) t += ' ' + stW(n.streak) + ' in a row at your lifting target.';
  if (n.pen > 0) t += ' ' + stD(n.idle) + ' since you last trained is costing ' + nf(n.pen, 0) + ' points.';
  return t;
}
function fsPillars(F) {
  const mo = F.mo;
  return FS_ORDER.map(k => {
    const v = F.now.P[k], m = mo && mo.per[k] ? mo.per[k].m : null;
    return '<div class="tg"><div class="row"><b>' + esc(FS_NAME[k]) + '</b><span>' + (v == null ? 'not enough data yet' : nf(v, 0) + ' of 100' + (m == null ? '' : Math.abs(m) < 1 ? ', level with baseline' : ', ' + (m > 0 ? 'up ' : 'down ') + nf(Math.abs(m), 0) + ' vs baseline')) + '</span></div>' +
      '<div class="tbar" role="img" aria-label="' + esc(FS_NAME[k] + ': ' + (v == null ? 'no data' : nf(v, 0) + ' of 100')) + '"><i style="width:' + (v == null ? 0 : clamp(v, 0, 100).toFixed(0)) + '%"></i></div></div>';
  }).join('');
}
function fsExplain(F) {
  return formula('LEVEL. Each day is scored from the 28 days that end on it (56 for strength). Six areas, weighted: lifting consistency 20 (the last four weeks against your weekly lifting target, newest week counting 40 percent, then 30, 20, 10), strength 20 (half from the share of your tracked lifts that set a new best in 56 days, half from how close your recent top weights are to your best ever), effort 15 (minutes a week in the two hardest heart rate zones against ' + FS_HARD_REF + ', and minutes lifting against ' + FS_LIFTMIN_REF + '), cardio 15 (zone minutes and running distance per week against your Goals), recovery 15 (your average WHOOP recovery over the 28 days; HRV and resting heart rate changes are on the growth board), sleep 15 (hours against your goal, nights of 7 hours or more, and sleep consistency against 70 percent). Where an area has a Goal or reference, meeting it scores 70, and going past it scores more with diminishing returns (1.5 times the goal is about 89), so completing your Goals is a solid mark, not the top one. Areas without enough data are left out and the rest is scaled to 100. After 2 days without training each further day costs 3 points (up to 30). MOMENTUM. Your Level over the latest 28 days, minus the average Level over the 90 days before those. 4 points or more is Building, within 4 either way is Holding, 4 or more down is Slipping (Recovery week during a planned deload), and 10 down, or 10 days idle, is Detraining. Until 90 days of history exist it uses what exists, at least ' + FS_MIN_BASE + ' days. The weights, the 70 mark and the cutoffs are my design from your own numbers, not a medical or lab measure of fitness; the numbers inside it are measured.');
}
function fsHeroExtra() {
  const F = fitnessModel();
  if (!F) return '<p class="summary">The fitness score needs about 45 days of WHOOP data to start. It is counting already.</p>';
  const pts = F.series.map(x => x.score);
  let nm = ''; try { const a = fsAdvice(F).find(x => x.gain >= 1); if (a) nm = ' <b>Next best move:</b> ' + esc(a.text); } catch (e) { console.error('fitness advice', e); }
  return '<p class="summary">' + esc(fsLine(F)) + nm + '</p>' + (pts.length >= 3 ? sparkline(pts, 220, 34) : '') +
    '<div class="xpline">Fitness level ' + nf(F.now.score, 0) + ' of 100' + (F.status ? ', momentum ' + esc(F.status.t.toLowerCase()) : '') + '. ' + tag('MODELED') + '</div>';
}
function fsBadgeList() {
  const F = fitnessModel(); if (!F) return [];
  const first = t => { const x = F.series.find(s => s.score >= t); return x ? x.di : null; };
  return [60, 75].map(t => ({ id: 'fs' + t, ic: 'F' + t, name: 'Fitness ' + t, desc: 'Reach a fitness level of ' + t, done: F.best >= t, when: first(t), prog: 'best so far: ' + nf(F.best, 0) + ' of ' + t }));
}

/* ---------- what moved it, and what would raise it (MODELED: the same formula run on a "what if") ---------- */
function fsMovers(F) {
  if (!F.back) return [];
  return FS_ORDER.map(k => {
    const a = F.now.P[k], b = F.back.P[k];
    return a == null || b == null ? null : { k, d: a - b };
  }).filter(x => x && Math.abs(x.d) >= 2).sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
}
function fsAdvice(F) {
  const out = [], I = F.I, A = F.A, now = F.now.score;
  const cp = o => Object.assign({}, I, o);
  const withSet = (set, di) => { const n = new Set(set); n.add(di); return n; };
  const trainedToday = I.train.has(A), liftedToday = I.lift.has(A);
  if (!trainedToday) {
    const r = fsDay(cp({ train: withSet(I.train, A) }), A);
    if (r && r.score - now >= 1) out.push({ gain: r.score - now, text: (F.now.idle > 2 ? 'Training today ends the ' + stD(F.now.idle) + ' gap and is worth about ' : 'Any training today is worth about ') + nf(r.score - now, 0) + ' points.' });
  }
  if (!liftedToday) {
    const r = fsDay(cp({ train: withSet(I.train, A), lift: withSet(I.lift, A) }), A);
    if (r && r.score - now >= 1) out.push({ gain: r.score - now, text: 'A lift today is worth about ' + nf(r.score - now, 0) + ' points (it counts toward your weekly target as well).' });
  }
  const weak = FS_ORDER.filter(k => F.now.P[k] != null).map(k => ({ k, r: F.now.P[k] })).sort((p, q) => p.r - q.r)[0];
  if (weak && weak.r < 70) {
    const how = { train: 'Hitting your lifting target each week lifts this fastest.', strength: 'Beat a past weight, or add a rep at the same weight, on a few lifts.', effort: 'Push the hard sets and intervals: more time in the top two heart rate zones, and a little more time lifting.', cardio: 'More weekly zone minutes and running distance, against your Goals.', recovery: 'Slow to move: it follows weeks of steady sleep and easy days.', sleep: 'Aim for 7 hours or more on most nights, at steady times.' }[weak.k];
    out.push({ gain: 0, text: 'Weakest area: ' + FS_NAME[weak.k].toLowerCase() + ' at ' + nf(weak.r, 0) + ' of 100. ' + how });
  }
  return out.sort((p, q) => q.gain - p.gain).slice(0, 3);
}
function fsCard() {
  const F = fitnessModel(); if (!F || F.series.length < 7) return '';
  const adv = fsAdvice(F), mv = fsMovers(F).slice(0, 3), sig = fsSignals(F), goals = fsGoals(F), hi = fsHighest(F), ll = fsLiftLong(F);
  let h = '<section class="card"><div class="sec-h"><h2>Your fitness score over time</h2>' + tag('MODELED') + '</div>';
  h += '<div class="tgs"><div class="tg"><div class="row"><b>Level</b><span>' + nf(F.now.score, 0) + ' of 100</span></div></div>' +
    '<div class="tg"><div class="row"><b>Momentum</b><span>' + (F.status ? esc(F.status.t) + ', ' + (Math.abs(F.mo.m) < 1 ? 'level with' : (F.mo.m > 0 ? 'up ' : 'down ') + nf(Math.abs(F.mo.m), 0) + ' points against') + ' your baseline (' + fsAgo(F.mo.n) + ' of history)' : 'still building a baseline') + '</span></div></div></div>';
  if (hi || ll) h += '<p class="sub">' + esc([hi, ll].filter(Boolean).join(' ')) + '</p>';
  h += lineChart({ title: 'Fitness level, last ' + F.series.length + ' days', w: 720, h: 220, y0: 0, y1: 100, hlines: [{ y: 60, label: '60' }, { y: 75, label: '75' }], series: [{ label: 'Fitness level', unit: '', pts: F.series.map(x => [x.di, Math.round(x.score * 10) / 10]) }] });
  if (mv.length) h += '<p class="sub">What moved it against 28 days ago: ' + esc(mv.map(m => FS_NAME[m.k].toLowerCase() + ' ' + (m.d > 0 ? 'up ' : 'down ') + nf(Math.abs(m.d), 0) + ' points').join(', ')) + '.</p>';
  if (sig.length) {
    h += '<h3 class="st-h3">Are you growing? The latest 28 days against the 90 before</h3><div class="scroll"><table><thead><tr><th>Signal</th><th class="n">Now</th><th class="n">Before</th><th>Change</th></tr></thead><tbody>' +
      sig.map(r => '<tr><td>' + esc(r.label) + '</td><td class="n">' + (r.key === 'str' ? esc(r.extra) : esc(r.fmt(r.now))) + '</td><td class="n">' + (r.key === 'str' ? '' : esc(r.fmt(r.base))) + '</td><td>' + esc(fsDelta(r)) + (r.read === 'flat' ? '' : ' <b>' + (r.read === 'better' ? '(better)' : '(worse)') + '</b>') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  if (goals.length) {
    h += '<h3 class="st-h3">Your goals (tracked next to the score, not graded by it)</h3><ul class="calllist">' +
      goals.map(g => '<li>' + esc(g[0] + ': ' + g[3](g[1]) + ' against a goal of ' + g[3](g[2]) + (g[1] >= g[2] ? '. Met.' : '. Not yet.')) + '</li>').join('') + '</ul>';
  }
  if (adv.length) h += '<h3 class="st-h3">What would raise it</h3><ul class="calllist">' + adv.map(a => '<li>' + esc(a.text) + '</li>').join('') + '</ul>';
  h += formula('each point on the line is the same Level calculation run on the 28 days (56 for strength) ending that day, so history is rebuilt from your records and is never stored. Momentum and the growth board compare the latest 28 days with the 90 days before them; where less than that exists, the baseline is shorter and says so. The "what would raise it" lines rerun today with one extra session added and report the difference.') + '</section>';
  return h;
}
