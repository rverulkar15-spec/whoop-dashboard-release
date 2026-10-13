/* ---------- Gym log from MacroFactor: model, program plan, Strength section ---------- */
/* Weights in the export are pounds. They are shown in your unit setting. Lift progress uses the heaviest weight actually lifted, never an estimate. */
var GYM;                                   // undefined until first use, then the model or null
const G_BW = /(chin|pull)[- ]?up|(^|\s)dips?(\s|$)/i;     // lifts where your body weight is part of the load
const G_SETS_GOAL = 10;                    // weekly hard sets per muscle often linked to growth (a guide, not a rule)

function gDi(s) { const p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY; }
function gLb(v) { return C.uWeight === 'lb' ? v : v / KG_LB; }
function gUnit() { return C.uWeight === 'lb' ? 'lb' : 'kg'; }
function gW(v) { const x = gLb(v); return nf(x, C.uWeight === 'lb' ? (Math.abs(x - Math.round(x)) > 0.05 ? 1 : 0) : 1) + ' ' + gUnit(); }
function gWt(ex, v) { return (G_BW.test(ex) ? '+' : '') + gW(v); }
function gVol(v) { return Math.round(gLb(v)).toLocaleString('en-US') + ' ' + gUnit(); }
function gTry(v) { return C.uWeight === 'lb' ? nf(v, v % 1 ? 1 : 0) + ' lb' : nf(Math.round(gLb(v) * 2) / 2, 1) + ' kg'; }
function gWork(s) { return s.type !== 'Warm-Up Set'; }
function gToday() { const A = M && M.anchorDay; const t = A ? dIdx(Date.now(), A.o) : (M ? M.anchor : 0); return Math.max(t, M ? M.anchor : 0); }
function gE1(g, ex, s) {                   // Epley with reps in reserve counted as reps you could have done
  if (!isNum(s.w) || !isNum(s.reps) || s.reps < 1) return null;
  const k = s.reps + (isNum(s.rir) ? s.rir : 0); if (k > 15) return null;
  const load = s.w + (g.bw && G_BW.test(ex) ? g.bw : 0); if (!(load > 0)) return null;
  return load * (1 + k / 30);
}

