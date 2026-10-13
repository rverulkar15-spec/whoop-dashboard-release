/* ---------- your own numbers (USER ENTERED) ---------- */
const ENTRY_KEY = 'whoopDash.entries.v1';
let goalTab = store.get('whoopDash.goalTab') || 'goals';
const todayDi = () => { const n = new Date(); return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY); };
const parseDateInput = s => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null; };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const epley = (w, r) => r <= 1 ? w : w * (1 + r / 30);
const saveEntries = () => store.set(ENTRY_KEY, state.entries);
const ents = type => state.entries.filter(e => e.type === type).sort((a, b) => a.di - b.di || (a.id < b.id ? -1 : 1));

const BODY_METRICS = {
  weight: { name: 'Body weight', unit: () => U.wU(), to: v => U.wIn(v), from: v => U.w(v), dec: 1 },
  waist: { name: 'Waist', unit: () => U.lU(), to: v => U.lIn(v), from: v => U.l(v), dec: 1 },
  shoulder: { name: 'Shoulder circumference', unit: () => U.lU(), to: v => U.lIn(v), from: v => U.l(v), dec: 1 },
  chest: { name: 'Chest circumference', unit: () => U.lU(), to: v => U.lIn(v), from: v => U.l(v), dec: 1 },
  bodyfat: { name: 'Body fat', unit: () => '%', to: v => v, from: v => v, dec: 1 },
  vo2: { name: 'VO2 max', unit: () => 'ml/kg/min', to: v => v, from: v => v, dec: 1 }
};
const JUMP_KINDS = { vertical: 'Vertical jump', broad: 'Broad jump' };
const TAB_DEFS = [['goals', 'Goals'], ['joints', 'Joints'], ['strength', 'Strength'], ['body', 'Body'], ['jumps', 'Jumps'], ['tests', 'Capacity tests'], ['mental', 'Mind']];

const field = (label, name, o) => {
  o = o || {};
  const attrs = (o.type === 'number' ? ' inputmode="decimal" step="' + (o.step || 'any') + '"' : '') + (o.min != null ? ' min="' + o.min + '"' : '') + (o.max != null ? ' max="' + o.max + '"' : '') + (o.req ? ' required' : '') + (o.list ? ' list="' + o.list + '"' : '');
  return '<div class="field"><label for="f_' + name + '">' + esc(label) + '</label><input id="f_' + name + '" name="' + name + '" type="' + (o.type || 'text') + '"' + attrs + (o.value != null ? ' value="' + esc(o.value) + '"' : '') + '></div>';
};
const selField = (label, name, opts) => '<div class="field"><label for="f_' + name + '">' + esc(label) + '</label><select id="f_' + name + '" name="' + name + '">' + opts.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></div>';
const dateField = () => field('Date', 'date', { type: 'date', value: dStr(todayDi()), req: true });
const formWrap = (type, inner, btn) => '<form data-form="' + type + '" class="rowf" style="align-items:end">' + inner + '<div class="field"><button class="primary" type="submit">' + (btn || 'Add entry') + '</button></div></form>';

function entryRows(list, fmt, n) {
  if (!list.length) return '<p class="muted">Nothing entered yet. This tab stays empty until you add your own numbers.</p>';
  return '<ul class="entry-list">' + list.slice(-(n || 8)).reverse().map(e => '<li><span>' + esc(fmtDay(e.di)) + ': ' + fmt(e) + '</span><button class="link" data-del="' + esc(e.id) + '" aria-label="Delete this entry">Delete</button></li>').join('') + '</ul>';
}

