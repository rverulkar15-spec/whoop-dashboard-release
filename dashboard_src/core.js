'use strict';
/* WHOOP dashboard. One file, no external dependencies. */
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = x => typeof x === 'number' && isFinite(x);
const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => a.length ? sum(a) / a.length : null;
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) * (x - m))) / (a.length - 1)); };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pctRank = (x, a) => a.length ? 100 * a.filter(v => v <= x).length / a.length : null;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const last = a => a.length ? a[a.length - 1] : null;
const nn = a => a.filter(isNum);

/* ---------- storage that never throws ---------- */
const store = {
  ok: (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return true; } catch (e) { return false; } })(),
  mem: {},
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return this.mem[k] || null; } },
  set(k, v) { this.mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};

/* ---------- controls ---------- */
const DEFAULTS = {
  baselineDays: 30, shortDays: 7, readDays: 28, bandSD: 1, chartDays: 120, minN: 20,
  inclCalib: false, inclNaps: false, inclLong: false, longH: 36,
  tz: 'record',
  z1: false, z2: true, z3: false, z4: false, z5: false,
  debtDays: 7, debtMode: 'net', debtNeed: 'baseline',
  wR: 50, wS: 30, wH: 20,
  bandHi: 67, bandLo: 34,
  runMinKmh: 5, runMaxKmh: 25, rampPct: 10, liftWeekMin: 3, gapLift: 4, gapRun: 7, jointAlert: 4,
  uWeight: 'lb', uLen: 'in', uDist: 'mi', uClock: '12'
};
let C = Object.assign({}, DEFAULTS, store.get('whoopDash.controls.v1') || {});
const saveControls = () => store.set('whoopDash.controls.v1', C);

/* ---------- units and formatting ---------- */
const KG_LB = 2.2046226218, CM_IN = 1 / 2.54, KM_MI = 0.621371192;
const U = {
  w: kg => C.uWeight === 'lb' ? kg * KG_LB : kg, wU: () => C.uWeight,
  wIn: v => C.uWeight === 'lb' ? v / KG_LB : v,
  l: cm => C.uLen === 'in' ? cm * CM_IN : cm, lU: () => C.uLen,
  lIn: v => C.uLen === 'in' ? v / CM_IN : v,
  d: km => C.uDist === 'mi' ? km * KM_MI : km, dU: () => C.uDist
};
const nf = (x, d = 1) => isNum(x) ? x.toFixed(d) : '';
const ord = n => { const v = Math.round(n), s = ['th', 'st', 'nd', 'rd'], m = v % 100; return v + (s[(m - 20) % 10] || s[m] || s[0]); };
const dStr = di => new Date(di * DAY).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WKD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtDay = di => { const d = new Date(di * DAY); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); };
const wkdOf = di => ((di % 7) + 7 + 3) % 7;               // Monday = 0
const fmtDayW = di => WKD[wkdOf(di)] + ' ' + fmtDay(di);
const fmtClock = h => {                                    // h = hours since midnight, may exceed 24
  const t = ((h % 24) + 24) % 24, hh = Math.floor(t), mm = Math.round((t - hh) * 60), h2 = mm === 60 ? hh + 1 : hh, m2 = mm === 60 ? 0 : mm;
  if (C.uClock === '24') return String(h2 % 24).padStart(2, '0') + ':' + String(m2).padStart(2, '0');
  const ap = h2 % 24 >= 12 ? 'pm' : 'am', x = h2 % 12 === 0 ? 12 : h2 % 12;
  return x + ':' + String(m2).padStart(2, '0') + ' ' + ap;
};
const fmtHM = h => { if (!isNum(h)) return ''; const t = Math.round(h * 60); return Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0') + ' min'; };
const fmtMin = m => isNum(m) ? Math.round(m) + ' min' : '';
const fmtPace = minPerUnit => { if (!isNum(minPerUnit) || minPerUnit <= 0) return ''; let m = Math.floor(minPerUnit), s = Math.round((minPerUnit - m) * 60); if (s === 60) { m++; s = 0; } return m + ':' + String(s).padStart(2, '0'); };
const ago = ms => { const h = ms / HOUR; return h < 1 ? Math.max(1, Math.round(ms / MINUTE)) + ' minutes' : h < 48 ? nf(h, 1) + ' hours' : nf(h / 24, 1) + ' days'; };
const sign = (x, d = 1) => (x > 0 ? 'up ' : x < 0 ? 'down ' : 'no change ') + (x === 0 ? '' : nf(Math.abs(x), d));
const arrow = x => x > 0 ? '▲' : x < 0 ? '▼' : '●';
const tag = t => '<span class="tag ' + ({ MEASURED: 'm', MODELED: 'd', 'USER ENTERED': 'u' }[t] || 'm') + '">' + t + '</span>';
const formula = html => '<p class="f"><b>Formula:</b> ' + html + '</p>';

/* ---------- time helpers ---------- */
const parseOff = s => { const m = /^([+-])(\d\d):(\d\d)$/.exec(s || ''); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * HOUR + +m[3] * MINUTE) : 0; };
const dIdx = (ts, o) => Math.floor((ts + o) / DAY);
const hourOfDay = (ts, o) => (((ts + o) % DAY) + DAY) % DAY / HOUR;
const weekStart = di => di - wkdOf(di);