function gymModel() {
  if (GYM !== undefined) return GYM;
  GYM = null;
  try {
    const el = document.getElementById('gym-data'); const raw = el ? JSON.parse(el.textContent) : null;
    if (!raw || !Array.isArray(raw.sessions) || !raw.sessions.length) return GYM;
    const g = { sessions: [], byDi: new Map(), days: new Set(), E: {}, H: {}, prs: [], muscles: {}, bw: 0, prog: null, exportDi: null, lastDi: null, exported: null };
    GYM = g;
    g.sessions = raw.sessions.map(s => Object.assign({}, s, { di: gDi(s.date) })).sort((a, b) => a.di - b.di || String(a.workout).localeCompare(String(b.workout)));
    g.sessions.forEach(s => { if (!g.byDi.has(s.di)) g.byDi.set(s.di, []); g.byDi.get(s.di).push(s); g.days.add(s.di); });
    Object.keys(raw.history || {}).forEach(ex => {
      g.H[ex] = Object.keys(raw.history[ex]).sort().map(d => { const v = raw.history[ex][d]; g.days.add(gDi(d)); return { di: gDi(d), e1: v[0], top: v[1], sets: v[2], vol: v[3] }; });
    });
    Object.keys(raw.muscles || {}).forEach(d => { g.muscles[gDi(d)] = raw.muscles[d]; });
    g.lastDi = Math.max.apply(null, Array.from(g.days));
    const ed = raw.source && raw.source.exported_on; g.exported = ed || null; g.exportDi = ed ? gDi(ed) : g.lastDi;

    // body weight, read from the difference between MacroFactor's heaviest weight and the weight you added
    const bws = [];
    g.sessions.forEach(s => {
      const by = {}; s.sets.forEach(x => { if (gWork(x) && G_BW.test(x.ex) && isNum(x.w)) by[x.ex] = Math.max(by[x.ex] == null ? -1 : by[x.ex], x.w); });
      Object.keys(by).forEach(ex => { const pt = (g.H[ex] || []).find(p => p.di === s.di); if (pt && isNum(pt.top)) bws.push(pt.top - by[ex]); });
    });
    if (bws.length >= 2) { const m = median(bws); if (m >= 60 && m <= 400) g.bw = m; }

    // strength series per lift: the heaviest weight actually lifted in a working set (never an estimate)
    const put = (ex, di, w, reps) => { if (!isNum(w) || !(w > 0)) return; const arr = g.E[ex] = g.E[ex] || [], o = arr.find(p => p.di === di);
      if (!o) arr.push({ di, w, reps: reps || null }); else if (w > o.w) { o.w = w; o.reps = reps || null; } else if (w === o.w && reps > (o.reps || 0)) o.reps = reps; };
    g.sessions.forEach(s => {
      const by = {}; s.sets.forEach(x => { if (gWork(x) && isNum(x.w) && isNum(x.reps) && x.reps >= 1) (by[x.ex] = by[x.ex] || []).push(x); });
      Object.keys(by).forEach(ex => { by[ex].forEach(x => put(ex, s.di, x.w, x.reps)); });
    });
    Object.keys(g.H).forEach(ex => {
      g.H[ex].forEach(p => {
        if (g.E[ex] && g.E[ex].some(q => q.di === p.di)) return;
        if (!isNum(p.top)) return;
        let t = p.top; if (G_BW.test(ex)) { if (!g.bw) return; t = p.top - g.bw; }
        put(ex, p.di, Math.round(t * 10) / 10, null);
      });
    });
    Object.keys(g.E).forEach(ex => { g.E[ex].sort((a, b) => a.di - b.di); });
    Object.keys(g.E).forEach(ex => {
      let mx = 0, mr = 0;      // a best is a heavier weight, or the same weight for more reps
      g.E[ex].forEach((p, i) => {
        const r = p.reps || 0;
        if (i >= 2 && (p.w > mx || (p.w === mx && r > mr))) g.prs.push({ ex, di: p.di, w: p.w, reps: p.reps, prev: mx });
        if (p.w > mx) { mx = p.w; mr = r; } else if (p.w === mx && r > mr) mr = r;
      });
    });
    g.prs.sort((a, b) => a.di - b.di);

    // program: line the plan up with the calendar using the sessions you actually logged
    const P = raw.program;
    if (P && Array.isArray(P.plan) && P.plan.length) {
      const mine = g.sessions.filter(s => s.workout && (!s.program || !P.name || s.program === P.name));
      if (mine.length) {
        const f = mine[0], k = P.plan[0].days.findIndex(d => !d.rest && d.workout === f.workout);
        if (k >= 0) {
          const start = f.di - k;
          const ok = mine.filter(s => { const c = Math.floor((s.di - start) / 7), sl = (s.di - start) % 7, pl = P.plan[c] && P.plan[c].days[sl]; return pl && !pl.rest && pl.workout === s.workout; }).length;
          if (ok / mine.length >= 0.7) g.prog = { name: P.name || 'Your program', cycles: P.cycles || P.plan.length, deload: P.deload || '', plan: P.plan, start, aligned: ok, of: mine.length };
        }
      }
    }
  } catch (e) { console.error('gym', e); GYM = null; }
  return GYM;
}

/* ---------- program calendar ---------- */
function gProgAt(di) {
  const p = GYM && GYM.prog; if (!p || di < p.start) return null;
  const c = Math.floor((di - p.start) / 7); if (c >= p.plan.length) return { over: true, cycle: c + 1 };
  const sl = (di - p.start) % 7, day = p.plan[c].days[sl];
  return day ? { cycle: c + 1, slot: sl, day, di } : null;
}
function gStatus(di, todayDi) {
  const a = gProgAt(di); if (!a || a.over || a.day.rest) return null;
  const has = d => (GYM.byDi.get(d) || []).some(s => s.workout === a.day.workout);
  if (has(di)) return 'done';
  for (let d = di - a.slot; d < di - a.slot + 7; d++) if (has(d)) return 'shifted';
  if (di === todayDi) return 'today';
  if (di > todayDi || di > GYM.exportDi) return 'upcoming';
  return 'missed';
}
function gNext(fromDi, todayDi) {
  for (let d = fromDi; d < fromDi + 21; d++) {
    const a = gProgAt(d); if (!a) continue; if (a.over) return null;
    if (a.day.rest) continue;
    const st = gStatus(d, todayDi);
    if (st === 'today' || st === 'upcoming') return Object.assign({ st }, a);
  }
  return null;
}
function gCycleText(a) {
  const p = GYM.prog;
  return 'cycle ' + a.cycle + ' of ' + p.cycles + (a.cycle === p.cycles && /last/i.test(p.deload || '') ? ', the deload week' : '');
}
function gAdherence(todayDi) {
  const p = GYM.prog; let planned = 0, done = 0;
  for (let d = p.start; d <= todayDi; d++) { const st = gStatus(d, todayDi); if (st === 'done' || st === 'shifted') { planned++; done++; } else if (st === 'missed') planned++; }
  return { planned, done };
}

