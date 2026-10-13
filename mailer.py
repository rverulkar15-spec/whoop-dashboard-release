"""Morning email for the WHOOP dashboard. Standard library only.

Used by whoop.py after a successful sync. Does nothing unless email is set up
(py whoop.py --setup-email). Sends at most one email per day, and only once
today's recovery score exists, so a 6:00 AM run before you wake up just waits
for the next scheduled run.
"""
import json
import os
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

HOST, PORT = "smtp.gmail.com", 465


def cfg_path(secret_dir):
    return os.path.join(secret_dir, "email.json")


def load_cfg(secret_dir):
    try:
        with open(cfg_path(secret_dir), "r", encoding="utf-8") as f:
            c = json.load(f)
        if c.get("address") and c.get("app_password"):
            return c
    except (OSError, ValueError):
        pass
    return None


def save_cfg(secret_dir, cfg):
    os.makedirs(secret_dir, exist_ok=True)
    with open(cfg_path(secret_dir), "w", encoding="utf-8") as f:
        json.dump(cfg, f)
    try:
        os.chmod(cfg_path(secret_dir), 0o600)
    except OSError:
        pass


def clean_pw(v):
    return "".join(ch for ch in (v or "") if ch.isalnum())


def ts(s):
    return datetime.strptime(s.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S.%f%z") if "." in s \
        else datetime.strptime(s.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S%z")


def mean(xs):
    xs = [x for x in xs if x is not None]
    return (sum(xs) / len(xs), len(xs)) if xs else (None, 0)


def band(score):
    return "Green" if score >= 67 else "Yellow" if score >= 34 else "Red"


def sleep_hours(s):
    st = s["score"]["stage_summary"]
    return (st["total_light_sleep_time_milli"] + st["total_slow_wave_sleep_time_milli"]
            + st["total_rem_sleep_time_milli"]) / 3600000.0


def windows(archive, now):
    """Return {metric: (last28 mean, n, prior28 mean, n)} using UTC record times."""
    a, b = now - timedelta(days=28), now - timedelta(days=56)

    def pick(rows, tkey, fn):
        cur, prv = [], []
        for r in rows:
            if r.get("score_state") != "SCORED" or not r.get("score"):
                continue
            if r.get("nap"):
                continue
            t = ts(r[tkey])
            v = fn(r)
            if v is None:
                continue
            if t >= a:
                cur.append(v)
            elif t >= b:
                prv.append(v)
        return cur, prv

    out = {}
    for name, rows, tkey, fn in (
        ("Recovery", archive["recovery"], "created_at", lambda r: r["score"].get("recovery_score")),
        ("HRV (ms)", archive["recovery"], "created_at", lambda r: r["score"].get("hrv_rmssd_milli")),
        ("Resting HR", archive["recovery"], "created_at", lambda r: r["score"].get("resting_heart_rate")),
        ("Sleep hours", archive["sleep"], "end", sleep_hours),
        ("Sleep performance", archive["sleep"], "end", lambda r: r["score"].get("sleep_performance_percentage")),
        ("Day strain", archive["cycles"], "start", lambda r: r["score"].get("strain")),
    ):
        cur, prv = pick(rows, tkey, fn)
        (m1, n1), (m2, n2) = mean(cur), mean(prv)
        out[name] = (m1, n1, m2, n2)
    wc = sum(1 for w in archive["workouts"] if w.get("score_state") == "SCORED" and ts(w["start"]) >= a)
    wp = sum(1 for w in archive["workouts"] if w.get("score_state") == "SCORED" and b <= ts(w["start"]) < a)
    return out, wc, wp


# Which direction is good for each metric (for the "grew" and "watch" lines).
GOOD_UP = {"Recovery": True, "HRV (ms)": True, "Resting HR": False, "Sleep hours": True,
           "Sleep performance": True, "Day strain": None}


# ---------------------------------------------------------------- early warning