function goalsTabHTML() {
  let h = '';
  if (goalTab === 'goals') {
    const goals = ents('goal'), vals = ents('goalval');
    h += '<p class="sub">Your goals are yours to define and change. Nothing here is pre filled, and no date is imposed. Examples of what you described: muscle, explosivity, strength, broader shoulders, abs.</p>';
    h += formWrap('goal', field('Goal name', 'name', { req: 1 }) + field('Unit (optional)', 'unit') + field('Starting value', 'start', { type: 'number' }) + field('Target value', 'target', { type: 'number' }) + field('Note', 'note'), 'Add goal');
    if (!goals.length) h += '<p class="muted">No goals yet. A goal can be a number (a squat e1RM, a shoulder measurement) or just a name you check in on.</p>';
    goals.forEach(g => {
      const gv = vals.filter(v => v.d.goal === g.id), lv = last(gv), has = isNum(g.d.start) && isNum(g.d.target) && g.d.target !== g.d.start;
      const pc = has && lv ? clamp((lv.d.value - g.d.start) / (g.d.target - g.d.start) * 100, 0, 100) : null;
      h += '<div class="tile" style="margin-top:10px"><div class="lab"><span><b>' + esc(g.d.name) + '</b></span><button class="link" data-del="' + esc(g.id) + '">Remove goal</button></div>' +
        (has ? '<div class="prog" role="img" aria-label="' + (pc != null ? nf(pc, 0) + ' percent of the way' : 'no progress logged') + '"><i style="width:' + (pc || 0) + '%"></i></div><div class="dev">' + (lv ? 'Latest ' + nf(lv.d.value, 1) + ' ' + esc(g.d.unit || '') + ' on ' + esc(fmtDay(lv.di)) + '; ' + nf(pc, 0) + '% of the way from ' + g.d.start + ' to ' + g.d.target + ' (n=' + gv.length + ' check ins).' : 'Start ' + g.d.start + ', target ' + g.d.target + ' ' + esc(g.d.unit || '') + '. No check in logged yet.') + '</div>' : '<div class="dev">' + (lv ? 'Latest check in ' + nf(lv.d.value, 1) + ' ' + esc(g.d.unit || '') + ' on ' + esc(fmtDay(lv.di)) + '.' : 'No numeric target set.') + '</div>') +
        (g.d.note ? '<div class="sub">' + esc(g.d.note) + '</div>' : '') +
        '<form data-form="goalval" data-goal="' + esc(g.id) + '" class="rowf" style="align-items:end;margin-top:6px">' + field('Log value', 'value_' + g.id, { type: 'number' }).replace('name="value_' + g.id + '"', 'name="value"') + '<div class="field"><button type="submit">Log it</button></div></form></div>';
    });
    h += formula('progress = (latest value minus starting value) divided by (target minus starting value), kept between 0 and 100 percent.');
  } else if (goalTab === 'joints') {
    const j = ents('joint'), from = rangeFrom();
    h += '<p class="sub">Daily pain score for each joint, 0 is none and 10 is the worst you can imagine. Quick to fill in, and the trend is what matters.</p>';
    h += formWrap('joint', dateField() + field('Hip', 'hip', { type: 'number', min: 0, max: 10, step: 1 }) + field('Knee', 'knee', { type: 'number', min: 0, max: 10, step: 1 }) + field('Ankle', 'ankle', { type: 'number', min: 0, max: 10, step: 1 }) + field('Note', 'note'));
    const ser = k => ({ label: k, pts: j.filter(e => e.di >= from).map(e => [e.di, isNum(e.d[k]) ? e.d[k] : null]) });
    if (j.length >= 2) h += lineChart({ title: 'Joint pain scores', y0: 0, y1: 10, maxGap: 7, series: [Object.assign(ser('hip'), { cls: 0 }), Object.assign(ser('knee'), { cls: 1 }), Object.assign(ser('ankle'), { cls: 2 })], hlines: [{ y: C.jointAlert, label: 'your alert level ' + C.jointAlert }] });
    const lj = last(j); if (lj) { const hi = ['hip', 'knee', 'ankle'].filter(k => isNum(lj.d[k]) && lj.d[k] >= C.jointAlert); h += '<p>' + (hi.length ? '<span class="warn">At or above your alert level of ' + C.jointAlert + ' on ' + esc(fmtDay(lj.di)) + ': ' + hi.join(', ') + '.</span>' : 'Latest entry (' + esc(fmtDay(lj.di)) + ') is under your alert level of ' + C.jointAlert + '.') + '</p>'; }
    h += formula('plain entries you typed, n=' + j.length + '. The alert level is a control; it flags a number, it does not tell you what to do.');
    h += entryRows(j, e => ['hip', 'knee', 'ankle'].map(k => k + ' ' + (isNum(e.d[k]) ? e.d[k] : 'n/a')).join(', ') + (e.d.note ? ' (' + esc(e.d.note) + ')' : ''));
  } else if (goalTab === 'strength') {
    const L = ents('lift'), by = {}; L.forEach(e => { (by[e.d.exercise.toLowerCase()] = by[e.d.exercise.toLowerCase()] || []).push(e); });
    h += '<p class="sub">Log your top set for a lift. Estimated one rep max uses the Epley formula.</p>';
    h += '<datalist id="exlist">' + Object.keys(by).map(k => '<option value="' + esc(k) + '">').join('') + '</datalist>';
    h += formWrap('lift', dateField() + field('Exercise', 'exercise', { req: 1, list: 'exlist' }) + field('Weight (' + U.wU() + ')', 'weight', { type: 'number', req: 1 }) + field('Reps', 'reps', { type: 'number', min: 1, max: 30, step: 1, req: 1 }));
    const names = Object.keys(by).sort((a, b) => by[b].length - by[a].length);
    if (names.length) {
      h += '<div class="scroll"><table><thead><tr><th>Exercise</th><th class="n">Entries</th><th class="n">First e1RM</th><th class="n">Latest e1RM</th><th class="n">Best e1RM</th></tr></thead><tbody>' + names.map(k => { const a = by[k].map(e => U.w(epley(e.d.weightKg, e.d.reps))); return '<tr><td>' + esc(k) + '</td><td class="n">' + a.length + '</td><td class="n">' + nf(a[0], 1) + '</td><td class="n">' + nf(last(a), 1) + '</td><td class="n">' + nf(Math.max(...a), 1) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      const top = names.filter(k => by[k].length >= 2).slice(0, 3);
      if (top.length) h += lineChart({ title: 'Estimated one rep max over time', maxGap: 60, series: top.map((k, i) => ({ label: k + ' e1RM (' + U.wU() + ')', cls: i, pts: by[k].map(e => [e.di, U.w(epley(e.d.weightKg, e.d.reps))]) })), yFmt: v => nf(v, 0) });
    }
    h += formula('e1RM = weight x (1 + reps divided by 30); with 1 rep it is the weight itself. An estimate that gets less reliable above about 10 reps.');
    h += entryRows(L, e => esc(e.d.exercise) + ' ' + nf(U.w(e.d.weightKg), 1) + ' ' + U.wU() + ' x ' + e.d.reps + ', e1RM ' + nf(U.w(epley(e.d.weightKg, e.d.reps)), 1));
  } else if (goalTab === 'body') {
    const B = ents('body');
    h += '<p class="sub">WHOOP gives a height, weight and max heart rate profile only. Everything else on this tab is typed by you.</p>';
    h += formWrap('body', dateField() + selField('Measure', 'metric', Object.keys(BODY_METRICS).map(k => [k, BODY_METRICS[k].name])) + field('Value', 'value', { type: 'number', req: 1 }));
    const rows = Object.keys(BODY_METRICS).map(k => { const l = B.filter(e => e.d.metric === k); if (!l.length) return ''; const m = BODY_METRICS[k], a = m.from(l[0].d.value), b = m.from(last(l).d.value); return '<tr><td>' + m.name + '</td><td class="n">' + l.length + '</td><td class="n">' + nf(a, m.dec) + '</td><td class="n">' + nf(b, m.dec) + ' ' + esc(m.unit()) + '</td><td class="n">' + (b - a >= 0 ? 'up ' : 'down ') + nf(Math.abs(b - a), m.dec) + '</td><td>' + esc(fmtDay(last(l).di)) + '</td></tr>'; }).join('');
    if (rows) h += '<div class="scroll"><table><thead><tr><th>Measure</th><th class="n">Entries</th><th class="n">First</th><th class="n">Latest</th><th class="n">Change</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    Object.keys(BODY_METRICS).forEach(k => { const l = B.filter(e => e.d.metric === k); if (l.length >= 3) h += lineChart({ title: BODY_METRICS[k].name + ' over time', h: 170, maxGap: 90, series: [{ label: BODY_METRICS[k].name + ' (' + BODY_METRICS[k].unit() + ')', pts: l.map(e => [e.di, BODY_METRICS[k].from(e.d.value)]) }] }); });
    h += formula('change = latest minus first entry for that measure. Stored in metric units and shown in the units you choose in Controls.');
    h += entryRows(B, e => esc(BODY_METRICS[e.d.metric].name) + ' ' + nf(BODY_METRICS[e.d.metric].from(e.d.value), 1) + ' ' + esc(BODY_METRICS[e.d.metric].unit()));
  } else if (goalTab === 'jumps') {
    const J = ents('jump');
    h += formWrap('jump', dateField() + selField('Jump', 'kind', Object.keys(JUMP_KINDS).map(k => [k, JUMP_KINDS[k]])) + field('Best distance (' + U.lU() + ')', 'value', { type: 'number', req: 1 }));
    Object.keys(JUMP_KINDS).forEach(k => { const l = J.filter(e => e.d.kind === k); if (!l.length) return; const v = l.map(e => U.l(e.d.cm)); h += '<p><b>' + JUMP_KINDS[k] + '</b>: latest ' + nf(last(v), 1) + ' ' + U.lU() + ', best ' + nf(Math.max(...v), 1) + ' ' + U.lU() + ' (n=' + l.length + ')</p>'; if (l.length >= 3) h += lineChart({ title: JUMP_KINDS[k], h: 170, maxGap: 90, series: [{ label: JUMP_KINDS[k] + ' (' + U.lU() + ')', pts: l.map(e => [e.di, U.l(e.d.cm)]) }] }); });
    h += formula('plain entries you typed. Explosivity is one of your stated goals, so this is where it shows up as a number.');
    h += entryRows(J, e => esc(JUMP_KINDS[e.d.kind]) + ' ' + nf(U.l(e.d.cm), 1) + ' ' + U.lU());
  } else if (goalTab === 'tests') {
    const T = ents('test'), by = {}; T.forEach(e => { (by[e.d.name.toLowerCase()] = by[e.d.name.toLowerCase()] || []).push(e); });
    h += '<p class="sub">Any repeatable test you define: single leg balance seconds, single leg squats, a calf raise count, a 1 mile time, a hop test.</p>';
    h += '<datalist id="tlist">' + Object.keys(by).map(k => '<option value="' + esc(k) + '">').join('') + '</datalist>';
    h += formWrap('test', dateField() + field('Test name', 'name', { req: 1, list: 'tlist' }) + field('Result', 'value', { type: 'number', req: 1 }) + field('Unit', 'unit') + field('Note', 'note'));
    const names = Object.keys(by);
    if (names.length) h += '<div class="scroll"><table><thead><tr><th>Test</th><th class="n">Entries</th><th class="n">First</th><th class="n">Latest</th><th class="n">Best</th></tr></thead><tbody>' + names.map(k => { const v = by[k].map(e => e.d.value), u = last(by[k]).d.unit || ''; return '<tr><td>' + esc(k) + '</td><td class="n">' + v.length + '</td><td class="n">' + v[0] + ' ' + esc(u) + '</td><td class="n">' + last(v) + ' ' + esc(u) + '</td><td class="n">' + Math.max(...v) + ' ' + esc(u) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="f"><b>Note:</b> "Best" is the highest number. For a test where lower is better, such as a time, read First and Latest instead.</p>';
    h += entryRows(T, e => esc(e.d.name) + ' ' + e.d.value + ' ' + esc(e.d.unit || '') + (e.d.note ? ' (' + esc(e.d.note) + ')' : ''));
  } else {
    const Mn = ents('mental'), from = rangeFrom();
    h += '<p class="sub">Daily focus, energy and mood, each 1 to 10. Takes ten seconds.</p>';
    h += formWrap('mental', dateField() + field('Focus', 'focus', { type: 'number', min: 1, max: 10, step: 1 }) + field('Energy', 'energy', { type: 'number', min: 1, max: 10, step: 1 }) + field('Mood', 'mood', { type: 'number', min: 1, max: 10, step: 1 }));
    if (Mn.length >= 3) h += lineChart({ title: 'Focus, energy and mood', y0: 1, y1: 10, maxGap: 7, series: ['focus', 'energy', 'mood'].map((k, i) => ({ label: k, cls: i, pts: Mn.filter(e => e.di >= from).map(e => [e.di, isNum(e.d[k]) ? e.d[k] : null]) })) });
    const rc = M && !M.empty ? M.days.filter(d => d.okRec) : [];
    ['focus', 'energy', 'mood'].forEach(k => { const pairs = Mn.map(e => { const d = rc.find(x => x.di === e.di); return d && isNum(e.d[k]) ? [d.recovery, e.d[k]] : null; }).filter(Boolean), s = spearman(pairs); h += '<p>Recovery vs ' + k + ': ' + (s.rho == null ? 'not enough matching days (n=' + s.n + ')' : 'n=' + s.n + ', rho ' + nf(s.rho, 2) + ', p ' + (s.p < 0.001 ? '&lt;0.001' : nf(s.p, 3)) + '. ' + verdictCell(s)) + '</p>'; });
    h += formula('Spearman rank correlation between that morning\'s recovery_score and what you rated that day, matched on date.');
    h += entryRows(Mn, e => ['focus', 'energy', 'mood'].map(k => k + ' ' + (isNum(e.d[k]) ? e.d[k] : 'n/a')).join(', '));
  }
  return h;
}

function renderGoals() {
  let h = '<div class="tabs" role="tablist" aria-label="Your numbers">' + TAB_DEFS.map(t => '<button role="tab" data-tab="' + t[0] + '" aria-selected="' + (goalTab === t[0]) + '">' + t[1] + '</button>').join('') + '</div><div id="goalPane">' + goalsTabHTML() + '</div>';
  h += '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap"><button id="expEntries">Export your entries</button><label class="btn" for="impEntries" style="margin:0;color:var(--text)">Import entries</label><input id="impEntries" type="file" accept=".json" class="sr"></div>' +
    '<p class="f">' + (store.ok ? 'Entries are saved in this browser on this device.' : '<span class="warn">This browser is blocking storage, so entries last only until you close the page.</span>') + ' Export saves user_entries.json. Put that file in the dashboard folder and the next refresh embeds it, so your numbers follow the file to any device. Total entries: ' + state.entries.length + '.</p>';
  $('#goalsBody').innerHTML = h;
}

function addEntry(type, d, di) { state.entries.push({ id: newId(), type, di, d }); saveEntries(); }
function handleForm(f) {
  const t = f.dataset.form, fd = Object.fromEntries(new FormData(f).entries()), num = k => fd[k] === '' || fd[k] == null ? null : Number(fd[k]);
  const di = fd.date ? parseDateInput(fd.date) : todayDi(); if (di == null) return;
  if (t === 'goal') { if (!fd.name.trim()) return; addEntry('goal', { name: fd.name.trim(), unit: fd.unit.trim(), start: num('start'), target: num('target'), note: fd.note.trim() }, todayDi()); }
  else if (t === 'goalval') { if (num('value') == null) return; addEntry('goalval', { goal: f.dataset.goal, value: num('value') }, todayDi()); }
  else if (t === 'joint') { const d = { hip: num('hip'), knee: num('knee'), ankle: num('ankle'), note: (fd.note || '').trim() }; if (![d.hip, d.knee, d.ankle].some(isNum)) return; addEntry('joint', d, di); }
  else if (t === 'lift') { if (!isNum(num('weight')) || !isNum(num('reps'))) return; addEntry('lift', { exercise: fd.exercise.trim(), weightKg: U.wIn(num('weight')), reps: Math.round(num('reps')) }, di); }
  else if (t === 'body') { if (!isNum(num('value'))) return; addEntry('body', { metric: fd.metric, value: BODY_METRICS[fd.metric].to(num('value')) }, di); }
  else if (t === 'jump') { if (!isNum(num('value'))) return; addEntry('jump', { kind: fd.kind, cm: U.lIn(num('value')) }, di); }
  else if (t === 'test') { if (!isNum(num('value')) || !fd.name.trim()) return; addEntry('test', { name: fd.name.trim(), value: num('value'), unit: (fd.unit || '').trim(), note: (fd.note || '').trim() }, di); }
  else if (t === 'mental') { const d = { focus: num('focus'), energy: num('energy'), mood: num('mood') }; if (![d.focus, d.energy, d.mood].some(isNum)) return; addEntry('mental', d, di); }
  safe('goals', renderGoals); safe('drivers', renderDrivers);
}

function exportEntries() {
  const blob = new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), entries: state.entries }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'user_entries.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function mergeEntries(list) {
  const have = new Set(state.entries.map(e => e.id)); let add = 0;
  (list || []).forEach(e => { if (e && e.id && e.type && isNum(e.di) && e.d && !have.has(e.id)) { state.entries.push(e); have.add(e.id); add++; } });
  if (add) saveEntries(); return add;
}

/* ---------- controls ---------- */
const CTL = [
  ['Windows', [['baselineDays', 'Baseline window (days)', 'n', 5, 120, 1], ['shortDays', 'Short window (days)', 'n', 2, 30, 1], ['readDays', 'The read compares this many days', 'n', 7, 90, 7], ['bandSD', 'Normal band width (standard deviations)', 'n', 0.5, 3, 0.5], ['chartDays', 'Days shown in charts', 'n', 30, 365, 1], ['minN', 'Minimum n before trusting a pattern', 'n', 5, 100, 1]]],
  ['Which days count', [['inclCalib', 'Include calibration days', 'c'], ['inclNaps', 'Add naps to daily sleep', 'c'], ['inclLong', 'Include unusually long cycles in strain', 'c'], ['longH', 'A cycle is long above (hours)', 'n', 26, 72, 1]]],
  ['Time zone', [['tz', 'Day boundaries use', 's', [['record', 'Each record\'s own offset'], ...Array.from({ length: 27 }, (_, i) => [String(i - 12), 'UTC ' + (i - 12 >= 0 ? 'plus ' : 'minus ') + Math.abs(i - 12)])]]]],
  ['Heart rate zones counted', [['z1', 'Zone 1', 'c'], ['z2', 'Zone 2', 'c'], ['z3', 'Zone 3', 'c'], ['z4', 'Zone 4', 'c'], ['z5', 'Zone 5', 'c']]],
  ['Sleep debt', [['debtDays', 'Window (nights)', 'n', 3, 30, 1], ['debtMode', 'Counting', 's', [['net', 'Net, long nights pay back short ones'], ['short', 'Shortfalls only']]], ['debtNeed', 'Need basis', 's', [['baseline', 'Baseline need'], ['total', 'Full WHOOP need']]]]],
  ['Composite readiness weights', [['wR', 'Recovery score', 'n', 0, 100, 5], ['wS', 'Sleep performance', 'n', 0, 100, 5], ['wH', 'HRV score', 'n', 0, 100, 5]]],
  ['Recovery band thresholds', [['bandHi', 'High band starts at', 'n', 1, 100, 1], ['bandLo', 'Mid band starts at', 'n', 1, 100, 1]]],
  ['Running', [['runMinKmh', 'Slowest valid speed (km/h)', 'n', 1, 15, 0.5], ['runMaxKmh', 'Fastest valid speed (km/h)', 'n', 10, 40, 0.5], ['rampPct', 'Weekly ramp rule of thumb (percent)', 'n', 1, 50, 1]]],
  ['Consistency and alerts', [['liftWeekMin', 'Lifts per week to count a good week', 'n', 1, 14, 1], ['gapLift', 'Lift gap alert (days)', 'n', 1, 30, 1], ['gapRun', 'Run gap alert (days)', 'n', 1, 60, 1], ['jointAlert', 'Joint pain alert level (0 to 10)', 'n', 1, 10, 1]]],
  ['Units', [['uWeight', 'Weight', 's', [['lb', 'Pounds'], ['kg', 'Kilograms']]], ['uLen', 'Lengths', 's', [['in', 'Inches'], ['cm', 'Centimeters']]], ['uDist', 'Distance', 's', [['mi', 'Miles'], ['km', 'Kilometers']]], ['uClock', 'Clock', 's', [['12', '12 hour'], ['24', '24 hour']]]]]
];
function renderControls() {
  let h = '<p class="sub">Every assumption in this dashboard is a setting. Changes apply at once and are remembered in this browser.</p><div class="ctl-grid">';
  CTL.forEach(g => {
    h += '<fieldset><legend>' + esc(g[0]) + '</legend>';
    g[1].forEach(f => {
      const id = 'c_' + f[0];
      if (f[2] === 'c') h += '<div class="check"><input type="checkbox" id="' + id + '" data-ctl="' + f[0] + '"' + (C[f[0]] ? ' checked' : '') + '><label for="' + id + '">' + esc(f[1]) + '</label></div>';
      else if (f[2] === 'n') h += '<div class="field"><label for="' + id + '">' + esc(f[1]) + '</label><input id="' + id + '" type="number" inputmode="decimal" data-ctl="' + f[0] + '" min="' + f[3] + '" max="' + f[4] + '" step="' + f[5] + '" value="' + C[f[0]] + '"></div>';
      else h += '<div class="field"><label for="' + id + '">' + esc(f[1]) + '</label><select id="' + id + '" data-ctl="' + f[0] + '">' + f[3].map(o => '<option value="' + esc(o[0]) + '"' + (String(C[f[0]]) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></div>';
    });
    h += '</fieldset>';
  });
  h += '</div><p style="margin-top:12px"><button id="resetCtl">Reset all controls to defaults</button></p>';
  $('#controlsBody').innerHTML = h;
}
function applyControl(el) {
  const k = el.dataset.ctl, def = DEFAULTS[k];
  if (el.type === 'checkbox') C[k] = el.checked;
  else if (typeof def === 'number') { let v = Number(el.value); if (!isFinite(v) || el.value === '') return; v = clamp(v, +el.min, +el.max); C[k] = v; }
  else C[k] = el.value;
  saveControls(); renderAll(true);
}

/* ---------- data health ---------- */
function flatScore(r) {
  const o = {}; const sc = r && r.score; if (!sc) return o;
  Object.keys(sc).forEach(k => { const v = sc[k]; if (v && typeof v === 'object') Object.keys(v).forEach(j => { o[k + '.' + j] = v[j]; }); else o[k] = v; });
  return o;
}
function renderHealth() {
  const d = state.data || {}, meta = d.meta || {}; let h = '';
  h += '<div class="grid"><div class="tile"><div class="lab"><span>Archive</span></div><div class="dev">' + (meta.pulled_at ? 'Last pulled ' + esc(meta.pulled_at) + '.' : 'No pull time recorded.') + (meta.tool_version ? ' whoop.py version ' + esc(meta.tool_version) + '.' : '') +
    (meta.counts ? ' Records on file: ' + Object.keys(meta.counts).map(k => esc(k) + ' ' + meta.counts[k]).join(', ') + '.' : '') + (meta.added ? ' Added last run: ' + Object.keys(meta.added).map(k => esc(k) + ' ' + meta.added[k]).join(', ') + '.' : '') + '</div></div>';
  const kinds = { recovery: 'recovery', cycles: 'cycles', sleep: 'sleep', workouts: 'workouts' }, A = M && !M.empty ? M : null;
  h += '<div class="tile"><div class="lab"><span>Newest records</span></div><div class="dev">' + (A ? 'Newest cycle starts ' + esc(fmtDayW(dIdx(last(A.days).start, last(A.days).o))) + '. Newest workout ' + (A.workouts.length ? esc(fmtDayW(last(A.workouts).di)) : 'none') + '. Newest main sleep wake date ' + esc(fmtDayW(A.anchor)) + '.' : 'No data loaded.') + '</div></div></div>';
  h += '<h3>How complete each field is ' + tag('MEASURED') + '</h3><div class="scroll"><table><thead><tr><th>Record type</th><th>Field</th><th class="n">Filled</th><th class="n">Of</th><th>Reading</th></tr></thead><tbody>';
  Object.keys(kinds).forEach(k => {
    const recs = d[k] || []; if (!recs.length) { h += '<tr><td>' + k + '</td><td colspan="4" class="muted">no records</td></tr>'; return; }
    const keys = new Set(); recs.forEach(r => Object.keys(flatScore(r)).forEach(x => keys.add(x)));
    const st = {}; recs.forEach(r => { st[r.score_state || 'none'] = (st[r.score_state || 'none'] || 0) + 1; });
    h += '<tr class="hl"><td><b>' + k + '</b></td><td>score_state</td><td class="n" colspan="2">' + Object.keys(st).map(s => esc(s) + ' ' + st[s]).join(', ') + '</td><td></td></tr>';
    [...keys].forEach(f => { const n = recs.filter(r => isNum(flatScore(r)[f]) || (typeof flatScore(r)[f] === 'boolean')).length, p = n / recs.length * 100; h += '<tr><td>' + k + '</td><td>' + esc(f) + '</td><td class="n">' + n + '</td><td class="n">' + recs.length + '</td><td>' + (n === 0 ? '<span class="bad">null across the board</span>' : p < 60 ? '<span class="warn">patchy ' + nf(p, 0) + '%</span>' : nf(p, 0) + '% filled') + '</td></tr>'; });
  });
  h += '</tbody></table></div>' + formula('a field counts as filled when its value is a number (or true or false). Records with score_state of PENDING_SCORE or UNSCORABLE have no score at all.');
  h += '<h3>Flagged items</h3>';
  if (A) {
    const long = A.days.filter(x => x.long), cal = A.days.filter(x => x.calibrating), naps = A.sleeps.filter(s => s.nap), uns = A.workouts.filter(w => !w.scored), badRun = A.runs.filter(r => !r.runOk);
    h += '<ul>';
    h += '<li>' + long.length + ' cycle(s) over ' + C.longH + ' hours' + (long.length ? ': ' + long.map(x => esc(fmtDay(x.di)) + ' (' + nf(x.lenH, 0) + ' h)').join(', ') + '. ' + (C.inclLong ? 'Included in strain.' : 'Left out of strain baselines.') : '') + '</li>';
    h += '<li>' + cal.length + ' calibration day(s) ' + (C.inclCalib ? 'included' : 'left out') + ' of baselines.</li>';
    h += '<li>' + naps.length + ' sleep(s) flagged as naps; ' + naps.filter(s => s.asleep != null && s.asleep >= 3 * HOUR).length + ' of them over 3 hours asleep.</li>';
    h += '<li>' + uns.length + ' workout(s) without a score (sauna, stretching and similar).</li>';
    h += '<li>' + badRun.length + ' run(s) without usable distance or with an implausible speed.</li>';
    h += '<li>' + (A.openDay ? 'One open cycle (no end time): its strain is partial.' : 'No open cycle.') + '</li>';
    h += '<li>' + (A.tzChanges.length > 1 ? A.tzChanges.length + ' time zone offset changes in the archive (travel). Day boundaries follow each record\'s own offset unless you override it.' : 'No time zone changes.') + '</li>';
    h += '</ul>';
  } else h += '<p class="muted">No data loaded.</p>';
  if (meta.last_error) h += '<p class="bad">Last sync error' + (meta.last_attempt_at ? ' (' + esc(meta.last_attempt_at) + ')' : '') + ': ' + esc(meta.last_error) + '</p>';
  $('#healthBody').innerHTML = h;
}

/* ---------- measured vs modeled ---------- */
function renderMM() {
  const rows = [
    ['recovery_score, hrv_rmssd_milli, resting_heart_rate, spo2_percentage, skin_temp_celsius', 'MEASURED', 'Straight from WHOOP\'s recovery record. WHOOP computes the score itself.'],
    ['Sleep stages, sleep_performance_percentage, sleep_efficiency_percentage, sleep_consistency_percentage, respiratory_rate', 'MEASURED', 'Straight from WHOOP\'s sleep record.'],
    ['Strain, kilojoule, average and max heart rate (cycle and workout), zone durations, distance, altitude gain', 'MEASURED', 'Straight from the cycle and workout records.'],
    ['Daily keying by wake date', 'MODELED', 'Cycles start at sleep onset, so each cycle is assigned to the date of its main sleep wake time.'],
    ['Baselines, deviations, percentiles, normal bands, the read, trends', 'MODELED', 'Computed here from your own history using the windows in Controls.'],
    ['Hours asleep, sleep debt balance, bedtime and wake spread', 'MODELED', 'Computed here from stage totals and WHOOP\'s sleep_needed fields.'],
    ['Composite readiness', 'MODELED', 'A weighted display number. Not a WHOOP metric and not an instruction.'],
    ['Driver correlations, acute to chronic ratio, running efficiency', 'MODELED', 'Statistical patterns in your own data with sample sizes shown. Not proof of cause.'],
    ['Joints, strength, body measures, jumps, tests, mind, goals', 'USER ENTERED', 'Only what you type. Nothing is guessed or filled in for you.'],
    ['Not available from the WHOOP API', 'NONE', 'Raw heart rate, journal answers, ECG, body fat, VO2 max, WHOOP Age. They stay out unless you enter them yourself.']
  ];
  $('#mmBody').innerHTML = '<div class="scroll"><table><thead><tr><th>What</th><th>Type</th><th>How</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + (r[1] === 'NONE' ? 'not available' : tag(r[1])) + '</td><td>' + esc(r[2]) + '</td></tr>').join('') + '</tbody></table></div>';
}

/* ---------- banners, header, orchestration ---------- */
function renderBanners() {
  const b = [], meta = state.data && state.data.meta || {};
  if (!store.ok) b.push('<div class="banner">This browser is blocking local storage, so controls and entries will not be remembered after you close the page.</div>');
  if (meta.last_error) b.push('<div class="banner err"><b>The last data refresh failed.</b> Showing the archive from the last good pull. Reason: ' + esc(meta.last_error) + '</div>');
  const pulled = Date.parse(meta.pulled_at || '');
  if (isNum(pulled)) { const ms = Date.now() - pulled; if (ms > 36 * HOUR) b.push('<div class="banner">This data was pulled ' + esc(ago(ms)) + ' ago. Run the refresh to update it, or load a newer whoop_data.json with the button above.</div>'); }
  if (M && !M.empty && M.anchorDay && !M.anchorDay.hasRec) b.push('<div class="banner">No recovery score has been published for the latest cycle yet. Showing the newest day that has one where possible.</div>');
  $('#banners').innerHTML = b.join('');
}
function renderAsof() {
  const meta = state.data && state.data.meta || {};
  $('#asof').textContent = M && !M.empty ? 'Through ' + fmtDayW(M.anchor) + (meta.pulled_at ? ', pulled ' + ago(Date.now() - Date.parse(meta.pulled_at)) + ' ago' : '') + (state.source ? ', ' + state.source : '') : 'No data loaded';
  $('#foot').textContent = 'Everything is calculated in your browser from the data embedded in this file. Nothing leaves this device. Tags: MEASURED comes straight from WHOOP, MODELED is computed here, USER ENTERED is typed by you.';
}
function safe(name, fn) {
  try { fn(); }
  catch (e) { console.error(name, e); const el = $('#' + ({ read: 'readLine', today: 'todayBody', trends: 'trendsBody', sleep: 'sleepBody', train: 'trainBody', goals: 'goalsBody', drivers: 'driversBody', controls: 'controlsBody', health: 'healthBody', mm: 'mmBody' }[name] || 'banners')); if (el) el.innerHTML = '<div class="banner err">This section could not be drawn (' + esc(name) + '): ' + esc(e && e.message) + '. The other sections are unaffected.</div>'; }
}
function animateNeedles() {
  requestAnimationFrame(() => $$('.needle').forEach(n => {
    const t = 100 * (1 - Number(n.dataset.frac || 0));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { n.setAttribute('stroke-dashoffset', t); return; }
    n.style.transition = 'none'; n.setAttribute('stroke-dashoffset', 100); void n.getBoundingClientRect(); n.style.transition = ''; requestAnimationFrame(() => n.setAttribute('stroke-dashoffset', t));
  }));
}
function renderAll(keepControls) {
  try { M = buildModel(state.data, C); } catch (e) { console.error(e); M = { empty: true }; $('#banners').innerHTML = '<div class="banner err">The data could not be read: ' + esc(e.message) + '</div>'; }
  safe('banners', renderBanners); renderAsof();
  if (!M || M.empty) {
    $('#readLine').innerHTML = 'No WHOOP data in this file yet. Run whoop.py to pull it, or drop a whoop_data.json onto this page.';
    ['today', 'trends', 'sleep', 'train', 'drivers'].forEach(k => { const id = { today: 'todayBody', trends: 'trendsBody', sleep: 'sleepBody', train: 'trainBody', drivers: 'driversBody' }[k]; $('#' + id).innerHTML = ''; });
  } else {
    safe('read', renderRead); safe('today', renderToday); safe('trends', renderTrends); safe('sleep', renderSleep); safe('train', renderTraining); safe('drivers', renderDrivers);
    if (window.onOrbUpdate) try { window.onOrbUpdate(window.ORB_VALUE, window.ORB_COLOR); } catch (e) { console.error('orb hook', e); }
  }
  safe('goals', renderGoals); if (!keepControls) safe('controls', renderControls); safe('health', renderHealth); safe('mm', renderMM);
  animateNeedles();
}

/* ---------- loading files ---------- */
async function loadFiles(files) {
  const msgs = [];
  for (const f of files) {
    try {
      const o = JSON.parse(await f.text());
      if (o && Array.isArray(o.cycles) && Array.isArray(o.recovery)) { state.data = o; state.source = 'loaded from ' + f.name; msgs.push('Loaded WHOOP data from ' + f.name + '.'); }
      else if (o && Array.isArray(o.entries)) { msgs.push('Imported ' + mergeEntries(o.entries) + ' new entries from ' + f.name + '.'); }
      else msgs.push(f.name + ' is not a whoop_data.json or user_entries.json file.');
    } catch (e) { msgs.push('Could not read ' + f.name + ': ' + e.message); }
  }
  renderAll(); const bn = $('#banners'); bn.insertAdjacentHTML('afterbegin', '<div class="banner">' + msgs.map(esc).join(' ') + '</div>');
}

function init() {
  const parse = id => { try { return JSON.parse(document.getElementById(id).textContent); } catch (e) { return null; } };
  state.data = parse('whoop-data'); state.source = null;
  if (!(state.data && state.data.cycles)) state.data = null;
  state.entries = []; mergeEntries(store.get(ENTRY_KEY) || []); const emb = parse('user-embed'); if (emb && emb.entries) mergeEntries(emb.entries);
  document.addEventListener('click', ev => {
    const t = ev.target.closest('[data-tab],[data-del],#expEntries,#resetCtl'); if (!t) return;
    if (t.dataset.tab) { goalTab = t.dataset.tab; store.set('whoopDash.goalTab', goalTab); renderGoals(); }
    else if (t.dataset.del) { const id = t.dataset.del; state.entries = state.entries.filter(e => e.id !== id && !(e.type === 'goalval' && e.d.goal === id)); saveEntries(); renderGoals(); safe('drivers', renderDrivers); }
    else if (t.id === 'expEntries') exportEntries();
    else if (t.id === 'resetCtl') { C = Object.assign({}, DEFAULTS); saveControls(); renderAll(); }
  });
  document.addEventListener('submit', ev => { const f = ev.target.closest('form[data-form]'); if (f) { ev.preventDefault(); handleForm(f); } });
  document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.dataset && t.dataset.ctl) applyControl(t);
    else if (t.id === 'fileIn') { loadFiles(Array.from(t.files)); t.value = ''; }
    else if (t.id === 'impEntries') { loadFiles(Array.from(t.files)); t.value = ''; }
  });
  let depth = 0; const drop = $('#drop');
  window.addEventListener('dragenter', ev => { if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) { depth++; drop.classList.add('on'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('on'); });
  window.addEventListener('dragover', ev => ev.preventDefault());
  window.addEventListener('drop', ev => { ev.preventDefault(); depth = 0; drop.classList.remove('on'); if (ev.dataTransfer && ev.dataTransfer.files.length) loadFiles(Array.from(ev.dataTransfer.files)); });
  renderAll();
}
let _inited = false; const boot = () => { if (!_inited) { _inited = true; init(); } };
document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
