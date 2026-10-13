/* ---------- The Story: attempts, breaks and comebacks, built from your own logs (MODELED) ---------- */
/* A lifting day comes from the MacroFactor log or a WHOOP weightlifting workout. A break is more than 14 days with no lift. */
var ST_GAP = 14;
var ST = null;
var ST_BODY;

function stPl(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function stW(n) { return stPl(n, 'week', 'weeks'); }
function stD(n) { return stPl(n, 'day', 'days'); }
function stJoin(a) { return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
function stMonthKey(di) { const d = new Date(di * DAY); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
function stMonthName(k) { return MON[k % 12]; }

function stBody() {
  if (ST_BODY !== undefined) return ST_BODY;
  ST_BODY = null;
  try { const el = document.getElementById('gym-data'); const raw = el ? JSON.parse(el.textContent) : null; if (raw && raw.body) ST_BODY = raw.body; } catch (e) { ST_BODY = null; }
  return ST_BODY;
}

/* pure: sorted day numbers in, attempts out. The Python mirror is gym.py story_attempts. */
function stSegment(dis, today) {
  const att = [];
  dis.forEach(di => {
    const a = att[att.length - 1];
    if (a && di - a.end <= ST_GAP) { a.end = di; a.n++; a.days.push(di); } else att.push({ start: di, end: di, n: 1, days: [di] });
  });
  if (!att.length) return { att, ongoing: false };
  const ongoing = today - att[att.length - 1].end <= ST_GAP;
  att.forEach((a, i) => {
    a.i = i + 1; a.cur = ongoing && i === att.length - 1;
    a.weeks = Math.floor((a.end - a.start) / 7) + 1;
    a.first = a.days.filter(x => x < a.start + 7).length;
    a.gapBefore = i ? a.start - att[i - 1].end : null;
  });
  return { att, ongoing };
}
function stStrip(att, ongoing, today) {
  if (!att.length) return '';
  const n = att.length, cur = att[n - 1];
  if (ongoing) {
    const prior = Math.max.apply(null, [0].concat(att.slice(0, -1).map(a => a.weeks)));
    let t = 'Week ' + cur.weeks + ' of ' + (n === 1 ? 'your first run' : 'attempt ' + n);
    if (n > 1) t += cur.weeks > prior ? ', your longest yet' : cur.weeks === prior ? ', level with your longest' : ', your longest was ' + prior + ' weeks';
    return t + '.';
  }
  return stD(today - cur.end) + ' since your last lift. Attempt ' + n + ' held ' + stW(cur.weeks) + '.';
}

function stLiftDays() {
  const m = new Map(), g = typeof gymModel === 'function' ? gymModel() : null;
  if (g) g.byDi.forEach((v, di) => m.set(di, { di, gym: true, whoop: false }));
  M.workouts.forEach(w => {
    if (!(w.scored && w.sport === 'weightlifting')) return;
    const o = m.get(w.di); if (o) o.whoop = true; else m.set(w.di, { di: w.di, gym: false, whoop: true });
  });
  return Array.from(m.values()).sort((a, b) => a.di - b.di);
}

function storyModel() {
  if (ST && ST.key === M) return ST.val;
  let val = null;
  try { val = buildStory(); } catch (e) { console.error('story', e); }
  ST = { key: M, val };
  return val;
}

function buildStory() {
  if (!M || M.empty) return null;
  const today = gToday(), days = stLiftDays();
  if (days.length < 3) return null;
  const seg = stSegment(days.map(d => d.di), today), att = seg.att, ongoing = seg.ongoing, last = att[att.length - 1];
  const target = C.liftWeekMin, firstWs = weekStart(days[0].di), cw = weekStart(today);
  const cnt = new Map(); days.forEach(d => { const w = weekStart(d.di); cnt.set(w, (cnt.get(w) || 0) + 1); });
  const weeks = []; for (let ws = firstWs; ws <= cw; ws += 7) weeks.push({ ws, n: cnt.get(ws) || 0, partial: ws === cw });
  let run = 0, bestRun = 0, onTarget = 0; const full = weeks.filter(w => !w.partial);
  full.forEach(w => { run = w.n >= target ? run + 1 : 0; bestRun = Math.max(bestRun, run); if (w.n >= target) onTarget++; });
  const gaps = att.slice(1).map(a => ({ from: att[a.i - 2].end, to: a.start, days: a.gapBefore, open: false }));
  if (!ongoing) gaps.push({ from: last.end, to: today, days: today - last.end, open: true });
  const longest = att.reduce((b, a) => (a.weeks >= b.weeks ? a : b), att[0]);
  const wkIdx = di => Math.floor((weekStart(di) - firstWs) / 7);
  return { today, days, att, ongoing, last, weeks, target, run, bestRun, onTarget, fullWeeks: full.length, gaps, longest, wkIdx, since: today - last.end, strip: stStrip(att, ongoing, today) };
}

/* ---------- the narrator ---------- */
function stNarrate(S) {
  const n = S.att.length, cur = S.last, prior = S.att.slice(0, -1);
  const longestPrior = Math.max.apply(null, [0].concat(prior.map(a => a.weeks)));
  const stops = n - 1, backTxt = stops === 1 ? 'once' : stops + ' times';
  let head, body;
  if (S.ongoing) {
    if (n === 1) {
      head = 'Week ' + cur.weeks + ' of your first run.';
      body = stPl(cur.n, 'lift day', 'lift days') + ' so far. Nothing is behind you yet to beat, so the job is simply to keep showing up.';
    } else {
      const hist = 'Before this, you stopped ' + backTxt + '. Those runs held ' + stJoin(prior.map(a => stW(a.weeks))) + ', and you were away ' + stJoin(S.gaps.filter(g => !g.open).map(g => stD(g.days))) + '.';
      if (cur.weeks > longestPrior) { head = 'Week ' + cur.weeks + ' of your longest run yet.'; body = 'This is attempt ' + n + '. ' + hist + ' You came back every time, and this one has already held longer than any of them.'; }
      else if (cur.weeks === longestPrior) { head = 'Week ' + cur.weeks + ', level with your longest run.'; body = 'This is attempt ' + n + '. ' + hist + ' One more week and it is the longest you have put together.'; }
      else { head = 'Week ' + cur.weeks + ' of attempt ' + n + '.'; body = hist + ' Your longest run held ' + stW(longestPrior) + ', so ' + stW(longestPrior - cur.weeks + 1) + ' more passes it.'; }
    }
    if (S.run >= 2) body += ' You have hit ' + S.target + ' or more lifts in ' + stW(S.run) + ' in a row.';
    if (S.since >= 5) body += ' Your last lift was ' + stD(S.since) + ' ago.';
  } else {
    head = stD(S.since) + ' since your last lift.';
    body = 'Attempt ' + n + ' held ' + stW(cur.weeks) + ' and ended ' + fmtDay(cur.end) + '.';
    if (n > 1) body += ' Your earlier restarts opened with ' + stJoin(S.att.slice(1).map(a => String(a.first))) + ' lifts in their first week.';
    body += ' One session starts the next run.';
  }
  return { head, body };
}

/* ---------- the arc ---------- */
function stArc(S) {
  const W = S.weeks.length, cell = 14, pad = 8, top = 40, base = 152, unit = 20, cap = 6, H = 194;
  const width = pad * 2 + W * cell, fit = W <= 44, x = i => pad + i * cell;
  const desc = 'Lifting days per week from ' + fmtDay(S.days[0].di) + ' to now. ' + S.att.map(a => 'Attempt ' + a.i + ' held ' + stW(a.weeks)).join('. ') + '.';
  let s = '<svg class="st-arc' + (fit ? ' fit' : '') + '" viewBox="0 0 ' + width + ' ' + H + '"' + (fit ? '' : ' width="' + width + '" height="' + H + '"') + ' role="img" aria-label="' + esc(desc) + '">';
  S.gaps.forEach(g => {
    const x0 = x(S.wkIdx(g.from)) + cell / 2, x1 = x(S.wkIdx(Math.min(g.to, S.today))) + cell / 2, wd = x1 - x0;
    if (wd < 6) return;
    s += '<rect x="' + x0.toFixed(1) + '" y="' + (top - 4) + '" width="' + wd.toFixed(1) + '" height="' + (base - top + 4) + '" rx="6" fill="var(--bad)" opacity=".10"/>';
    s += '<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (top + 40) + '" text-anchor="middle" class="st-gap">' + (wd >= 90 ? g.days + ' days ' + (g.open ? 'and counting' : 'away') : g.days + ' days') + '</text>';
  });
  const ty = base - S.target * unit;
  s += '<line x1="0" x2="' + width + '" y1="' + ty + '" y2="' + ty + '" stroke="var(--ref)" stroke-width="1" stroke-dasharray="3 4"/>';
  s += '<line x1="0" x2="' + width + '" y1="' + base + '" y2="' + base + '" stroke="var(--axis)" stroke-width="1"/>';
  S.weeks.forEach((w, i) => {
    if (w.n > 0) {
      const h = Math.min(w.n, cap) * unit, hit = w.n >= S.target;
      s += '<rect x="' + (x(i) + 2) + '" y="' + (base - h) + '" width="' + (cell - 4) + '" height="' + h + '" rx="3" fill="var(--accent)" opacity="' + (hit ? 1 : 0.5) + '"' + (w.partial ? ' stroke="var(--accent)" stroke-dasharray="2 2" fill-opacity=".35"' : '') + '/>';
    } else s += '<rect x="' + (x(i) + 5) + '" y="' + (base - 2) + '" width="' + (cell - 10) + '" height="2" rx="1" fill="var(--axis)"/>';
  });
  S.att.forEach(a => {
    const x0 = x(S.wkIdx(a.start)) + 2, x1 = x(S.wkIdx(a.end)) + cell - 2, wd = x1 - x0;
    s += '<path d="M' + x0.toFixed(1) + ' ' + (top - 12) + 'V' + (top - 18) + 'H' + x1.toFixed(1) + 'V' + (top - 12) + '" fill="none" stroke="var(--gold)" stroke-width="1.5"/>';
    s += '<text x="' + x0.toFixed(1) + '" y="' + (top - 24) + '" class="st-att">' + (wd >= 64 ? 'Attempt ' + a.i : a.i) + '</text>';
  });
  let lastM = -1;
  S.weeks.forEach((w, i) => {
    const m = new Date((w.ws + 3) * DAY).getUTCMonth();
    if (m !== lastM) { lastM = m; s += '<text x="' + x(i) + '" y="' + (base + 18) + '" class="st-lab">' + MON[m] + '</text>'; }
  });
  return '<div class="st-scroll' + (fit ? ' fit' : '') + '" tabindex="0">' + s + '</svg></div>' +
    '<div class="legend"><span><s style="background:var(--accent)"></s>week at or over target (dashed line, ' + S.target + ' lifts)</span><span><s style="background:var(--accent);opacity:.5"></s>some lifting</span><span><s style="background:var(--bad);opacity:.25"></s>a break of more than ' + ST_GAP + ' days</span></div>';
}

function stAttemptList(S) {
  let h = '<div class="st-list">';
  S.att.forEach((a, i) => {
    if (i) { const g = S.gaps[i - 1]; h += '<div class="st-row gap"><span>Away</span><b>' + stD(g.days) + '</b><small>' + esc(fmtDay(g.from)) + ' to ' + esc(fmtDay(g.to)) + '</small></div>'; }
    h += '<div class="st-row"><span>Attempt ' + a.i + (a.cur ? ' <em>now</em>' : '') + '</span><b>' + stW(a.weeks) + '</b><small>' + esc(fmtDay(a.start)) + ' to ' + esc(fmtDay(a.end)) + ', ' + stPl(a.n, 'lift day', 'lift days') + '</small></div>';
  });
  if (!S.ongoing) { const g = S.gaps[S.gaps.length - 1]; h += '<div class="st-row gap"><span>Away</span><b>' + stD(g.days) + ' so far</b><small>since ' + esc(fmtDay(g.from)) + '</small></div>'; }
  return h + '</div>';
}

function stTiles(S) {
  const longestGap = S.gaps.filter(g => !g.open).reduce((m, g) => Math.max(m, g.days), 0);
  const t = [
    ['Attempts', String(S.att.length), 'runs of lifting, split at ' + ST_GAP + ' idle days'],
    ['Times you came back', String(S.att.length - 1), S.att.length > 1 ? 'after ' + stJoin(S.gaps.filter(g => !g.open).map(g => g.days + ' days')) + ' away' : 'none yet'],
    ['Longest run', stW(S.longest.weeks), 'attempt ' + S.longest.i],
    ['Longest break', longestGap ? stD(longestGap) : 'none', longestGap ? 'before attempt ' + S.att.find(a => a.gapBefore === longestGap).i : 'no break so far'],
    ['Weeks at target', S.onTarget + ' of ' + S.fullWeeks, S.target + ' or more lifts, full weeks since your first'],
    ['Lift days', String(S.days.length), stPl(S.days.filter(d => d.gym).length, 'day', 'days') + ' in the gym log, ' + S.days.filter(d => d.whoop && !d.gym).length + ' only in WHOOP']];
  return '<div class="st-tiles">' + t.map(x => '<div class="cell"><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b><span>' + esc(x[2]) + '</span></div>').join('') + '</div>';
}

/* ---------- strength: then and now, and what the breaks cost ---------- */
function stLifts() {
  const g = typeof gymModel === 'function' ? gymModel() : null; if (!g) return null;
  const rows = [];
  Object.keys(g.E).forEach(ex => {
    const p = g.E[ex]; if (p.length < 5) return;
    const a = Math.max.apply(null, p.slice(0, 2).map(x => x.w)), b = Math.max.apply(null, p.slice(-2).map(x => x.w)), best = Math.max.apply(null, p.map(x => x.w));
    rows.push({ ex, n: p.length, start: a, now: b, best, pct: (b / a - 1) * 100, vals: p.map(x => x.w), lastIsBest: p[p.length - 1].w >= best, lastDi: p[p.length - 1].di, firstDi: p[0].di });
  });
  return rows.sort((x, y) => y.pct - x.pct);
}
function stLiftsCard(S) {
  const rows = stLifts(); if (!rows || !rows.length) return '';
  const g = gymModel(), gained = rows.filter(r => r.pct >= 3), flat = rows.filter(r => r.pct < 3);
  const line = r => '<tr><td>' + esc(r.ex) + '</td><td class="n">' + esc(gWt(r.ex, r.start)) + '</td><td class="n">' + esc(gWt(r.ex, r.now)) + '</td><td class="n"><span class="' + (r.pct >= 3 ? 'good' : r.pct <= -3 ? 'warn' : '') + '">' + (r.pct > 0 ? 'up ' : r.pct < 0 ? 'down ' : '') + nf(Math.abs(r.pct), 0) + '%</span></td><td class="n">' + gSpark(r.vals, 80, 24) + '</td></tr>';
  let h = '<section class="card"><div class="sec-h"><h2>Then and now</h2>' + tag('MEASURED') + '</div>';
  const top = gained[0];
  h += '<p class="sub">The heaviest weight you actually lifted, for every lift you have logged at least five times. ' + gained.length + ' of ' + rows.length + ' are up by 3 percent or more' + (top ? ', led by ' + esc(top.ex) + ' (' + esc(gWt(top.ex, top.start)) + ' to ' + esc(gWt(top.ex, top.now)) + ')' : '') + '.</p>';
  h += '<div class="scroll"><table><thead><tr><th>Lift</th><th class="n">Start</th><th class="n">Now</th><th class="n">Change</th><th class="n">Path</th></tr></thead><tbody>' + gained.map(line).join('') + '</tbody></table></div>';
  if (flat.length) h += '<h3 class="st-h3">Not moved yet</h3><div class="scroll"><table><tbody>' + flat.map(line).join('') + '</tbody></table></div><p class="sub">Flat or lower is information, not failure. A lift can sit still while another program block or a different set of lifts takes the effort.</p>';
  h += '<p class="sub">The first sessions of a lift are noisy, so the biggest percentages are often machines you only just learned.</p>';
  h += formula('start = the heaviest working set weight across the first two sessions of that lift, now = the heaviest across the last two. These are weights you actually lifted, nothing estimated. Chin ups and dips show weight added to body weight. Only lifts with five or more sessions are shown.') + '</section>';
  return h;
}
function stBreakCost(S) {
  const closed = S.gaps.filter(g => !g.open).sort((a, b) => b.days - a.days)[0], g = typeof gymModel === 'function' ? gymModel() : null;
  if (!closed || !g) return null;
  const out = [];
  Object.keys(g.E).forEach(ex => {
    const p = g.E[ex], before = p.filter(x => x.di <= closed.from), after = p.filter(x => x.di >= closed.to);
    if (before.length < 2 || !after.length) return;
    const peak = Math.max.apply(null, before.map(x => x.w)), back = after[0].w, reg = after.find(x => x.w >= peak);
    out.push({ ex, peak, back, backDi: after[0].di, now: after[after.length - 1].w, loss: (back / peak - 1) * 100, wks: reg ? Math.round((reg.di - after[0].di) / 7) : null, regained: !!reg });
  });
  return out.length ? { gap: closed, rows: out.sort((a, b) => a.loss - b.loss) } : null;
}
function stBreakCard(S) {
  const B = stBreakCost(S); if (!B) return '';
  const med = median(B.rows.map(r => r.loss)), got = B.rows.filter(r => r.regained), gw = got.length ? median(got.map(r => r.wks)) : null;
  let h = '<section class="card"><div class="sec-h"><h2>What the longest break cost</h2>' + tag('MEASURED') + '</div>';
  h += '<p class="sub">You were away ' + stD(B.gap.days) + ' (' + esc(fmtDay(B.gap.from)) + ' to ' + esc(fmtDay(B.gap.to)) + '). For the ' + B.rows.length + ' lifts logged both before and after, the first session back sat ' + (med < -0.5 ? 'a median of <b>' + nf(Math.abs(med), 0) + '%</b> below the old peak' : med > 0.5 ? 'a median of <b>' + nf(med, 0) + '%</b> above the old peak' : 'level with the old peak') + '. ' +
    (got.length ? got.length + ' of ' + B.rows.length + ' got back to that weight' + (gw != null ? ', a median of ' + stW(gw) + ' after that first session' : '') + '.' : 'None are back to the old peak yet.') + '</p>';
  h += '<div class="scroll"><table><thead><tr><th>Lift</th><th class="n">Peak before</th><th class="n">First session back</th><th class="n">Now</th><th class="n">Back to peak</th></tr></thead><tbody>' +
    B.rows.map(r => '<tr><td>' + esc(r.ex) + '</td><td class="n">' + esc(gWt(r.ex, r.peak)) + '</td><td class="n">' + esc(gWt(r.ex, r.back)) + ' <small class="muted">(' + esc(fmtDay(r.backDi)) + ', ' + (r.loss >= 0 ? 'up ' : 'down ') + nf(Math.abs(r.loss), 0) + '%)</small></td><td class="n">' + esc(gWt(r.ex, r.now)) + '</td><td class="n">' + (r.regained ? (r.wks === 0 ? 'right away' : 'after ' + stW(r.wks)) : '<span class="muted">not yet</span>') + '</td></tr>').join('') + '</tbody></table></div>';
  h += formula('peak = the heaviest weight you actually lifted on that lift before the break began. First session back = the heaviest working set on or after the day you restarted. Back to peak = the first session that matched or beat that peak weight, counted from that first session back. Only lifts with two or more sessions before and one after are included.') + '</section>';
  return h;
}

/* ---------- what the body did (WHOOP) ---------- */
function stRecovered(d) { return d.okRec && isNum(d.recovery); }
function stWeekStats(S) {
  const liftWk = new Map(); S.days.forEach(d => { const w = weekStart(d.di); liftWk.set(w, (liftWk.get(w) || 0) + 1); });
  const byWeek = new Map(); M.days.forEach(d => { if (!stRecovered(d)) return; const w = weekStart(d.di); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(d); });
  const rows = [];
  byWeek.forEach((ds, ws) => {
    if (ds.length < 4 || ws + 6 > M.anchor) return;
    const asl = ds.filter(d => d.main && d.main.asleep != null).map(d => d.main.asleep / HOUR);
    rows.push({ ws, lifts: liftWk.get(ws) || 0, rec: mean(ds.map(d => d.recovery)), hrv: mean(ds.filter(d => isNum(d.hrv)).map(d => d.hrv)), rhr: mean(ds.filter(d => isNum(d.rhr)).map(d => d.rhr)), asl: asl.length >= 3 ? mean(asl) : null });
  });
  return rows;
}
function stBodyCard(S) {
  const rows = stWeekStats(S), hi = rows.filter(r => r.lifts >= S.target), zero = rows.filter(r => r.lifts === 0);
  const M_ = [['Recovery', 'rec', v => nf(v, 0) + '%', true], ['HRV', 'hrv', v => nf(v, 1) + ' ms', true], ['Resting heart rate', 'rhr', v => nf(v, 1) + ' bpm', false], ['Hours asleep', 'asl', v => nf(v, 1) + ' h', true]];
  let h = '<section class="card"><div class="sec-h"><h2>What your body did</h2>' + tag('MEASURED') + '</div>';
  if (hi.length >= 3 && zero.length >= 3) {
    h += '<p class="sub">Weeks with ' + S.target + ' or more lifts (' + hi.length + ' weeks) against weeks with none (' + zero.length + ' weeks), from your WHOOP days.</p><div class="scroll"><table><thead><tr><th>Measure</th><th class="n">Lifting weeks</th><th class="n">No lifting</th><th class="n">Gap</th></tr></thead><tbody>';
    M_.forEach(m => {
      const a = mean(hi.map(r => r[m[1]]).filter(isNum)), b = mean(zero.map(r => r[m[1]]).filter(isNum)); if (a == null || b == null) return;
      const d = a - b, good = (d > 0) === m[3], small = Math.abs(d / b) < 0.02;
      h += '<tr><td>' + m[0] + '</td><td class="n">' + esc(m[2](a)) + '</td><td class="n">' + esc(m[2](b)) + '</td><td class="n"><span class="' + (small ? '' : good ? 'good' : 'warn') + '">' + (small ? 'about the same' : (d > 0 ? 'up ' : 'down ') + (m[1] === 'rec' ? nf(Math.abs(d), 0) + ' points' : esc(m[2](Math.abs(d))))) + '</span></td></tr>';
    });
    h += '</tbody></table></div><p class="sub">This is a pattern in your own weeks, not proof of cause. Weeks off are often sick, travel or busy weeks, which move these numbers by themselves.</p>';
  } else h += '<p class="sub">Not enough weeks yet to compare lifting weeks with off weeks. It needs at least three of each with WHOOP data (you have ' + hi.length + ' and ' + zero.length + ').</p>';
  // before and during the latest attempt
  const A = S.last, a0 = A.start, before = M.days.filter(d => stRecovered(d) && d.di >= a0 - 28 && d.di < a0), during = M.days.filter(d => stRecovered(d) && d.di >= a0 && d.di <= M.anchor);
  if (before.length >= 10 && during.length >= 10) {
    h += '<h3 class="st-h3">Before attempt ' + A.i + ' and during it</h3><p class="sub">The 28 days before ' + esc(fmtDay(a0)) + ' (' + before.length + ' days) against ' + esc(fmtDay(a0)) + ' to ' + esc(fmtDay(M.anchor)) + ' (' + during.length + ' days).</p><div class="st-pairs">';
    [['Recovery', d => d.recovery, v => nf(v, 0) + '%', true], ['HRV', d => d.hrv, v => nf(v, 1) + ' ms', true], ['Resting heart rate', d => d.rhr, v => nf(v, 1) + ' bpm', false], ['Hours asleep', d => d.main && d.main.asleep != null ? d.main.asleep / HOUR : null, v => nf(v, 1) + ' h', true]].forEach(m => {
      const x = mean(before.map(m[1]).filter(isNum)), y = mean(during.map(m[1]).filter(isNum)); if (x == null || y == null) return;
      const d = y - x, small = Math.abs(d / x) < 0.02, good = (d > 0) === m[3];
      h += '<div class="cell"><small>' + m[0] + '</small><b>' + esc(m[2](y)) + '</b><span class="' + (small ? '' : good ? 'good' : 'warn') + '">' + (small ? 'about the same as before' : arrow(d) + ' from ' + esc(m[2](x))) + '</span></div>';
    });
    h += '</div>';
  }
  h += formula('each week needs at least 4 scored recovery days and ends before the latest day on file. Group means are the average of weekly means. A gap under 2 percent counts as about the same. Resting heart rate is better when lower.') + '</section>';
  return h;
}

/* rough patches: stretches when your 7 day recovery sat well under your own normal, and how long the way back took */
function stPatches() {
  const rec = new Map(); M.days.forEach(d => { if (stRecovered(d)) rec.set(d.di, d.recovery); });
  const first = M.days[0].di, A = M.anchor, out = []; let cur = null;
  for (let di = first + 30; di <= A; di++) {
    const w = []; for (let k = 0; k < 7; k++) { const v = rec.get(di - k); if (v != null) w.push(v); }
    if (w.length < 4) continue;
    const bs = []; for (let k = 8; k <= 63; k++) { const v = rec.get(di - k); if (v != null) bs.push(v); }
    if (bs.length < 20) continue;
    const base = median(bs), m7 = mean(w);
    if (!cur && m7 <= base - 6) cur = { start: di, base, min: m7, end: null };
    else if (cur) { cur.min = Math.min(cur.min, m7); if (m7 >= cur.base - 3) { cur.end = di; out.push(cur); cur = null; } }
  }
  if (cur) out.push(cur);
  return out.filter(p => (p.end == null ? A : p.end) - p.start >= 3).map(p => ({ start: p.start, end: p.end, days: (p.end == null ? A : p.end) - p.start, depth: p.base - p.min, base: p.base, open: p.end == null }));
}
function stPatchCard() {
  const P = stPatches(); if (!P.length && M.days.length < 90) return '';
  let h = '<section class="card"><div class="sec-h"><h2>Rough patches and the way back</h2>' + tag('MODELED') + '</div>';
  if (!P.length) h += '<p class="sub">No stretch where your 7 day recovery sat 6 or more points under your own normal. That is rare, and a good sign.</p>';
  else {
    const closed = P.filter(p => !p.open), md = closed.length ? median(closed.map(p => p.days)) : null;
    h += '<p class="sub">' + stPl(P.length, 'stretch', 'stretches') + ' when your recovery sat well under your own normal' + (md != null ? '. Back to normal took a median of ' + stD(Math.round(md)) + '.' : '.') + (P.some(p => p.open) ? ' One is still going.' : '') + '</p><div class="st-list">';
    P.slice(-5).reverse().forEach(p => {
      h += '<div class="st-row"><span>' + esc(fmtDay(p.start)) + (p.open ? ' to now' : ' to ' + esc(fmtDay(p.end))) + '</span><b>' + (p.open ? stD(p.days) + ' so far' : stD(p.days) + ' to recover') + '</b><small>about ' + nf(p.depth, 0) + ' points under your normal of ' + nf(p.base, 0) + '</small></div>';
    });
    h += '</div>';
  }
  h += formula('for each day, the 7 day average of recovery is compared with the median of your recovery from 8 to 63 days earlier. A patch starts when the average is 6 or more points under that median and ends when it is back within 3 points. Patches shorter than 3 days are dropped. Needs 30 days of history and 20 scored days in the baseline.') + '</section>';
  return h;
}

/* ---------- body weight, steps and the month by month ledger ---------- */
function stSeriesKeys(o) { return Object.keys(o || {}).sort(); }
function stWeightLog() {            // WHOOP only shares your current weight, so the app keeps a dated log of it at every sync
  let L = null; try { L = state.data && state.data.weight_log; } catch (e) { L = null; }
  const ks = stSeriesKeys(L).filter(k => isNum(L[k]) && L[k] > 20);
  return { L, ks };
}
function stWeightAt(wl, di) {       // last logged WHOOP weight on or before a day, in pounds
  let v = null; wl.ks.forEach(k => { if (gDi(k) <= di) v = wl.L[k] * 2.2046226; });
  return v;
}
function stStepsSeries() {          // WHOOP first, MacroFactor fills days WHOOP does not have
  const out = {}, b = stBody() || {};
  Object.keys(b.steps || {}).forEach(k => { out[k] = b.steps[k]; });
  M.days.forEach(d => { if (isNum(d.steps) && d.steps > 0) out[new Date(d.di * DAY).toISOString().slice(0, 10)] = d.steps; });
  return out;
}
function stBodyChapter(S) {
  const wl = stWeightLog();
  let wk = null; try { const w = state.data && state.data.body && state.data.body.weight_kilogram; if (isNum(w) && w > 20) wk = w * 2.2046226; } catch (e) { wk = null; }
  const steps = stStepsSeries(), st = stSeriesKeys(steps);
  if (wk == null && wl.ks.length === 0 && st.length < 30) return '';
  const rows = stLifts() || [], gained = rows.filter(r => r.pct >= 3).length;
  let h = '<section class="card"><div class="sec-h"><h2>Body weight and steps</h2>' + tag('MEASURED') + '</div>';
  if (wk != null) {
    const d0 = wl.ks.length ? gDi(wl.ks[0]) : null, v0 = wl.ks.length ? wl.L[wl.ks[0]] * 2.2046226 : null, shift = v0 != null ? wk - v0 : null;
    const pts = wl.ks.map(k => wl.L[k] * 2.2046226);
    h += '<div class="st-pairs"><div class="cell"><small>Weight now (WHOOP)</small><b>' + esc(gW(wk)) + '</b><span>' + (shift != null && wl.ks.length > 1 ? (Math.abs(shift) < 0.05 ? 'unchanged' : (shift >= 0 ? 'up ' : 'down ') + esc(gW(Math.abs(shift)))) + ' since ' + esc(fmtDay(d0)) : 'logged from ' + esc(fmtDay(d0 != null ? d0 : S.today)) + ' on') + '</span></div>' +
      (pts.length >= 3 ? '<div class="cell"><small>Path</small>' + sparkline(pts, 150, 34) + '<span>' + esc(fmtDay(d0)) + ' to ' + esc(fmtDay(gDi(wl.ks[wl.ks.length - 1]))) + '</span></div>' : '') + '</div>';
    if (pts.length < 3) h += '<p class="sub">WHOOP only shares your current weight, not the history. This page now saves it at every refresh, so a path appears once you have updated your weight in WHOOP a few times.</p>';
  }
  if (rows.length) h += '<p class="sub">Over the same stretch, ' + gained + ' of your ' + rows.length + ' tracked lifts rose by 3 percent or more. Body weight cannot tell muscle from fat, so use a tape measure or a photo from the same spot and light to see what the weight is made of.</p>';
  if (st.length >= 30) {
    const a1 = st.slice(0, 30).map(k => steps[k]), a2 = st.slice(-30).map(k => steps[k]), x = mean(a1), y = mean(a2);
    h += '<p class="sub">Steps per day: ' + Math.round(x).toLocaleString('en-US') + ' in your first logged 30 days, ' + Math.round(y).toLocaleString('en-US') + ' in the latest 30 (' + (y >= x ? 'up ' : 'down ') + nf(Math.abs(y / x - 1) * 100, 0) + '%).</p>';
  }
  h += formula('weight is the one in your WHOOP profile. WHOOP does not share weight history, so each refresh saves the current value with its date and the path is built from those saved values. Steps come from WHOOP first; days WHOOP does not have are filled from the MacroFactor export.') + '</section>';
  return h;
}
function stMonthsCard(S) {
  const stepsAll = stStepsSeries(), wlog = stWeightLog();
  const cand = [S.days[0].di, M.days[0].di].concat(stSeriesKeys(stepsAll).slice(0, 1).map(gDi)), cur = stMonthKey(M.anchor);
  const from = Math.max(stMonthKey(Math.min.apply(null, cand)), cur - 9);
  const rowsM = [];
  for (let k = from; k <= cur; k++) {
    const inM = di => stMonthKey(di) === k;
    const lifts = S.days.filter(d => inM(d.di)).length;
    const sk = stSeriesKeys(stepsAll).filter(d => inM(gDi(d))), sv = sk.length >= 7 ? mean(sk.map(d => stepsAll[d])) : null;
    const mEnd = Math.min(M.anchor, Date.UTC(Math.floor(k / 12), (k % 12) + 1, 1) / DAY - 1), tw = wlog.ks.length ? stWeightAt(wlog, mEnd) : null;
    const rd = M.days.filter(d => inM(d.di) && stRecovered(d)), rec = rd.length >= 7 ? mean(rd.map(d => d.recovery)) : null, hv = rd.filter(d => isNum(d.hrv)), hrv = hv.length >= 7 ? mean(hv.map(d => d.hrv)) : null;
    rowsM.push({ k, lifts, sv, tw, rec, hrv });
  }
  if (rowsM.length < 2) return '';
  const nd = '<span class="muted">no data</span>';
  let h = '<section class="card"><div class="sec-h"><h2>Month by month</h2>' + tag('MEASURED') + '</div><p class="sub">Everything on one line per month, so a good month or a quiet one is easy to spot.</p><div class="scroll"><table><thead><tr><th>Month</th><th class="n">Lift days</th><th class="n">Steps a day</th><th class="n">Weight</th><th class="n">Recovery</th><th class="n">HRV</th></tr></thead><tbody>';
  rowsM.forEach(r => {
    h += '<tr><td>' + stMonthName(r.k) + (r.k % 12 === 0 || r === rowsM[0] ? ' ' + Math.floor(r.k / 12) : '') + '</td><td class="n">' + (r.lifts ? '<b>' + r.lifts + '</b>' : '<span class="muted">0</span>') + '</td><td class="n">' + (r.sv != null ? Math.round(r.sv).toLocaleString('en-US') : nd) + '</td><td class="n">' + (r.tw != null ? esc(gW(r.tw)) : nd) + '</td><td class="n">' + (r.rec != null ? nf(r.rec, 0) + '%' : nd) + '</td><td class="n">' + (r.hrv != null ? nf(r.hrv, 0) + ' ms' : nd) + '</td></tr>';
  });
  h += '</tbody></table></div>' + formula('lift days count each calendar day with a logged lift (gym log or WHOOP). Steps, recovery and HRV are monthly averages and need at least 7 days of data. Weight is the last WHOOP weight saved by the end of the month. Steps come from WHOOP first and fall back to the MacroFactor export.') + '</section>';
  return h;
}

/* ---------- next marks ---------- */
function stNextCard(S) {
  const items = [], g = typeof gymModel === 'function' ? gymModel() : null, prior = Math.max.apply(null, [0].concat(S.att.slice(0, -1).map(a => a.weeks)));
  if (S.ongoing && S.att.length > 1) {
    if (S.last.weeks > prior) items.push('Every extra week extends your longest run, now ' + stW(S.last.weeks) + '.');
    else items.push(stW(prior - S.last.weeks + 1) + ' more passes your longest run of ' + stW(prior) + '.');
  } else if (!S.ongoing) items.push('One lift ends the break. The earlier restarts opened with ' + stJoin(S.att.slice(1).map(a => String(a.first))) + ' lifts in the first week.');
  const cw = S.weeks[S.weeks.length - 1], left = S.target - cw.n;
  if (S.ongoing) items.push(left > 0 ? 'This week: ' + cw.n + ' of ' + S.target + ' lifts so far, ' + stD(Math.max(0, weekStart(S.today) + 6 - S.today)) + ' left after today.' : 'This week: target met with ' + cw.n + ' lifts.');
  if (g) {
    const near = (stLifts() || []).filter(r => !r.lastIsBest && r.now >= r.best * 0.97).slice(0, 3);
    near.forEach(r => items.push(esc(r.ex) + ' is within ' + nf((1 - r.now / r.best) * 100, 0) + '% of its best (' + esc(gWt(r.ex, r.now)) + ' against ' + esc(gWt(r.ex, r.best)) + ').'));
    const recent = g.prs.filter(p => p.di >= S.today - 27).length;
    if (recent) items.push(stPl(recent, 'new best', 'new bests') + ' in the last 28 days.');
  }
  if (!items.length) return '';
  return '<section class="card"><div class="sec-h"><h2>Next marks</h2></div><ul class="calllist">' + items.map(x => '<li>' + x + '</li>').join('') + '</ul></section>';
}

/* ---------- pages ---------- */
function renderStory() {
  const el = $('#storyBody'); if (!el) return;
  const S = storyModel();
  if (!M || M.empty) { el.innerHTML = ''; return; }
  if (!S) {
    el.innerHTML = '<div class="pagehead"><h1>The story</h1><p>It starts with your first logged lift.</p></div><div class="banner">There are not enough lifting days yet. Export your workouts from MacroFactor into Downloads and refresh, or lift with WHOOP tracking on, and the story will start to write itself.</div>';
    return;
  }
  const N = stNarrate(S);
  let h = '<div class="pagehead"><h1>The story</h1><p>' + esc(fmtDay(S.days[0].di)) + ' to ' + esc(fmtDay(S.today)) + '. Built from your lifts, your WHOOP days and your body log. It only says what the data shows.</p></div>';
  h += '<section class="card st-hero"><div class="sec-h"><h2>The arc</h2>' + tag('MODELED') + '</div><p class="st-head">' + esc(N.head) + '</p><p class="st-text">' + esc(N.body) + '</p>' + stArc(S) + stAttemptList(S) + stTiles(S) +
    formula('a lifting day is any day with a lift in your MacroFactor log or a WHOOP weightlifting workout. A run is a chain of lifting days with no more than ' + ST_GAP + ' days between them. More than ' + ST_GAP + ' days without a lift is a break, and the next lift starts a new attempt. Weeks run Monday to Sunday and the target is your lifting setting in Goals.') + '</section>';
  [stNextCard, stLiftsCard, stBreakCard, stBodyCard, stPatchCard, stBodyChapter, typeof journalStoryCard === 'function' ? journalStoryCard : function () { return ''; }, stMonthsCard].forEach(f => { try { h += f(S) || ''; } catch (e) { console.error('story part', f.name, e); } });
  el.innerHTML = h;
  const sc = el.querySelector('.st-scroll:not(.fit)'); if (sc) sc.scrollLeft = sc.scrollWidth;
}
function storyStrip() {
  const S = storyModel(); if (!S) return '';
  const N = stNarrate(S), tail = S.weeks.slice(-16), cap = 6, hh = 30, cell = 10;
  let bars = '<svg class="st-mini" width="' + (tail.length * cell) + '" height="' + (hh + 2) + '" viewBox="0 0 ' + (tail.length * cell) + ' ' + (hh + 2) + '" role="img" aria-label="Lifting days in each of the last ' + tail.length + ' weeks">';
  tail.forEach((w, i) => { const h = w.n ? Math.max(3, Math.min(w.n, cap) / cap * hh) : 2; bars += '<rect x="' + (i * cell + 1) + '" y="' + (hh - h + 1) + '" width="' + (cell - 2) + '" height="' + h + '" rx="2" fill="' + (w.n ? 'var(--accent)' : 'var(--axis)') + '" opacity="' + (w.n >= S.target ? 1 : w.n ? 0.5 : 0.8) + '"/>'; });
  bars += '</svg>';
  return '<section class="card st-strip"><div class="st-strip-in"><div><small class="st-eyebrow">The story so far</small><p class="st-head sm">' + esc(N.head) + '</p><a class="st-link" href="#story">Read the whole story</a></div>' + bars + '</div></section>';
}

/* ---------- points and badges ---------- */
function storyXPEvents() {
  const S = storyModel(); if (!S) return [];
  return S.att.filter(a => a.i > 1).map(a => ({ di: a.start, xp: 30 }));
}
function storyBadgeList() {
  const S = storyModel(); if (!S) return [];
  const out = [], back = S.att.filter(a => a.i > 1 && a.weeks >= 4)[0];
  out.push({ id: 'cameback', ic: 'CB', name: 'Came Back', desc: 'Restart after a break of more than ' + ST_GAP + ' days and keep it going for 4 weeks', done: !!back, when: back ? Math.min(back.start + 27, S.today) : null, prog: S.att.length > 1 ? 'latest restart: ' + stW(S.last.weeks) + ' of 4' : 'no break to come back from yet' });
  const rec = S.att.length > 1 && S.longest.i === S.last.i && S.last.weeks >= 6;
  out.push({ id: 'record', ic: 'RR', name: 'Record Run', desc: 'Your longest run of lifting so far, at least 6 weeks', done: rec, when: rec ? Math.min(S.last.start + 41, S.today) : null, prog: 'longest run: ' + stW(S.longest.weeks) + ' of 6' });
  return out;
}
