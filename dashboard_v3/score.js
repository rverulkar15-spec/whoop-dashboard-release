/* ---------- Fitness score: a model of fitness from consistency, strength, cardio, recovery trend and sleep (MODELED) ---------- */
/* It replaces levels and XP. Every day is scored from the 28 days (56 for strength) that end on it, so the line can be drawn back in time. */
var FS = null;
const FS_MAX = { train: 30, strength: 20, cardio: 15, recovery: 20, sleep: 15 };
const FS_NAME = { train: 'Lifting consistency', strength: 'Strength gains', cardio: 'Cardio', recovery: 'Recovery trend', sleep: 'Sleep' };

function fsInputs() {
  const g = typeof gymModel === 'function' ? gymModel() : null;
  const lift = new Set(typeof stLiftDays === 'function' ? stLiftDays().map(x => x.di) : []);
  const train = new Set(lift); M.workouts.forEach(w => { if (sIsTrain(w)) train.add(w.di); });
  const hrv = new Map(), rhr = new Map(), slp = new Map();
  M.days.forEach(d => {
    if (d.okRec && isNum(d.hrv) && !hrv.has(d.di)) hrv.set(d.di, d.hrv);
    if (d.okRec && isNum(d.rhr) && !rhr.has(d.di)) rhr.set(d.di, d.rhr);
    if (d.okSleep && d.main && d.main.asleep != null && !slp.has(d.di)) slp.set(d.di, d.main.asleep / HOUR);
  });
  const tracked = {}; if (g) Object.keys(g.E).forEach(ex => { if (g.E[ex].length >= 5) tracked[ex] = g.E[ex][4].di; });
  const wos = M.workouts.filter(w => w.scored);
  return { g, lift, train, hrv, rhr, slp, tracked, wos, firstLift: lift.size ? Math.min.apply(null, Array.from(lift)) : null, firstW: wos.length ? Math.min.apply(null, wos.map(w => w.di)) : null };
}
function fsCount(set, a, b) { let n = 0; for (let d = a; d <= b; d++) if (set.has(d)) n++; return n; }
function fsVals(map, a, b) { const o = []; for (let d = a; d <= b; d++) if (map.has(d)) o.push(map.get(d)); return o; }

function fsDay(I, d) {
  const P = {}, tgt = Math.max(1, C.liftWeekMin || 3);
  // 1. lifting consistency: the last four weeks against your weekly target, recent weeks counting more
  if (I.firstLift != null && d >= I.firstLift) {
    const wgt = [0.4, 0.3, 0.2, 0.1]; let a = 0;
    for (let i = 0; i < 4; i++) a += wgt[i] * Math.min(1, fsCount(I.lift, d - 7 * (i + 1) + 1, d - 7 * i) / tgt);
    P.train = FS_MAX.train * a;
  }
  // 2. strength gains: how many of your tracked lifts set a new best in the last 56 days
  if (I.g) {
    const tr = Object.keys(I.tracked).filter(ex => I.tracked[ex] <= d);
    if (tr.length >= 3) {
      const hit = new Set(); I.g.prs.forEach(p => { if (p.di > d - 56 && p.di <= d && I.tracked[p.ex] != null) hit.add(p.ex); });
      P.strength = FS_MAX.strength * Math.min(1, hit.size / tr.length / 0.5);
    }
  }
  // 3. cardio: zone minutes and running distance per week over 28 days, against your goals
  if (I.firstW != null && d >= I.firstW) {
    const w = I.wos.filter(x => x.di > d - 28 && x.di <= d), rat = [];
    if (C.goalZ2 > 0) rat.push(Math.min(1, sum(w.map(wZoneMin)) / 4 / C.goalZ2));
    if (C.goalRun > 0) rat.push(Math.min(1, sum(w.filter(x => x.runOk).map(x => U.d(x.km))) / 4 / C.goalRun));
    if (rat.length) P.cardio = FS_MAX.cardio * mean(rat);
  }
  // 4. recovery trend: 28 day HRV and resting heart rate against the 56 days before that. Level means no change, so half credit
  const hw = fsVals(I.hrv, d - 27, d), hb = fsVals(I.hrv, d - 83, d - 28), rw = fsVals(I.rhr, d - 27, d), rb = fsVals(I.rhr, d - 83, d - 28);
  if (hw.length >= 14 && hb.length >= 14 && rw.length >= 14 && rb.length >= 14) {
    const h = clamp(0.5 + (mean(hw) / mean(hb) - 1) / 0.20, 0, 1), r = clamp(0.5 + (mean(rb) / mean(rw) - 1) / 0.10, 0, 1);
    P.recovery = FS_MAX.recovery * (h + r) / 2;
  }
  // 5. sleep: hours against your goal, and how many nights reached 7 hours
  const sv = fsVals(I.slp, d - 27, d);
  if (sv.length >= 14) P.sleep = FS_MAX.sleep * (0.5 * Math.min(1, mean(sv) / (C.goalSleep || 7.5)) + 0.5 * sv.filter(x => x >= 7).length / sv.length);
  let earned = 0, avail = 0; Object.keys(P).forEach(k => { earned += P[k]; avail += FS_MAX[k]; });
  if (avail < 50 || P.train == null && P.sleep == null) return null;
  // stack bonus: each full week in a row at your lifting target adds 2 percent, up to 5 weeks
  let streak = 0; for (let i = 0; i < 5; i++) { if (fsCount(I.lift, d - 7 * (i + 1) + 1, d - 7 * i) >= tgt) streak++; else break; }
  // idle penalty: after 2 days with no training, 3 points a day, up to 30
  let idle = 60; for (let k = 0; k <= 60; k++) if (I.train.has(d - k)) { idle = k; break; }
  const bonus = 1 + 0.02 * streak, pen = idle > 2 ? Math.min(30, 3 * (idle - 2)) : 0, base = earned / avail * 100;
  return { di: d, score: clamp(base * bonus - pen, 0, 100), base, bonus, streak, idle, pen, P, avail, earned };
}

