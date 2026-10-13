/* ---------- WHOOP journal (from the WHOOP data export) ---------- */
/* The journal is not in the WHOOP API. It comes from the export csv and is matched to the SAME cycle's recovery:
   the entry for a cycle describes the day before the sleep that ends it, so it lines up with that morning's recovery. */
var JR;                                   // undefined until first use, then the model or null
const JR_MIN = 8;                         // days needed on each side of a yes or no split

function jrLabel(q) {
  let s = String(q || '').replace(/\?+\s*$/, '').trim();
  const map = [[/alcohol|drink/i, 'Alcohol'], [/caffeine|coffee/i, 'Caffeine'], [/creatine/i, 'Creatine'], [/sauna/i, 'Sauna'], [/rest day/i, 'Rest day'], [/late/i, 'Worked late'], [/social media/i, 'Social media'], [/home.?cooked/i, 'Home cooked food'], [/hydrat/i, 'Hydration'], [/read/i, 'Reading before bed'], [/screen/i, 'Screens before bed'], [/stress/i, 'Stress'], [/melatonin/i, 'Melatonin'], [/sex/i, 'Sex'], [/stretch/i, 'Stretching'], [/cold|ice bath|plunge/i, 'Cold exposure'], [/sunlight|outside/i, 'Sunlight']];
  for (let i = 0; i < map.length; i++) if (map[i][0].test(s)) return map[i][1];
  s = s.replace(/^(Have any|Had any|Did you|Have you|Used a|Used|Took a|Took|Had a|Had|Ate|Did)\s+/i, '');
  s = s.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(q);
}

function jrWelch(a, b) {
  const va = a.reduce((s, x) => s + (x - mean(a)) * (x - mean(a)), 0) / (a.length - 1), vb = b.reduce((s, x) => s + (x - mean(b)) * (x - mean(b)), 0) / (b.length - 1);
  const se = Math.sqrt(va / a.length + vb / b.length); if (!se) return 0;
  return (mean(a) - mean(b)) / se;
}

function journalModel() {
  if (JR !== undefined) return JR;
  JR = null;
  try {
    const el = document.getElementById('journal-data'); const raw = el ? JSON.parse(el.textContent) : null;
    if (!raw || !Array.isArray(raw.rows) || !raw.rows.length || !M || M.empty) return JR;
    const rows = raw.rows.map(r => {
      const m = /^([+-])(\d\d):(\d\d)$/.exec(r.o || '+00:00'); const off = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) * 60000 : 0;
      return { t: Date.parse(String(r.k).replace(' ', 'T') + 'Z') - off, a: r.a || {} };
    }).filter(r => isFinite(r.t)).sort((p, q) => p.t - q.t);
    const TOL = 20 * 60000, days = [];
    M.days.forEach(d => {
      const refs = [d.main && d.main.start, d.start].filter(isNum); if (!refs.length) return;
      let best = null, bd = TOL + 1;
      refs.forEach(ref => { for (let i = 0; i < rows.length; i++) { const dt = Math.abs(rows[i].t - ref); if (dt < bd) { bd = dt; best = rows[i]; } else if (rows[i].t > ref + TOL) break; } });
      if (best && bd <= TOL) days.push({ d, a: best.a });
    });
    if (days.length < 14) return JR;
    const qs = new Set(); days.forEach(x => Object.keys(x.a).forEach(q => qs.add(q)));
    JR = { days, qs: Array.from(qs), through: raw.through };
  } catch (e) { console.error('journal', e); JR = null; }
  return JR;
}

/* recovery on days a habit was yes against no, strongest first */
function journalEffects() {
  const J = journalModel(); if (!J) return [];
  const out = [];
  J.qs.forEach(q => {
    const yes = [], no = [];
    J.days.forEach(x => { if (!x.d.okRec || !isNum(x.d.recovery) || x.a[q] == null) return; (x.a[q] ? yes : no).push(x); });
    if (yes.length < JR_MIN || no.length < JR_MIN) return;
    const ry = yes.map(x => x.d.recovery), rn = no.map(x => x.d.recovery), t = jrWelch(ry, rn);
    const pick = f => { const a = yes.map(x => f(x.d)).filter(isNum), b = no.map(x => f(x.d)).filter(isNum); return a.length >= 5 && b.length >= 5 ? { y: mean(a), n: mean(b) } : null; };
    out.push({ q, label: jrLabel(q), ny: yes.length, nn: no.length, y: mean(ry), n: mean(rn), diff: mean(ry) - mean(rn), t,
      hrv: pick(d => d.hrv), rhr: pick(d => d.rhr), asl: pick(d => d.main && d.main.asleep != null ? d.main.asleep / HOUR : null) });
  });
  return out.sort((p, q) => Math.abs(q.t) - Math.abs(p.t));
}

function jrStrength(t) { const a = Math.abs(t); return a >= 2 ? 'clear' : a >= 1.3 ? 'leaning' : 'no clear effect'; }