/* ---------- suggestions ---------- */
function gParseReps(r) {
  if (r == null) return null;
  const m = String(r).replace(/\s+/g, '').match(/^(\d+)(?:-(\d+)|(\+))?$/); if (!m) return null;
  return { lo: +m[1], hi: m[2] ? +m[2] : null, open: !!m[3] };
}
function gRepsText(pr) { return !pr ? '' : pr.open ? pr.lo + ' or more' : pr.hi != null ? pr.lo + ' to ' + pr.hi : String(pr.lo); }
function gLast(ex, beforeDi) {
  for (let i = GYM.sessions.length - 1; i >= 0; i--) {
    const s = GYM.sessions[i]; if (s.di >= beforeDi) continue;
    const w = s.sets.filter(x => x.ex === ex && gWork(x)); if (w.length) return { di: s.di, sets: w };
  }
  return null;
}
function gSuggest(ex, tr, rir, last) {
  if (!last) return null;
  let best = 0; last.sets.forEach(x => { const e = gE1(GYM, ex, x); if (e && e > best) best = e; });
  if (!best) return null;
  let w = best / (1 + (tr + rir) / 30);
  if (GYM.bw && G_BW.test(ex)) w -= GYM.bw;
  return { w: Math.max(0, Math.round(w / 2.5) * 2.5), rough: tr + rir > 12 };
}
function gSetTxt(ex, s) {
  const w = G_BW.test(ex) ? (s.w > 0 ? '+' + gW(s.w) : 'body weight') : gW(s.w || 0);
  return w + ' x ' + nf(s.reps, 0);
}
function gGroups(sets) {
  const out = [];
  sets.forEach(s => { const key = s.type + '|' + s.reps + '|' + s.rir, l = out[out.length - 1]; if (l && l.key === key) l.n++; else out.push({ key, n: 1, type: s.type, reps: s.reps, rir: s.rir }); });
  return out;
}
// one planned exercise: groups of sets with a suggested load for each group
function gExPlan(e, dayDi) {
  const last = gLast(e.name, dayDi);
  const groups = gGroups(e.sets).map(gr => {
    const pr = gParseReps(gr.reps), fail = gr.type === 'Failure Set', rir = fail ? 0 : (isNum(gr.rir) ? gr.rir : 0);
    let tr = null; if (pr) tr = pr.hi != null ? Math.round((pr.lo + pr.hi) / 2) : pr.lo;
    const sg = tr != null ? gSuggest(e.name, tr, rir, last) : null;
    const how = gr.type === 'Drop Set' ? 'drop set' : fail ? 'to failure' : isNum(gr.rir) ? gr.rir + ' in reserve' : '';
    const txt = gr.n + ' x ' + (pr ? gRepsText(pr) + ' reps' : (gr.n === 1 ? 'set' : 'sets')) + (how ? ', ' + how : '');
    return { n: gr.n, text: pr ? txt : gr.n + (gr.n === 1 ? ' set' : ' sets') + ', same as last time', sg };
  });
  return { name: e.name, skipped: e.skipped, last, groups, notes: e.notes };
}