def _z(today, vals):
    if len(vals) < 14:
        return None
    m = sum(vals) / len(vals)
    sd = (sum((v - m) ** 2 for v in vals) / (len(vals) - 1)) ** 0.5
    return None if sd == 0 else (today - m) / sd


def early_warning(archive, latest, sl, now):
    """Return a warning line, or None. Needs at least two signals against your own 28 day baseline."""
    cut = ts(latest["created_at"])
    base = [r for r in archive["recovery"] if r.get("score_state") == "SCORED" and r.get("score")
            and cut - timedelta(days=28) <= ts(r["created_at"]) < cut]
    sc = latest["score"]
    sig = []
    z = _z(sc["hrv_rmssd_milli"], [r["score"]["hrv_rmssd_milli"] for r in base if r["score"].get("hrv_rmssd_milli") is not None])
    if z is not None and z <= -1:
        sig.append("HRV is below your usual")
    z = _z(sc["resting_heart_rate"], [r["score"]["resting_heart_rate"] for r in base if r["score"].get("resting_heart_rate") is not None])
    if z is not None and z >= 1:
        sig.append("resting heart rate is above your usual")
    if sc.get("skin_temp_celsius") is not None:
        z = _z(sc["skin_temp_celsius"], [r["score"]["skin_temp_celsius"] for r in base if r["score"].get("skin_temp_celsius") is not None])
        if z is not None and z >= 1.5:
            sig.append("skin temperature is up")
    if sl and sl.get("score") and sl["score"].get("respiratory_rate") is not None:
        ids = {r["sleep_id"] for r in base}
        rr = [s["score"]["respiratory_rate"] for s in archive["sleep"] if s["id"] in ids and s.get("score") and s["score"].get("respiratory_rate") is not None]
        z = _z(sl["score"]["respiratory_rate"], rr)
        if z is not None and z >= 1.5:
            sig.append("breathing rate is up")
    if len(sig) >= 2:
        return ("Early warning: " + ", ".join(sig) + " this morning. That mix can mean a cold coming on, a hard "
                "training block, alcohol or short sleep. It is a flag from your own baseline, not a diagnosis.")
    return None


# ---------------------------------------------------------------- today's call (mirrors dashboard_v3/call.js)

BAND_HI, BAND_LO, LONG_H, GOAL_SLEEP = 67, 34, 36, 7.5


def _offset(s):
    try:
        sign = -1 if s[0] == "-" else 1
        return sign * (int(s[1:3]) * 3600 + int(s[4:6]) * 60)
    except (TypeError, ValueError, IndexError):
        return 0


def _local(t, off):
    """Seconds since epoch shifted to the record's own clock."""
    return ts(t).timestamp() + off