/* ---------- spearman correlation ---------- */
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
  return r;
}
function pearson(x, y) {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
function spearman(pairs) {
  const p = pairs.filter(q => isNum(q[0]) && isNum(q[1])), n = p.length;
  if (n < 5) return { n, rho: null, p: null };
  const rho = pearson(ranks(p.map(q => q[0])), ranks(p.map(q => q[1])));
  if (rho == null) return { n, rho: null, p: null };
  const z = Math.atanh(clamp(rho, -0.9999, 0.9999)) * Math.sqrt(Math.max(n - 3, 1));
  return { n, rho, p: 2 * (1 - normCdf(Math.abs(z))) };
}
const strengthWord = r => { const a = Math.abs(r); return a < 0.2 ? 'weak' : a < 0.4 ? 'modest' : a < 0.6 ? 'moderate' : 'strong'; };

/* ---------- model ---------- */
const SPORT_ICON = { weightlifting: 'L', running: 'R', walking: 'W', sauna: 'S', 'hot-yoga': 'Y', yoga: 'Y', hot_tub: 'H', 'steam-room': 'T', soccer: 'F', dance: 'D', activity: 'A', stretching: 'X', 'functional-fitness': 'G', increase_relaxation: 'Z' };
const sportName = s => String(s || 'unknown').replace(/[-_]/g, ' ');
const UNSCORED_TYPES = ['sauna', 'hot_tub', 'steam-room', 'increase_relaxation', 'stretching'];

function buildModel(data, C) {
  const offOf = r => C.tz === 'record' ? parseOff(r.timezone_offset) : Number(C.tz) * HOUR;
  const M = { empty: !(data && data.cycles && data.cycles.length), data, C };
  if (M.empty) return M;

  const recByCid = new Map((data.recovery || []).map(r => [r.cycle_id, r]));
  const sleeps = (data.sleep || []).map(s => {
    const sc = s.score || null, ss = sc && sc.stage_summary || null, sn = sc && sc.sleep_needed || null, o = offOf(s);
    const g = (x, k) => x && isNum(x[k]) ? x[k] : null;
    const light = g(ss, 'total_light_sleep_time_milli'), sws = g(ss, 'total_slow_wave_sleep_time_milli'), rem = g(ss, 'total_rem_sleep_time_milli');
    const asleep = light != null && sws != null && rem != null ? light + sws + rem : null;
    const parts = sn ? [g(sn, 'baseline_milli'), g(sn, 'need_from_sleep_debt_milli'), g(sn, 'need_from_recent_strain_milli'), g(sn, 'need_from_recent_nap_milli')] : null;
    return {
      id: s.id, cid: s.cycle_id, start: Date.parse(s.start), end: Date.parse(s.end), o, nap: !!s.nap, state: s.score_state,
      inBed: g(ss, 'total_in_bed_time_milli'), awake: g(ss, 'total_awake_time_milli'), light, sws, rem, asleep,
      cycles: g(ss, 'sleep_cycle_count'), dist: g(ss, 'disturbance_count'),
      perf: g(sc, 'sleep_performance_percentage'), cons: g(sc, 'sleep_consistency_percentage'), eff: g(sc, 'sleep_efficiency_percentage'), resp: g(sc, 'respiratory_rate'),
      base: g(sn, 'baseline_milli'), debtNeed: g(sn, 'need_from_sleep_debt_milli'), strainNeed: g(sn, 'need_from_recent_strain_milli'), napNeed: g(sn, 'need_from_recent_nap_milli'),
      need: parts && parts.every(isNum) ? sum(parts) : null
    };
  }).filter(s => isNum(s.start) && isNum(s.end)).sort((a, b) => a.start - b.start);
  const mainBy = new Map(), napsBy = new Map();
  sleeps.forEach(s => { const m = s.nap ? napsBy : mainBy; if (!m.has(s.cid)) m.set(s.cid, []); m.get(s.cid).push(s); });

  const cycles = (data.cycles || []).map(c => {
    const sc = c.score || null, o = offOf(c);
    return {
      id: c.id, start: Date.parse(c.start), end: c.end ? Date.parse(c.end) : null, o, state: c.score_state,
      strain: sc && isNum(sc.strain) ? sc.strain : null, kj: sc && isNum(sc.kilojoule) ? sc.kilojoule : null,
      avgHR: sc && isNum(sc.average_heart_rate) ? sc.average_heart_rate : null, maxHR: sc && isNum(sc.max_heart_rate) ? sc.max_heart_rate : null,
      steps: isNum(c.step_count) ? c.step_count : null
    };
  }).filter(c => isNum(c.start)).sort((a, b) => a.start - b.start);

  const days = cycles.map((c, i) => {
    const mains = (mainBy.get(c.id) || []).slice().sort((a, b) => (b.inBed || 0) - (a.inBed || 0));
    const main = mains[0] || null, naps = napsBy.get(c.id) || [];
    const r = recByCid.get(c.id) || null, rs = r && r.score || null;
    const gv = k => rs && isNum(rs[k]) ? rs[k] : null;
    const d = Object.assign({}, c, {
      i, main, naps, open: c.end == null, lenH: c.end != null ? (c.end - c.start) / HOUR : null,
      di: main ? dIdx(main.end, main.o) : dIdx(c.start, c.o),
      recState: r ? r.score_state : null, calibrating: !!(rs && rs.user_calibrating),
      recovery: gv('recovery_score'), hrv: gv('hrv_rmssd_milli'), rhr: gv('resting_heart_rate'), spo2: gv('spo2_percentage'), skin: gv('skin_temp_celsius'), hasRec: !!rs
    });
    d.long = d.lenH != null && d.lenH > C.longH;
    d.okRec = d.hasRec && d.recState === 'SCORED' && (C.inclCalib || !d.calibrating);
    d.okSleep = !!main && main.state === 'SCORED';
    d.okStrain = !d.open && d.strain != null && (C.inclLong || !d.long);
    d.napAsleep = sum(naps.map(n => n.asleep || 0));
    return d;
  });
  days.forEach((d, i) => { const p = days[i - 1]; d.prev = p && p.end === d.start ? p : null; });

  const workouts = (data.workouts || []).map(w => {
    const sc = w.score || null, o = offOf(w), z = sc && sc.zone_durations || null, start = Date.parse(w.start), end = Date.parse(w.end);
    const g = k => sc && isNum(sc[k]) ? sc[k] : null;
    const wk = {
      id: w.id, sport: w.sport_name || 'unknown', start, end, o, di: dIdx(start, o), hour: hourOfDay(start, o), durMin: (end - start) / MINUTE,
      scored: !!sc, strain: g('strain'), avgHR: g('average_heart_rate'), maxHR: g('max_heart_rate'), kj: g('kilojoule'), pct: g('percent_recorded'),
      dist: g('distance_meter'), altGain: g('altitude_gain_meter'),
      zones: z ? ['zone_zero_milli', 'zone_one_milli', 'zone_two_milli', 'zone_three_milli', 'zone_four_milli', 'zone_five_milli'].map(k => isNum(z[k]) ? z[k] : 0) : null
    };
    return wk;
  }).filter(w => isNum(w.start)).sort((a, b) => a.start - b.start);

  // run validity
  workouts.forEach(w => {
    if (w.sport !== 'running') return;
    if (w.dist == null) { w.runOk = false; w.runWhy = 'no distance recorded'; return; }
    w.km = w.dist / 1000; w.kmh = w.km / (w.durMin / 60);
    if (w.kmh < C.runMinKmh || w.kmh > C.runMaxKmh) { w.runOk = false; w.runWhy = 'implied speed ' + nf(w.kmh, 1) + ' km/h is outside ' + C.runMinKmh + ' to ' + C.runMaxKmh; return; }
    w.runOk = true; w.paceMin = w.durMin / (U.d(w.km)); w.beatsPer = w.avgHR != null ? w.avgHR * w.durMin / U.d(w.km) : null;
  });

  // attach workouts to cycles
  days.forEach(d => { d.workouts = []; });
  workouts.forEach(w => {
    let lo = 0, hi = days.length - 1, f = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m].start <= w.start) { f = m; lo = m + 1; } else hi = m - 1; }
    if (f >= 0 && (days[f].end == null || w.start < days[f].end)) { days[f].workouts.push(w); w.dayIdx = f; }
  });

  // anchor: latest cycle that has a main sleep and a recovery
  const withRec = days.filter(d => d.main && d.hasRec);
  const anchorDay = last(withRec) || last(days.filter(d => d.main)) || last(days);
  const dm = days.filter(d => d.main).sort((a, b) => a.main.start - b.main.start);

  Object.assign(M, {
    days, sleeps, workouts, anchorDay, anchor: anchorDay.di, dm,
    runs: workouts.filter(w => w.sport === 'running'),
    openDay: days.find(d => d.open) || null
  });
  M.lastDone = last(days.filter(d => !d.open && d.strain != null));

  // time zone changes
  const tz = [];
  days.forEach(d => { const p = days[d.i - 1]; if (!p || p.o !== d.o) tz.push({ at: d.start, o: d.o }); });
  M.tzChanges = tz;
  return M;
}