function fitnessModel() {
  if (FS && FS.key === M) return FS.val;
  let val = null;
  try {
    if (M && !M.empty && M.days.length >= 45) {
      const I = fsInputs(), A = M.anchor, from = Math.max(M.days[0].di, A - 89), series = [];
      for (let d = from; d <= A; d++) { const r = fsDay(I, d); if (r) series.push(r); }
      if (series.length) {
        const now = series[series.length - 1], back = series.filter(x => x.di <= A - 28).pop() || null;
        val = { series, now, back, change: back ? now.score - back.score : null, best: Math.max.apply(null, series.map(x => x.score)) };
      }
    }
  } catch (e) { console.error('fitness', e); }
  FS = { key: M, val };
  return val;
}

function fsPillars(F) {
  return Object.keys(FS_MAX).map(k => {
    const v = F.now.P[k];
    return '<div class="tg"><div class="row"><b>' + esc(FS_NAME[k]) + '</b><span>' + (v == null ? 'not enough data yet' : nf(v, 0) + ' of ' + FS_MAX[k]) + '</span></div>' +
      '<div class="tbar" role="img" aria-label="' + esc(FS_NAME[k] + ': ' + (v == null ? 'no data' : nf(v / FS_MAX[k] * 100, 0) + ' percent')) + '"><i style="width:' + (v == null ? 0 : clamp(v / FS_MAX[k] * 100, 0, 100).toFixed(0)) + '%"></i></div></div>';
  }).join('');
}
function fsLine(F) {
  const n = F.now, ch = F.change;
  let t = ch == null ? 'Not enough history yet to say which way it is moving.' : Math.abs(ch) < 1.5 ? 'Steady against 28 days ago.' : (ch > 0 ? 'Up ' : 'Down ') + nf(Math.abs(ch), 0) + ' points against 28 days ago.';
  if (n.streak >= 1) t += ' ' + stW(n.streak) + ' in a row at your lifting target adds a ' + nf((n.bonus - 1) * 100, 0) + ' percent bonus.';
  if (n.pen > 0) t += ' ' + stD(n.idle) + ' since you last trained is costing ' + nf(n.pen, 0) + ' points.';
  return t;
}
function fsExplain(F) {
  return formula('each day is scored from the 28 days that end on it. Five pillars, each worth a fixed number of points: lifting consistency 30 (the last four weeks against your weekly lifting target, newest week counting 40 percent, then 30, 20, 10), strength gains 20 (the share of your tracked lifts that set a new best in 56 days, full marks at half of them), cardio 15 (zone minutes and running distance per week against your Goals), recovery trend 20 (28 day HRV and resting heart rate against the 56 days before, no change earns half), sleep 15 (hours against your goal and nights of 7 hours or more). Pillars without enough data are left out and the rest is scaled to 100. Then each full week in a row at your lifting target adds 2 percent (up to 5 weeks), and after 2 days without training each further day costs 3 points (up to 30). The result is held between 0 and 100. It is a model I built from your own numbers, not a medical or lab measure of fitness; the numbers inside it are measured.');
}
function fsHeroExtra() {
  const F = fitnessModel();
  if (!F) return '<p class="summary">The fitness score needs about 45 days of WHOOP data to start. It is counting already.</p>';
  const pts = F.series.map(x => x.score);
  return '<p class="summary">' + esc(fsLine(F)) + '</p>' + (pts.length >= 3 ? sparkline(pts, 220, 34) : '') +
    '<div class="xpline">Fitness score ' + nf(F.now.score, 0) + ' of 100. Best in this view: ' + nf(F.best, 0) + '. ' + tag('MODELED') + '</div>';
}
function fsBadgeList() {
  const F = fitnessModel(); if (!F) return [];
  const first = t => { const x = F.series.find(s => s.score >= t); return x ? x.di : null; };
  return [60, 75].map(t => ({ id: 'fs' + t, ic: 'F' + t, name: 'Fitness ' + t, desc: 'Reach a fitness score of ' + t, done: F.best >= t, when: first(t), prog: 'best so far: ' + nf(F.best, 0) + ' of ' + t }));
}