def model_days(archive):
    cyc = {c["id"]: c for c in archive.get("cycles", [])}
    rec = {r["cycle_id"]: r for r in archive.get("recovery", [])}
    mains = {}
    for sl in archive.get("sleep", []):
        sc = sl.get("score") or {}
        if sl.get("nap") or sl.get("score_state") != "SCORED" or not sc.get("stage_summary"):
            continue
        ib = sc["stage_summary"].get("total_in_bed_time_milli") or 0
        if sl["cycle_id"] not in mains or ib > mains[sl["cycle_id"]][0]:
            mains[sl["cycle_id"]] = (ib, sl)
    out = []
    for cid, (ib, sl) in mains.items():
        c = cyc.get(cid)
        if not c:
            continue
        off = _offset(sl.get("timezone_offset"))
        end_l, start_l = _local(sl["end"], off), _local(sl["start"], off)
        ss = sl["score"]["stage_summary"]
        sn = sl["score"].get("sleep_needed") or {}
        parts = [sn.get(k) for k in ("baseline_milli", "need_from_sleep_debt_milli", "need_from_recent_strain_milli", "need_from_recent_nap_milli")]
        r = rec.get(cid)
        rs = (r or {}).get("score") or {}
        cs = c.get("score") or {}
        length = (ts(c["end"]).timestamp() - ts(c["start"]).timestamp()) / 3600.0 if c.get("end") else None
        out.append({
            "di": int(end_l // 86400), "wake_h": (end_l % 86400) / 3600.0, "bed_h": (start_l % 86400) / 3600.0,
            "inbed": ib, "asleep": sleep_hours(sl) * 3600000.0,
            "need": sum(parts) / 3600000.0 if all(isinstance(x, (int, float)) for x in parts) else None,
            "recovery": rs.get("recovery_score") if r and r.get("score_state") == "SCORED" and not rs.get("user_calibrating") else None,
            "strain": cs.get("strain") if c.get("end") and cs.get("strain") is not None and (length is None or length <= LONG_H) else None,
        })
    out.sort(key=lambda d: d["di"])
    return out


def _median(xs):
    s = sorted(xs)
    n = len(s)
    return None if not n else s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def _quant(xs, q):
    s = sorted(xs)
    if not s:
        return None
    p = (len(s) - 1) * q
    lo, hi = int(p), min(int(p) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (p - lo)


def _cband(v):
    return "high" if v >= BAND_HI else "mid" if v >= BAND_LO else "low"


def call_strain_range(days, anchor, band):
    xs = [d["strain"] for d in days if d["recovery"] is not None and d["strain"] is not None
          and anchor - 89 <= d["di"] < anchor and _cband(d["recovery"]) == band]
    return (_quant(xs, 0.5), _quant(xs, 0.75), len(xs)) if len(xs) >= 8 else None


def call_bedtime(days, anchor):
    recent = [d for d in days if d["di"] >= anchor - 13]
    if len(recent) < 5:
        return None
    wake = _median([d["wake_h"] for d in recent])
    needs = [d["need"] for d in days if d["need"] is not None and d["di"] >= anchor - 6]
    need_h = sum(needs) / len(needs) if len(needs) >= 3 else GOAL_SLEEP
    asl, bed = sum(d["asleep"] for d in recent), sum(d["inbed"] for d in recent)
    ratio = min(1.0, max(0.7, asl / bed)) if bed > 0 else 0.88
    return {"wake": wake, "need_h": need_h, "ratio": ratio, "bed": wake - need_h / ratio}


def clock(h):
    t = h % 24
    hh, mm = int(t), int(round((t - int(t)) * 60))
    if mm == 60:
        hh, mm = hh + 1, 0
    ap = "pm" if hh % 24 >= 12 else "am"
    return "%d:%02d %s" % (hh % 12 or 12, mm, ap)


def _gym_data():
    """The gym archive beside this file, or None."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gym_data.json"), "r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) and d.get("sessions") else None
    except Exception:
        return None


def call_lines(archive, rec):
    try:
        days = model_days(archive)
        if not days:
            return []
        anchor = max(d["di"] for d in days)
        out = []
        sr = call_strain_range(days, anchor, _cband(rec))
        if sr and _cband(rec) != "low":
            word = {"high": "green", "mid": "yellow", "low": "red"}[_cband(rec)]
            out.append("On %s days you usually finish at strain %.1f to %.1f (%d days)." % (word, sr[0], sr[1], sr[2]))
        bt = call_bedtime(days, anchor)
        if bt:
            out.append("Tonight: be in bed by %s for about %.1f hours asleep at your usual wake time of %s." % (clock(bt["bed"]), bt["need_h"], clock(bt["wake"])))
        return out
    except Exception:
        return []


def build(archive, now=None):
    """Return (subject, body) or None if today's recovery is not scored yet."""
    now = now or datetime.now(timezone.utc)
    recs = [r for r in archive["recovery"] if r.get("score_state") == "SCORED" and r.get("score")]
    if not recs:
        return None
    latest = max(recs, key=lambda r: r["created_at"])
    sl = next((s for s in archive["sleep"] if s["id"] == latest.get("sleep_id")), None)
    # A recovery record is created when sleep starts, so "today" means the sleep ended today.
    when = ts(sl["end"]) if sl and sl.get("end") else ts(latest["created_at"])
    if when.astimezone().date() != now.astimezone().date():
        return None
    sc = latest["score"]
    rec = sc["recovery_score"]
    lines = ["Recovery %d (%s)" % (rec, band(rec)),
             "HRV %.0f ms, resting heart rate %.0f" % (sc["hrv_rmssd_milli"], sc["resting_heart_rate"])]
    if sc.get("user_calibrating"):
        lines.append("WHOOP says it is still calibrating, treat scores loosely.")
    if sl and sl.get("score"):
        s = sl["score"]
        lines.append("Last night: %.1f hours asleep, performance %s%%, efficiency %.0f%%, consistency %s%%" % (
            sleep_hours(sl), "%.0f" % s["sleep_performance_percentage"] if s.get("sleep_performance_percentage") is not None else "n/a",
            s.get("sleep_efficiency_percentage") or 0,
            "%.0f" % s["sleep_consistency_percentage"] if s.get("sleep_consistency_percentage") is not None else "n/a"))
    warn = early_warning(archive, latest, sl, now)
    if warn:
        lines += ["", warn]
    cl = call_lines(archive, rec)
    try:
        import gym as _gym
        gd = _gym_data()
        if gd:
            bnd = _cband(rec)
            gl = _gym.call_lines(gd, _gym.day_num(now.astimezone().date().isoformat()), bnd)
            cl = gl + cl
    except Exception:
        pass
    story = []
    try:
        import gym as _gym2
        gd2 = _gym_data()
        if gd2:
            _days, _wk = _flat(archive)
            story = _gym2.story_lines(gd2, _gym2.day_num(now.astimezone().date().isoformat()),
                                      [w["di"] for w in _wk if w["sport"] == "weightlifting"])
    except Exception:
        story = []
    if story:
        cl = story + cl
    if cl:
        lines += ["", "TODAY'S CALL"] + cl
    w, wc, wp = windows(archive, now)
    lines += ["", "LAST 28 DAYS vs the 28 BEFORE (averages, n = days with data)"]
    moves = []
    for k, (m1, n1, m2, n2) in w.items():
        if m1 is None or m2 is None:
            lines.append("%s: not enough data" % k)
            continue
        d = m1 - m2
        pct = (d / m2 * 100) if m2 else 0
        word = "up" if d > 0 else "down" if d < 0 else "flat"
        lines.append("%s: %.1f vs %.1f, %s %.1f (%.0f%%), n=%d and %d" % (k, m1, m2, word, abs(d), abs(pct), n1, n2))
        if GOOD_UP[k] is not None and min(n1, n2) >= 10:
            moves.append((pct if GOOD_UP[k] else -pct, k, word))
    lines.append("Workouts: %d vs %d" % (wc, wp))
    if moves:
        moves.sort()
        best, worst = moves[-1], moves[0]
        lines.append("")
        if best[0] > 2:
            lines.append("Biggest gain: %s (%s)" % (best[1], best[2]))
        if worst[0] < -2:
            lines.append("Worth watching: %s (%s)" % (worst[1], worst[2]))
    lines += ["", "These are WHOOP measured values and plain averages. Open the dashboard for charts."]
    return "WHOOP: Recovery %d, %s" % (rec, band(rec)), "\n".join(lines)


def send_daily(archive, secret_dir, log, force=False):
    cfg = load_cfg(secret_dir)
    if not cfg:
        return False
    today = datetime.now().strftime("%Y-%m-%d")
    if cfg.get("last_sent") == today and not force:
        return False
    built = build(archive)
    if not built:
        log("Email waiting: today's recovery is not scored yet")
        return False
    subject, body = built
    msg = EmailMessage()
    msg["From"] = cfg["address"]
    msg["To"] = cfg["address"]
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP_SSL(HOST, PORT, context=ssl.create_default_context(), timeout=30) as s:
            s.login(cfg["address"], cfg["app_password"])
            s.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        log("Email failed: %s" % e)
        return False
    cfg["last_sent"] = today
    save_cfg(secret_dir, cfg)
    log("Morning email sent to " + cfg["address"])
    return True


# ---------------------------------------------------------------- weekly review

def _off(s):
    if not s:
        return 0
    sign = -1 if s[0] == "-" else 1
    return sign * (int(s[1:3]) * 3600 + int(s[4:6]) * 60)


def _di(t, off):
    return int((t.timestamp() + _off(off)) // 86400)


def _flat(archive):
    """Per day rows keyed by local day index, plus workouts. Mirrors how the dashboard assigns days."""
    sl_by_id = {s["id"]: s for s in archive["sleep"] if s.get("score") and not s.get("nap")}
    sl_by_cycle = {s["cycle_id"]: s for s in sl_by_id.values()}
    days = {}

    def day(di):
        return days.setdefault(di, {})
    for r in archive["recovery"]:
        sc = r.get("score")
        if r.get("score_state") != "SCORED" or not sc:
            continue
        s = sl_by_id.get(r.get("sleep_id"))
        di = _di(ts(s["end"]), s["timezone_offset"]) if s else _di(ts(r["created_at"]), "+00:00")
        d = day(di)
        d["recovery"], d["hrv"], d["rhr"] = sc.get("recovery_score"), sc.get("hrv_rmssd_milli"), sc.get("resting_heart_rate")
    for s in sl_by_id.values():
        if s.get("score_state") != "SCORED":
            continue
        d = day(_di(ts(s["end"]), s["timezone_offset"]))
        d["asleep"] = sleep_hours(s)
        d["cons"] = s["score"].get("sleep_consistency_percentage")
    for c in archive["cycles"]:
        sc = c.get("score")
        s = sl_by_cycle.get(c["id"])
        if not sc or not c.get("end") or not s:
            continue
        d = day(_di(ts(s["end"]), s["timezone_offset"]))
        d["strain"], d["steps"] = sc.get("strain"), c.get("step_count")
    wk = []
    for w in archive["workouts"]:
        sc = w.get("score")
        if w.get("score_state") != "SCORED" or not sc:
            continue
        z = sc.get("zone_durations") or {}
        dur = (ts(w["end"]) - ts(w["start"])).total_seconds() / 60.0
        item = {"di": _di(ts(w["start"]), w["timezone_offset"]), "sport": w.get("sport_name"), "dur": dur,
                "kj": sc.get("kilojoule") or 0, "strain": sc.get("strain"), "avghr": sc.get("average_heart_rate"),
                "z2": (z.get("zone_two_milli") or 0) / 60000.0, "dist": sc.get("distance_meter")}
        if item["sport"] == "running" and item["dist"]:
            kmh = item["dist"] / 1000.0 / (dur / 60.0) if dur else 0
            if 5 <= kmh <= 25:
                miles = item["dist"] / 1609.344
                item["miles"], item["pace"] = miles, dur / miles
                item["beats"] = item["avghr"] * dur / miles if item["avghr"] else None
        wk.append(item)
    return days, wk


NONTRAIN = ("sauna", "hot_tub", "steam-room", "increase_relaxation", "stretching", "walking")


def block(days, wk, a, b, length):
    """Metrics for local day indexes a..b inclusive. length is the number of days that had data coverage."""
    def dmean(k):
        v = [d[k] for i, d in days.items() if a <= i <= b and d.get(k) is not None]
        return (sum(v) / len(v) if len(v) >= 3 else None)
    ws = [w for w in wk if a <= w["di"] <= b]
    lifts = [w for w in ws if w["sport"] == "weightlifting"]
    runs = [w for w in ws if w.get("pace")]
    per = (lambda tot: tot / length * 7.0) if length else (lambda tot: None)
    m = {
        "Recovery average": (dmean("recovery"), "up", lambda v: "%.0f%%" % v),
        "HRV average": (dmean("hrv"), "up", lambda v: "%.1f ms" % v),
        "Resting heart rate": (dmean("rhr"), "down", lambda v: "%.1f bpm" % v),
        "Hours asleep": (dmean("asleep"), "up", lambda v: "%.1f h" % v),
        "Sleep consistency": (dmean("cons"), "up", lambda v: "%.0f%%" % v),
        "Steps per day": (dmean("steps"), "up", lambda v: "{:,.0f}".format(v)),
        "Workouts per week": (per(len([w for w in ws if w["sport"] not in NONTRAIN])), "up", lambda v: "%.1f" % v),
        "Zone 2 minutes per week": (per(sum(w["z2"] for w in ws)), "up", lambda v: "%.0f min" % v),
        "Lifting sessions per week": (per(len(lifts)), "up", lambda v: "%.1f" % v),
        "Lifting minutes per week": (per(sum(w["dur"] for w in lifts)), "up", lambda v: "%.0f min" % v),
        "Lifting energy per week": (per(sum(w["kj"] for w in lifts) / 4.184), "up", lambda v: "%.0f kcal" % v),
        "Average lift strain": ((sum(w["strain"] for w in lifts if w["strain"] is not None) / len(lifts)) if lifts else None, "up", lambda v: "%.1f" % v),
        "Run distance per week": (per(sum(w["miles"] for w in runs)), "up", lambda v: "%.1f mi" % v),
        "Average run pace": ((sum(w["pace"] for w in runs) / len(runs)) if runs else None, "down",
                             lambda v: "%d:%02d per mi" % (int(v), round((v - int(v)) * 60) % 60)),
        "Heartbeats per mile": ((sum(w["beats"] for w in runs if w.get("beats")) / len([w for w in runs if w.get("beats")]))
                                if [w for w in runs if w.get("beats")] else None, "down", lambda v: "{:,.0f}".format(v)),
    }
    return m


def compare(cur, pri):
    wins, watch, flat = [], [], []
    for k, (c, better, f) in cur.items():
        p = pri[k][0]
        if c is None or p is None:
            continue
        if p == 0:
            pct = None if c == 0 else 999.0
        else:
            pct = (c - p) / abs(p) * 100.0
        if pct is not None and abs(pct) < 3:
            flat.append(k)
            continue
        if pct is None:
            continue
        good = (c > p) == (better == "up")
        if abs(pct) >= 300 and pct > 0:
            word = "about %.0f times as much" % (1 + pct / 100.0)
        else:
            word = "%s %.0f%%" % ("up" if pct > 0 else "down", abs(pct))
        line = "%s: %s to %s (%s)" % (k, f(p), f(c), word)
        (wins if good else watch).append((abs(pct), line))
    wins.sort(reverse=True)
    watch.sort(reverse=True)
    return [x[1] for x in wins], [x[1] for x in watch]


def build_weekly(archive, now=None):
    """Last full Monday to Sunday week against the week before, plus first 28 days against last 28."""
    now = now or datetime.now(timezone.utc)
    days, wk = _flat(archive)
    if not days:
        return None
    today = _di(now, "%s%02d:%02d" % ("-" if now.astimezone().utcoffset().total_seconds() < 0 else "+",
                                      abs(int(now.astimezone().utcoffset().total_seconds())) // 3600,
                                      abs(int(now.astimezone().utcoffset().total_seconds())) % 3600 // 60))
    wd = (today + 3) % 7                      # Monday = 0
    mon = today - wd
    first = min(days)
    if mon - 14 < first:
        return None                           # needs two full weeks of history
    cur = block(days, wk, mon - 7, mon - 1, 7)
    pri = block(days, wk, mon - 14, mon - 8, 7)
    wins, watch = compare(cur, pri)
    lines = ["WEEK IN REVIEW (Monday to Sunday, against the week before)", ""]
    lines += ["Where you grew:"] + (["  " + x for x in wins[:6]] or ["  Nothing moved clearly toward better."])
    lines += ["", "Where to look:"] + (["  " + x for x in watch[:4]] or ["  Nothing moved clearly the wrong way."])
    # since the start
    s0, s1 = first, today - 1
    if s1 - s0 >= 56:
        a = block(days, wk, s0, s0 + 27, 28)
        b = block(days, wk, s1 - 27, s1, 28)
        sw, sx = compare(b, a)
        lines += ["", "SINCE YOU STARTED (first 28 days of data against the last 28)", ""]
        lines += ["Where you grew:"] + (["  " + x for x in sw[:6]] or ["  Nothing moved clearly toward better."])
        lines += ["", "Where to look:"] + (["  " + x for x in sx[:3]] or ["  Nothing moved clearly the wrong way."])
    try:
        import gym as _gym
        gd = _gym_data()
        gw = _gym.weekly_lines(gd, mon - 7) if gd else []
        if gw:
            lines += ["", "STRENGTH (from your MacroFactor log)", ""] + gw
    except Exception:
        pass
    lines += ["", "Averages and totals from WHOOP records. WHOOP cannot see weight on the bar or measure metabolism,",
              "so lifting is shown as effort and volume, and energy is a WHOOP estimate. Open the dashboard Progress",
              "section for charts and personal records."]
    return mon, "WHOOP weekly review", "\n".join(lines)


def send_weekly(archive, secret_dir, log):
    cfg = load_cfg(secret_dir)
    if not cfg:
        return False
    built = build_weekly(archive)
    if not built:
        return False
    mon, subject, body = built
    if cfg.get("last_weekly") == mon:
        return False
    msg = EmailMessage()
    msg["From"] = msg["To"] = cfg["address"]
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP_SSL(HOST, PORT, context=ssl.create_default_context(), timeout=30) as sm:
            sm.login(cfg["address"], cfg["app_password"])
            sm.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        log("Weekly email failed: %s" % e)
        return False
    cfg["last_weekly"] = mon
    save_cfg(secret_dir, cfg)
    log("Weekly review emailed")
    return True


# ---------------------------------------------------------------- problem alert

ALERT_GAP_HOURS = 20


def send_alert(secret_dir, log, fails, message, code):
    """Email about a sync problem, at most once every 20 hours. Silent when email is not set up."""
    cfg = load_cfg(secret_dir)
    if not cfg:
        return False
    last = cfg.get("last_alert")
    if isinstance(last, (int, float)) and datetime.now().timestamp() - last < ALERT_GAP_HOURS * 3600:
        return False
    login = code == 3 or "login" in (message or "").lower() or "approval" in (message or "").lower()
    body = ["Your WHOOP dashboard could not refresh%s." % ("" if fails < 2 else " %d times in a row" % fails), "",
            "What happened: %s" % message, ""]
    if login:
        body += ["How to fix it: open your WhoopAnalysis folder, double click FIX_LOGIN.bat, and approve WHOOP in the browser page that opens."]
    else:
        body += ["This is often temporary (WHOOP down or no internet) and fixes itself on the next scheduled run.",
                 "If it keeps happening, double click DOCTOR.bat in your WhoopAnalysis folder and send a screenshot."]
    body += ["", "Your saved history is safe. The dashboard keeps showing your last good data."]
    msg = EmailMessage()
    msg["From"] = cfg["address"]
    msg["To"] = cfg["address"]
    msg["Subject"] = "WHOOP dashboard needs attention"
    msg.set_content("\n".join(body))
    try:
        with smtplib.SMTP_SSL(HOST, PORT, context=ssl.create_default_context(), timeout=30) as sm:
            sm.login(cfg["address"], cfg["app_password"])
            sm.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        log("Alert email failed: %s" % e)
        return False
    cfg["last_alert"] = datetime.now().timestamp()
    save_cfg(secret_dir, cfg)
    log("Problem alert email sent")
    return True