/* next recovery after an event ending at time t */
function nextRecovery(M, t) {
  const dm = M.dm; let lo = 0, hi = dm.length - 1, f = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dm[m].main.start >= t) { f = m; hi = m - 1; } else lo = m + 1; }
  if (f < 0) return null;
  const d = dm[f];
  return d.main.start - t <= 36 * HOUR && d.okRec ? d : null;
}

/* metric catalog: raw value and the inclusion rule used for baselines */
const METRICS = {
  recovery: { label: 'recovery_score', unit: '%', dec: 0, better: 'up', raw: d => d.recovery, inc: d => d.okRec },
  hrv: { label: 'hrv_rmssd_milli', unit: ' ms', dec: 1, better: 'up', raw: d => d.hrv, inc: d => d.okRec },
  rhr: { label: 'resting_heart_rate', unit: ' bpm', dec: 0, better: 'down', raw: d => d.rhr, inc: d => d.okRec },
  spo2: { label: 'spo2_percentage', unit: '%', dec: 1, better: null, raw: d => d.spo2, inc: d => d.okRec },
  skin: { label: 'skin_temp_celsius', unit: ' °C', dec: 2, better: null, raw: d => d.skin, inc: d => d.okRec },
  resp: { label: 'respiratory_rate', unit: ' br/min', dec: 2, better: null, raw: d => d.main ? d.main.resp : null, inc: d => d.okSleep },
  perf: { label: 'sleep_performance_percentage', unit: '%', dec: 0, better: 'up', raw: d => d.main ? d.main.perf : null, inc: d => d.okSleep },
  eff: { label: 'sleep_efficiency_percentage', unit: '%', dec: 1, better: 'up', raw: d => d.main ? d.main.eff : null, inc: d => d.okSleep },
  cons: { label: 'sleep_consistency_percentage', unit: '%', dec: 0, better: 'up', raw: d => d.main ? d.main.cons : null, inc: d => d.okSleep },
  asleep: { label: 'Hours asleep', unit: ' h', dec: 2, better: null, raw: d => d.main && d.main.asleep != null ? (d.main.asleep + (C.inclNaps ? d.napAsleep : 0)) / HOUR : null, inc: d => d.okSleep },
  inbed: { label: 'Hours in bed', unit: ' h', dec: 2, better: null, raw: d => d.main && d.main.inBed != null ? d.main.inBed / HOUR : null, inc: d => d.okSleep },
  strain: { label: 'strain (completed days)', unit: '', dec: 1, better: null, raw: d => d.strain, inc: d => d.okStrain },
  steps: { label: 'step_count', unit: '', dec: 0, better: null, raw: d => d.steps, inc: d => d.okStrain }
};
const rawv = (m, d) => { const x = METRICS[m].raw(d); return isNum(x) ? x : null; };
const incv = (m, d) => METRICS[m].inc(d) ? rawv(m, d) : null;