/* ---------- lines for Today's call ---------- */
function gymCallLines(band, dayDi, lifted) {
  const g = gymModel(); if (!g || !g.prog) return null;
  const a = gProgAt(dayDi); if (!a) return null;
  const out = [];
  if (a.over) { out.push('Your ' + esc(g.prog.name) + ' program has run all ' + g.prog.cycles + ' cycles. Start the next block in MacroFactor and export again to bring the plan here.'); return out; }
  if (a.day.rest) {
    const nx = gNext(dayDi + 1, dayDi);
    if (band === 'high') out.head = 'Green morning, rest day for lifting'; else if (band === 'mid') out.head = 'Solid morning, rest day for lifting';
    out.push('Rest day in your program (' + gCycleText(a) + ').' + (nx ? ' Next up: Workout ' + esc(nx.day.workout) + ' on ' + esc(fmtDayW(nx.di)) + '.' : '') + (band === 'high' ? ' Green morning, so zone 2 or a run fits well.' : ''));
  } else {
    const st = gStatus(dayDi, dayDi), L = esc(a.day.workout);
    if (st === 'done' || lifted) out.push('Workout ' + L + ' is done for today. Keep the rest of the day easy.');
    else {
      const first = a.day.exercises.find(e => !e.skipped), pl = first ? gExPlan(first, dayDi) : null;
      const sg = pl && pl.groups[0] && pl.groups[0].sg;
      const open = first ? ' It opens with ' + esc(first.name) + (sg ? ', try about ' + esc(gTry(sg.w)) + ' for the first set' : '') + '.' : '';
      if (band === 'high') out.push('Workout ' + L + ' is on your program today (' + gCycleText(a) + '). Green light: go as planned and push the top sets.' + open);
      else if (band === 'mid') out.push('Workout ' + L + ' is on your program today (' + gCycleText(a) + '). Train it as planned and leave a rep or two in reserve on the failure sets.' + open);
      else out.push('Workout ' + L + ' is on your program today, but recovery is low. Either move it back a day, or do it lighter: about 10 percent off the weights and every set stopped 3 reps short of failure.');
    }
  }
  for (let d = dayDi - 1; d >= dayDi - 3; d--) {
    if (gStatus(d, dayDi) !== 'missed') continue;
    const a2 = gProgAt(d), w = M.workouts.some(x => x.di === d && x.scored && x.sport === 'weightlifting');
    out.push('Workout ' + esc(a2.day.workout) + ' from ' + esc(fmtDayW(d)) + ' is not in your MacroFactor log' + (w ? ', though WHOOP recorded a lift that day, so it may just be unlogged' : '') + '.');
    break;
  }
  return out;
}