function journalCard() {
  const J = journalModel(); if (!J) return '';
  const E = journalEffects();
  const first = J.days.reduce((m, x) => Math.min(m, x.d.di), 1e9), last = J.days.reduce((m, x) => Math.max(m, x.d.di), -1e9);
  let h = '<section class="card"><div class="sec-h"><h2>Your journal and recovery</h2>' + tag('MEASURED') + '</div>';
  if (!E.length) return h + '<p class="sub">The journal covers ' + J.days.length + ' days (' + esc(fmtDay(first)) + ' to ' + esc(fmtDay(last)) + '), which is not yet enough to split any habit into yes and no groups of ' + JR_MIN + ' days each.</p></section>';
  h += '<p class="sub">From your WHOOP journal export, ' + J.days.length + ' days (' + esc(fmtDay(first)) + ' to ' + esc(fmtDay(last)) + '). Each habit is compared with the recovery score of the same cycle. Patterns in your own data, not proof of cause.</p><div class="levers">';
  E.slice(0, 6).forEach((e, i) => {
    const s = jrStrength(e.t), cls = s === 'clear' ? 'strong' : s === 'leaning' ? '' : 'weak';
    let txt = 'Yes: <b>' + nf(e.y, 0) + '%</b> recovery (' + e.ny + ' days). No: <b>' + nf(e.n, 0) + '%</b> (' + e.nn + ' days).';
    if (i === 0 && s !== 'no clear effect') {
      const bits = [];
      if (e.hrv) bits.push('HRV ' + nf(e.hrv.y, 0) + ' against ' + nf(e.hrv.n, 0) + ' ms');
      if (e.rhr) bits.push('resting heart rate ' + nf(e.rhr.y, 0) + ' against ' + nf(e.rhr.n, 0) + ' bpm');
      if (e.asl) bits.push('hours asleep ' + nf(e.asl.y, 1) + ' against ' + nf(e.asl.n, 1));
      if (bits.length) txt += ' On those days: ' + bits.join(', ') + '.';
    }
    h += '<div class="lv ' + cls + '"><div class="lvh"><b>' + esc(e.label) + '</b><span>' + (e.diff > 0 ? '+' : e.diff < 0 ? 'minus ' : '') + nf(Math.abs(e.diff), 0) + ' pts, ' + s + '</span></div><p>' + txt + '</p></div>';
  });
  h += '</div><p class="sub">Days with drinks can also be late nights or weekends, so part of a gap may come from that and not from the habit alone.</p>';
  h += formula('Each journal entry is matched to the recovery of the same WHOOP cycle (start times within 20 minutes). A habit appears when it has at least ' + JR_MIN + ' yes days and ' + JR_MIN + ' no days. The label comes from a Welch t statistic on the two groups of recovery scores: clear at 2 or more, leaning at 1.3 to 2, otherwise no clear effect. Habits are ranked by that statistic.') + '</section>';
  return h;
}

/* Story: what your habits looked like in the latest break against the run around it */
function journalStoryCard(S) {
  const J = journalModel(); if (!J || !S || !S.gaps || !S.gaps.length) return '';
  const cands = S.gaps.slice().reverse();
  for (let gi = 0; gi < cands.length; gi++) {
    const g = cands[gi]; const idx = S.gaps.indexOf(g);
    const bLo = g.from, bHi = g.open ? M.anchor : g.to - 1;
    let rLo, rHi;
    if (!g.open) { const a = S.att[idx + 1]; if (!a) continue; rLo = a.start; rHi = a.end; } else { const a = S.att[idx]; if (!a) continue; rLo = a.start; rHi = a.end; }
    const inB = J.days.filter(x => x.d.di >= bLo && x.d.di <= bHi), inR = J.days.filter(x => x.d.di >= rLo && x.d.di <= rHi);
    if (inB.length < 12 || inR.length < 12) continue;
    const rows = [];
    J.qs.forEach(q => {
      const rate = arr => { const v = arr.filter(x => x.a[q] != null); return v.length >= 10 ? { p: v.filter(x => x.a[q]).length / v.length * 100, n: v.length } : null; };
      const b = rate(inB), r = rate(inR); if (!b || !r) return;
      const diff = r.p - b.p; if (Math.abs(diff) < 15) return;
      rows.push({ label: jrLabel(q), b, r, diff });
    });
    rows.sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff));
    const recB = inB.filter(x => x.d.okRec && isNum(x.d.recovery)).map(x => x.d.recovery), recR = inR.filter(x => x.d.okRec && isNum(x.d.recovery)).map(x => x.d.recovery);
    let h = '<section class="card"><div class="sec-h"><h2>Your habits, break and run</h2>' + tag('MEASURED') + '</div>';
    h += '<p class="sub">From your WHOOP journal. The break: ' + esc(fmtDay(bLo)) + ' to ' + esc(fmtDay(Math.min(bHi, M.anchor))) + ' (' + inB.length + ' journal days). The run: ' + esc(fmtDay(rLo)) + ' to ' + esc(fmtDay(rHi)) + ' (' + inR.length + ' journal days). Only habits that changed by 15 points or more are listed.</p>';
    if (rows.length) {
      h += '<div class="scroll"><table><thead><tr><th>Habit</th><th class="n">Break</th><th class="n">Run</th><th class="n">Change</th></tr></thead><tbody>' +
        rows.slice(0, 7).map(r => '<tr><td>' + esc(r.label) + '</td><td class="n">' + nf(r.b.p, 0) + '%</td><td class="n">' + nf(r.r.p, 0) + '%</td><td class="n">' + (r.diff > 0 ? 'up ' : 'down ') + nf(Math.abs(r.diff), 0) + ' pts</td></tr>').join('') + '</tbody></table></div>';
    } else h += '<p class="sub">No habit changed by 15 points or more between the two stretches.</p>';
    if (recB.length >= 8 && recR.length >= 8) h += '<p class="sub">Average recovery was <b>' + nf(mean(recB), 0) + '%</b> in the break and <b>' + nf(mean(recR), 0) + '%</b> in the run' + (mean(recR) < mean(recB) - 2 ? '. It ran lower while you were lifting, which fits the extra load and is not a sign the habit changes hurt.' : '.') + '</p>';
    return h + formula('Each cell is the share of journal days where you answered yes, in the stretch named. Break days run from your last lift to the day before you restarted. Habits with fewer than 10 answered days in either stretch are left out.') + '</section>';
  }
  return '';
}