function valsIn(M, m, a, b) {
  const out = [];
  M.days.forEach(d => { if (d.di >= a && d.di <= b) { const v = incv(m, d); if (v != null) out.push(v); } });
  return out;
}
/* baseline over the n days strictly before day index di */
function baselineAt(M, m, di, n) {
  const v = valsIn(M, m, di - n, di - 1);
  return { n: v.length, vals: v, mean: mean(v), sd: sd(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, a: di - n, b: di - 1 };
}

/* weekly aggregation */
function weeklyTable(M, nWeeks) {
  const aw = weekStart(M.anchor), rows = [];
  for (let k = nWeeks - 1; k >= 0; k--) {
    const ws = aw - 7 * k, we = ws + 6;
    rows.push({ ws, we, partial: we > M.anchor, workouts: M.workouts.filter(w => w.di >= ws && w.di <= we) });
  }
  return rows;
}

/* sleep debt (MODELED) over the last debtDays nights ending at anchor */
function sleepDebt(M, upto) {
  const a = upto - C.debtDays + 1, rows = [];
  M.days.forEach(d => {
    if (d.di < a || d.di > upto || !d.okSleep || d.main.asleep == null) return;
    const need = C.debtNeed === 'baseline' ? d.main.base : d.main.need;
    if (need == null) return;
    const got = d.main.asleep + (C.inclNaps ? d.napAsleep : 0);
    rows.push({ d, short: (need - got) / HOUR });
  });
  if (!rows.length) return null;
  const bal = C.debtMode === 'net' ? sum(rows.map(r => r.short)) : sum(rows.map(r => Math.max(0, r.short)));
  return { n: rows.length, balance: bal, rows };
}