/* ---------- XP, badges, map hooks ---------- */
function gymXPEvents() {
  const g = gymModel(); if (!g || !M || M.empty) return [];
  const first = M.days[0].di, A = M.anchor, ev = [], inR = di => di >= first && di <= A, perDay = new Map();
  g.prs.forEach(p => { if (!inR(p.di)) return; const n = perDay.get(p.di) || 0; if (n < 3) { perDay.set(p.di, n + 1); ev.push({ di: p.di, xp: 15 }); } });
  const credited = new Set(M.workouts.filter(w => sIsTrain(w)).map(w => w.di));
  g.days.forEach(di => { if (inR(di) && !credited.has(di)) ev.push({ di, xp: 40 }); });
  gWeekRows().forEach(w => { if (w.complete && w.end <= A) ev.push({ di: w.end, xp: 40 }); });
  return ev;
}
// every program week so far: planned workouts, done, whether finished
function gWeekRows() {
  const g = gymModel(); if (!g || !g.prog) return [];
  const p = g.prog, today = gToday(), rows = [];
  p.plan.forEach((c, i) => {
    const s0 = p.start + 7 * i; if (s0 > today) return;
    let planned = 0, done = 0;
    for (let d = s0; d < s0 + 7; d++) { const st = gStatus(d, today); if (st) { planned++; if (st === 'done' || st === 'shifted') done++; } }
    rows.push({ cycle: i + 1, start: s0, end: s0 + 6, planned, done, complete: planned > 0 && done === planned && s0 + 6 < today + 1 });
  });
  return rows;
}
function gymBadgeList() {
  const g = gymModel(); if (!g) return [];
  const res = [], B = (id, ic, name, desc, done, when, prog) => res.push({ id, ic, name, desc, done: !!done, when: done ? when : null, prog });
  const wk = gWeekRows(), full = wk.filter(w => w.complete);
  if (g.prog) B('pweek', 'PW', 'Program Week', 'Finish every planned workout in a program week', full.length > 0, full.length ? full[0].end : null, 'best week: ' + Math.max.apply(null, [0].concat(wk.map(w => w.done))) + ' of ' + (wk.length ? wk[wk.length - 1].planned : 4));
  B('pr1', 'PR', 'Personal Best', 'Lift more weight, or the same weight for more reps, than you ever have on a lift', g.prs.length > 0, g.prs.length ? g.prs[0].di : null, 'none logged yet');
  B('pr10', 'P10', 'Ten Bests', 'Set 10 personal bests across your lifts', g.prs.length >= 10, g.prs[9] && g.prs[9].di, g.prs.length + ' of 10 so far');
  const days = Array.from(g.days).sort((p, q) => p - q);
  B('gym50', 'G50', 'Fifty Gym Days', '50 days logged in the gym, across all your exports', days.length >= 50, days[49], days.length + ' of 50 so far');
  return res;
}
function gymHasDay(di) { const g = gymModel(); return !!(g && g.days.has(di)); }
function gymDayInfo(di) {
  const g = gymModel(); if (!g || !g.days.has(di)) return '';
  const ss = g.byDi.get(di) || [];
  if (!ss.length) return 'Gym: lifting logged in MacroFactor (older export, no set detail).';
  return ss.map(s => {
    const work = s.sets.filter(gWork), vol = sum(work.map(x => (isNum(x.w) && isNum(x.reps) ? (x.w + (g.bw && G_BW.test(x.ex) ? g.bw : 0)) * x.reps : 0)));
    return 'Gym: ' + (s.workout ? 'Workout ' + esc(s.workout) + ', ' : '') + work.length + ' working sets, ' + (s.duration_s ? Math.round(s.duration_s / 60) + ' min, ' : '') + esc(gVol(vol)) + ' moved.';
  }).join(' ');
}
function gymWeekRow(ws, we) {          // for the weekly targets card: program workouts done against planned in a calendar week
  const g = gymModel(); if (!g || !g.prog) return null;
  const today = gToday(); let planned = 0, done = 0;
  for (let d = ws; d <= we; d++) { const a = gProgAt(d); if (!a || a.over || a.day.rest) continue; planned++; if (g.byDi.get(d) && g.byDi.get(d).length) done++; }
  return planned ? { done, planned } : null;
}

/* ---------- the Strength section ---------- */
function gSpark(vals, w, h) {
  if (vals.length < 2) return '';
  const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), n = vals.length;
  const X = i => 2 + i * (w - 4) / (n - 1), Y = v => h - 3 - (v - lo) / ((hi - lo) || 1) * (h - 8);
  const d = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
  return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Strength trend over ' + n + ' sessions"><path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(vals[n - 1]).toFixed(1) + '" r="2.8" fill="var(--accent)"/></svg>';
}
function gFold(key, title, tagName, inner, openDefault) {
  const open = SEASON_OPEN[key] != null ? SEASON_OPEN[key] : openDefault;
  return '<details class="card fold" data-fold="' + key + '"' + (open ? ' open' : '') + '><summary class="sec-h"><h2>' + title + '</h2>' + (tagName ? tag(tagName) : '') + '</summary>' + inner + '</details>';
}

function gymHead(g, today) {
  let h = '<section class="card"><div class="sec-h"><h2>Strength</h2>' + tag('USER ENTERED') + '</div>';
  const stale = today - g.exportDi > 6;
  if (g.prog) {
    const a0 = gProgAt(Math.min(today, g.prog.start + 7 * g.prog.plan.length - 1)) || gProgAt(g.prog.start), cyc = a0.over ? g.prog.cycles : a0.cycle;
    const ad = gAdherence(today);
    h += '<p class="sub">' + esc(g.prog.name) + ', ' + (a0.over ? 'finished' : gCycleText({ cycle: cyc })) + '. ' + (ad.planned ? ad.done + ' of ' + ad.planned + ' planned workouts done so far (' + nf(ad.done / ad.planned * 100, 0) + ' percent).' : '') + '</p>';
    const s0 = g.prog.start + 7 * (cyc - 1);
    let dots = '';
    for (let k = 0; k < 7; k++) {
      const di = s0 + k, a = gProgAt(di), st = gStatus(di, today), rest = !a || a.day.rest;
      const cls = rest ? 'rest' : st === 'done' || st === 'shifted' ? 'done' : st === 'missed' ? 'miss' : st === 'today' ? 'now' : 'up';
      const lab = fmtDayW(di) + ': ' + (rest ? 'rest day' : 'Workout ' + a.day.workout + ', ' + (st === 'done' ? 'done' : st === 'shifted' ? 'done on another day' : st === 'missed' ? 'not logged' : st === 'today' ? 'today' : 'coming up'));
      dots += '<div class="gd ' + cls + (di === today ? ' tdy' : '') + '" role="img" aria-label="' + esc(lab) + '"><small>' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][wkdOf(di)] + '</small><b>' + (rest ? '' : esc(a.day.workout)) + '</b></div>';
    }
    h += '<div class="gweek">' + dots + '</div><div class="legend"><span><s style="background:var(--accent)"></s>done</span><span><s style="background:var(--bad)"></s>not in the log</span><span><s style="background:var(--inset);border:1px solid var(--line)"></s>coming up or rest</span></div>';
  } else h += '<p class="sub">Your gym log is loaded, but the program schedule could not be matched to your sessions, so the weekly plan is off. Lift progress below still works.</p>';
  if (stale) h += '<div class="ew"><b>Gym log is behind.</b> It was exported ' + esc(fmtDay(g.exportDi)) + '. Export again from MacroFactor, save it in Downloads, and double click refresh_whoop.bat.</div>';
  return h + '</section>';
}

function gymNext(g, today) {
  if (!g.prog) return '';
  const nx = gNext(today, today); if (!nx) {
    const a = gProgAt(today);
    return a && a.over ? '<section class="card"><div class="sec-h"><h2>Next workout</h2></div><p class="sub">The program has run its last cycle. Start the next block in MacroFactor and export again.</p></section>' : '';
  }
  const label = nx.di === today ? 'today' : fmtDayW(nx.di);
  let inner = '<p class="sub">Cycle ' + nx.cycle + ' of ' + g.prog.cycles + '. Weights are a suggestion worked out from the best set you did last time, then the load that should land on the planned reps with the planned reps in reserve. Round to the weights your gym has.</p>';
  nx.day.exercises.forEach(e => {
    const p = gExPlan(e, nx.di);
    inner += '<div class="gx' + (e.skipped ? ' skip' : '') + '"><div class="gxh"><b>' + esc(e.name) + '</b>' + (e.skipped ? '<small>skipped in the plan</small>' : '') + '</div>';
    if (!e.skipped) {
      if (p.last) inner += '<div class="gxl">Last time (' + esc(fmtDay(p.last.di)) + '): ' + esc(p.last.sets.slice(0, 4).map(s => gSetTxt(e.name, s)).join(', ')) + '</div>';
      else inner += '<div class="gxl">Not logged before in this export. Start light and note the weight.</div>';
      inner += '<ul class="gxs">' + p.groups.map(gr => '<li><span>' + esc(gr.text) + '</span>' + (gr.sg ? '<b>try ' + esc(gTry(gr.sg.w)) + (gr.sg.rough ? ' <em>rough</em>' : '') + '</b>' : '<b class="muted">no estimate</b>') + '</li>').join('') + '</ul>';
      if (p.notes) inner += '<div class="gxl">Note: ' + esc(p.notes) + '</div>';
    }
    inner += '</div>';
  });
  inner += formula('suggested load = a planning figure (an estimated one rep max, never shown elsewhere) from your best working set last time, divided by (1 + (planned reps + planned reps in reserve) / 30). The estimate is the Epley formula with reps in reserve counted as reps you could still have done. Body weight is added for chin ups and dips. Marked rough when the plan is above 12 reps total, where the formula is least reliable. Warm up sets are ignored.');
  return gFold('gymnext', 'Next: Workout ' + esc(nx.day.workout) + ', ' + esc(label), 'MODELED', inner, true);
}

function gymLifts(g, ref) {
  const rows = [];
  Object.keys(g.E).forEach(ex => {
    const s = g.E[ex], recent = s.filter(p => p.di >= ref - 70 && p.di <= ref);
    if (s.length < 3 || recent.length < 2) return;
    const lastP = recent[recent.length - 1], base = s.filter(p => p.di <= ref - 28).pop() || recent[0];
    const isPR = g.prs.some(p => p.ex === ex && p.di === lastP.di);
    rows.push({ ex, n: recent.length, now: lastP.w, reps: lastP.reps, chg: lastP.w - base.w, hasBase: base !== lastP, isPR, best: Math.max.apply(null, s.map(p => p.w)), spark: s.slice(-14).map(p => p.w) });
  });
  rows.sort((a, b) => b.n - a.n || b.now - a.now);
  if (!rows.length) return '';
  let inner = '<p class="sub">The heaviest weight you actually lifted in a working set, per lift, session by session. Warm up sets are ignored. Chin ups and dips show the weight added to your body weight.</p><div class="glifts">';
  rows.slice(0, 9).forEach(r => {
    const pct = r.hasBase && r.now - r.chg > 0 ? r.chg / (r.now - r.chg) * 100 : null;
    inner += '<div class="gl"><div class="glh"><b>' + esc(r.ex) + '</b>' + (r.isPR ? '<span class="chipx">★ best yet</span>' : '') + '</div><div class="glb"><div><span class="glv">' + esc(gWt(r.ex, r.now)) + (r.reps ? ' x ' + r.reps : '') + '</span><small>' +
      (pct == null ? 'new' : (r.chg >= 0 ? 'up ' : 'down ') + esc(gW(Math.abs(r.chg))) + ' (' + nf(Math.abs(pct), 0) + '%) over about 4 weeks') + (pct != null && Math.abs(pct) > 40 ? ' (the first sessions of a lift are noisy)' : '') + '' + '</small></div>' + gSpark(r.spark, 110, 30) + '</div></div>';
  });
  inner += '</div>';
  return gFold('gymlifts', 'Lift progress', 'MEASURED', inner, true);
}

function gymMuscles(g, ref) {
  const ws = weekStart(ref), wkSum = (a, b) => { const o = {}; for (let d = a; d <= b; d++) { const m = g.muscles[d]; if (m) Object.keys(m).forEach(k => { o[k] = (o[k] || 0) + m[k]; }); } return o; };
  const last = wkSum(ws - 7, ws - 1), now = wkSum(ws, ref);
  const prev = [1, 2, 3, 4].map(i => wkSum(ws - 7 * i, ws - 7 * i + 6));
  const names = Object.keys(last).concat(Object.keys(now)).filter((k, i, a) => a.indexOf(k) === i);
  const rows = names.map(k => ({ k, last: last[k] || 0, now: now[k] || 0, avg: mean(prev.map(p => p[k] || 0)) })).filter(r => r.last > 0 || r.avg > 0 || r.now > 0).sort((a, b) => b.last - a.last || b.avg - a.avg).slice(0, 14);
  if (!rows.length) return '';
  let inner = '<p class="sub">Hard sets per muscle, counting the partial credit MacroFactor gives for indirect work (a press also counts for triceps). Research on lifters often points to about ' + G_SETS_GOAL + ' or more per week for growth. That is a guide, not a rule.</p><div class="gmus">';
  rows.forEach(r => {
    const pct = clamp(r.last / (G_SETS_GOAL * 1.5) * 100, 0, 100), goal = clamp(G_SETS_GOAL / (G_SETS_GOAL * 1.5) * 100, 0, 100);
    inner += '<div class="gm"><div class="row"><b>' + esc(r.k) + '</b><span>' + nf(r.last, 1).replace(/\.0$/, '') + ' last week · ' + nf(r.avg, 1).replace(/\.0$/, '') + ' average of 4 weeks before · ' + nf(r.now, 1).replace(/\.0$/, '') + ' so far this week</span></div>' +
      '<div class="tbar" role="img" aria-label="' + esc(r.k + ': ' + nf(r.last, 1) + ' sets last week against about ' + G_SETS_GOAL) + '"><i style="width:' + pct.toFixed(0) + '%"></i><u style="left:' + goal.toFixed(0) + '%"></u></div></div>';
  });
  inner += '</div><div class="legend"><span><s style="background:var(--text)"></s>marker at ' + G_SETS_GOAL + ' sets</span></div>';
  return gFold('gymmus', 'Sets per muscle, by week', 'MEASURED', inner, false);
}

function gymSessions(g, today) {
  const ss = g.sessions.slice(-8).reverse();
  const recOf = di => { const d = M.days.find(x => x.di === di && x.okRec); return d ? d.recovery : null; };
  let inner = '<p class="sub">Your last ' + ss.length + ' logged sessions, with WHOOP alongside.</p><div class="gsess">';
  ss.forEach(s => {
    const work = s.sets.filter(gWork), vol = sum(work.map(x => (isNum(x.w) && isNum(x.reps) ? (x.w + (g.bw && G_BW.test(x.ex) ? g.bw : 0)) * x.reps : 0)));
    const wl = M.workouts.filter(w => w.di === s.di && w.scored && w.sport === 'weightlifting')[0], rec = recOf(s.di);
    inner += '<div class="gsr"><div class="gsh"><b>' + esc(fmtDayW(s.di)) + '</b><span>' + (s.workout ? 'Workout ' + esc(s.workout) : esc(s.name)) + '</span></div><div class="gss">' + work.length + ' working sets · ' + (s.duration_s ? Math.round(s.duration_s / 60) + ' min · ' : '') + esc(gVol(vol)) + ' moved' +
      (rec != null ? ' · recovery that morning <b style="color:' + bandOf(rec).color + '">' + nf(rec, 0) + '%</b>' : '') + (wl ? ' · WHOOP strain ' + nf(wl.strain, 1) : ' · no WHOOP lift recorded') + '</div></div>';
  });
  inner += '</div>';
  const notes = [];
  // mornings after gym days versus other mornings
  const aft = [], oth = [], first = Math.min.apply(null, Array.from(g.days));
  M.days.forEach(d => { if (!d.okRec || !isNum(d.recovery) || d.di < first + 1 || d.di > g.exportDi) return; (g.days.has(d.di - 1) ? aft : oth).push(d.recovery); });
  if (aft.length >= 8 && oth.length >= 8) {
    const dlt = mean(aft) - mean(oth);
    notes.push('Mornings after a gym day average <b>' + nf(mean(aft), 0) + '%</b> recovery against <b>' + nf(mean(oth), 0) + '%</b> after other days (' + aft.length + ' and ' + oth.length + ' mornings). ' + (Math.abs(dlt) < 4 ? 'Not much difference, so lifting is not costing you recovery.' : dlt < 0 ? 'Mornings after lifting run about ' + nf(Math.abs(dlt), 0) + ' points lower. That is common. It is a pattern in your data, not proof of cause.' : 'You actually recover better after lifting days, which usually means you plan them well.'));
  }
  // WHOOP saw a lift but nothing is logged
  const un = M.workouts.filter(w => w.scored && w.sport === 'weightlifting' && w.di >= first && w.di <= g.exportDi && !g.days.has(w.di)).sort((a, b) => b.di - a.di);
  if (un.length) notes.push('WHOOP recorded ' + un.length + (un.length === 1 ? ' lift' : ' lifts') + ' since you started logging with nothing in MacroFactor' + (un.length <= 3 ? ' (' + un.map(w => esc(fmtDayW(w.di))).join(', ') + ')' : ', the latest on ' + esc(fmtDayW(un[0].di))) + '. Log them there and they show up here.');
  if (notes.length) inner += '<ul class="calllist">' + notes.map(n => '<li>' + n + '</li>').join('') + '</ul>';
  return gFold('gymsess', 'Recent sessions and recovery', 'MEASURED', inner, false);
}

function renderGym() {
  const g = gymModel();
  if (!g) return '<section class="card"><div class="sec-h"><h2>Strength</h2></div><p class="sub">No gym log yet. In MacroFactor, export your workouts, save the file in your Downloads folder, then double click refresh_whoop.bat. From then on the plan, lift progress and muscle sets appear here by themselves.</p></section>';
  const today = gToday();
  const ref = Math.min(today, g.exportDi);
  return gymHead(g, today) + gymNext(g, today) + gymLifts(g, ref) + gymMuscles(g, ref) + gymSessions(g, today);
}
