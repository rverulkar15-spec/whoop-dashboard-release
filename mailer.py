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
    """Return {metric: (last28 mean, n, prior28 mean, n)} by local day, the same days the dashboard uses.
    The last window ends on the newest day that has a recovery score."""
    days, wk = _flat(archive)
    rec_days = [i for i, d in days.items() if d.get("recovery") is not None]
    if not rec_days:
        return {}, 0, 0
    A = max(rec_days)

    def span(k, a, b):
        v = [d[k] for i, d in days.items() if a <= i <= b and d.get(k) is not None]
        return (sum(v) / len(v) if v else None), len(v)
    out = {}
    for name, k in (("Recovery", "recovery"), ("HRV (ms)", "hrv"), ("Resting HR", "rhr"), ("Sleep hours", "asleep"),
                    ("Sleep performance", "perf"), ("Day strain", "strain")):
        (m1, n1), (m2, n2) = span(k, A - 27, A), span(k, A - 55, A - 28)
        out[name] = (m1, n1, m2, n2)
    train = [w for w in wk if w["sport"] not in NONTRAIN]      # same rule as the dashboard: no walks, sauna or stretching
    wc = sum(1 for w in train if A - 27 <= w["di"] <= A)
    wp = sum(1 for w in train if A - 55 <= w["di"] <= A - 28)
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
    strong = []
    z = _z(sc["hrv_rmssd_milli"], [r["score"]["hrv_rmssd_milli"] for r in base if r["score"].get("hrv_rmssd_milli") is not None])
    if z is not None and z <= -1:
        sig.append("HRV is below your usual")
        if z <= -2:
            strong.append(1)
    z = _z(sc["resting_heart_rate"], [r["score"]["resting_heart_rate"] for r in base if r["score"].get("resting_heart_rate") is not None])
    if z is not None and z >= 1:
        sig.append("resting heart rate is above your usual")
        if z >= 2:
            strong.append(1)
    if sc.get("skin_temp_celsius") is not None:
        z = _z(sc["skin_temp_celsius"], [r["score"]["skin_temp_celsius"] for r in base if r["score"].get("skin_temp_celsius") is not None])
        if z is not None and z >= 1.5:
            sig.append("skin temperature is up")
            if z >= 2:
                strong.append(1)
    if sl and sl.get("score") and sl["score"].get("respiratory_rate") is not None:
        ids = {r["sleep_id"] for r in base}
        rr = [s["score"]["respiratory_rate"] for s in archive["sleep"] if s["id"] in ids and s.get("score") and s["score"].get("respiratory_rate") is not None]
        z = _z(sl["score"]["respiratory_rate"], rr)
        if z is not None and z >= 1.5:
            sig.append("breathing rate is up")
            if z >= 2:
                strong.append(1)
    if len(sig) >= 2 or strong:
        return ("Early warning: " + ", ".join(sig) + " this morning. That can mean a cold coming on, a hard "
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
            "hrv": rs.get("hrv_rmssd_milli") if r and r.get("score_state") == "SCORED" and not rs.get("user_calibrating") else None,
            "rhr": rs.get("resting_heart_rate") if r and r.get("score_state") == "SCORED" and not rs.get("user_calibrating") else None,
            "strain": cs.get("strain") if c.get("end") and cs.get("strain") is not None and (length is None or length <= LONG_H) else None,
        })
    out.sort(key=lambda d: d["di"])
    return out


def _dlabel(di):
    d = datetime.fromtimestamp(di * 86400, timezone.utc)
    return "%s %d" % (d.strftime("%b"), d.day)


def notable_lines(days):
    """Records in your own 7 day averages. Same rule as the dashboard card Notable lately."""
    if not days:
        return []
    first, last = days[0]["di"], days[-1]["di"]
    if last - first < 42:
        return []
    defs = [("hrv", "HRV", True, "%.0f ms", 1.0), ("rhr", "resting heart rate", False, "%.0f bpm", 1.0),
            ("recovery", "recovery", True, "%.0f%%", 1.0), ("asleep", "hours asleep", True, "%.1f h", 1.0 / 3600000.0)]
    out = []
    for key, name, up, fmt, scale in defs:
        series = []
        for di in range(first + 6, last + 1):
            vals = [d[key] for d in days if di - 6 <= d["di"] <= di and isinstance(d.get(key), (int, float))]
            if len(vals) >= 5:
                series.append((di, sum(vals) / len(vals)))
        if len(series) < 35:
            continue
        cur, hist = series[-1], series[:-1]
        better = (lambda a, b: a > b) if up else (lambda a, b: a < b)
        if all(better(cur[1], h[1]) for h in hist):
            out.append("Your 7 day %s average, %s, is the best on file." % (name, fmt % (cur[1] * scale)))
            continue
        prev = next((h for h in reversed(hist) if not better(cur[1], h[1])), None)
        if prev and last - prev[0] >= 21 and better(cur[1], hist[-1][1]):
            out.append("Your 7 day %s average, %s, is the best in %d days." % (name, fmt % (cur[1] * scale), last - prev[0]))
        if all((not better(cur[1], h[1])) and cur[1] != h[1] for h in hist):
            out.append("Your 7 day %s average, %s, is the worst on file. Worth easing off and sleeping more." % (name, fmt % (cur[1] * scale)))
    return out[:3]


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
    try:
        nl = notable_lines(model_days(archive))
    except Exception:
        nl = []
    if nl:
        lines += ["", "NOTABLE LATELY"] + nl
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
    lines.append("Workouts (not counting walks, sauna or stretching): %d vs %d" % (wc, wp))
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
        d["perf"] = s["score"].get("sleep_performance_percentage")
    for c in archive["cycles"]:
        sc = c.get("score")
        s = sl_by_cycle.get(c["id"])
        if not sc or not c.get("end") or not s:
            continue
        if (ts(c["end"]) - ts(c["start"])).total_seconds() / 3600.0 > LONG_H:
            continue                      # the dashboard leaves out cycles longer than 36 hours
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


def _fit(xs, ys):
    """Least squares slope and correlation for paired lists, or None when there is too little to trust."""
    n = len(xs)
    if n < 30:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = sum((x - mx) ** 2 for x in xs)
    sy = sum((y - my) ** 2 for y in ys)
    if sx <= 0 or sy <= 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / sx, sxy / (sx * sy) ** 0.5, n


def _avg(v):
    v = [x for x in v if x is not None]
    return sum(v) / len(v) if len(v) >= 3 else None


def run_line(wk, mon):
    """A cautious weekly mileage ceiling from all runs on file (WHOOP plus any Strava history). A rule of thumb, not a prescription."""
    runs = [w for w in wk if w["sport"] == "running" and w.get("miles")]
    if len(runs) < 5:
        return None
    wsum = {}
    for r in runs:
        wsum[(r["di"] - mon) // 7] = wsum.get((r["di"] - mon) // 7, 0.0) + r["miles"]       # key -1 is last week
    full = {k: v for k, v in wsum.items() if k <= -1}
    last, avg4 = full.get(-1, 0.0), sum(full.get(k, 0.0) for k in (-1, -2, -3, -4)) / 4.0
    peak = max(full.values()) if full else 0.0
    gap = mon - max(r["di"] for r in runs if r["di"] < mon) if any(r["di"] < mon for r in runs) else None
    if gap is None:
        return None
    if gap >= 21:
        recent = [full[k] for k in sorted(full, reverse=True) if full[k] > 0][:4]
        base = sum(recent) / len(recent) if recent else 0.0
        ceil = min(base * 0.5, peak)
        return "Running: %d days since your last run, so ease back in. Keep the week near %.0f miles (about half of what you were running before), easy effort." % (gap, ceil) if ceil >= 1 else None
    ref = last if last > 0 else avg4
    ceil = min(ref * 1.1, peak) if peak else ref * 1.1
    if ceil < 1:
        return None
    return "Running: last week %.1f miles, 4 week average %.1f, best week %.1f. A cautious ceiling for this week is about %.0f miles (last week plus 10%%, a rule of thumb, not a proven limit)." % (last, avg4, peak, ceil)


def coach_lines(days, wk, mon, arch):
    """A short coach note for the week that just ended: a verdict, the one thing that mattered most, next week's plan.
    Everything comes from your own records. Patterns are associations from your own days, never proof of cause."""
    try:
        w0, w1 = mon - 7, mon - 1
        base0, base1 = mon - 35, mon - 8
        wr = lambda k, a, b: [days[i].get(k) for i in range(a, b + 1) if i in days]
        rec_w, rec_b = _avg(wr("recovery", w0, w1)), _avg(wr("recovery", base0, base1))
        if rec_w is None or rec_b is None:
            return []
        lifts = lambda a, b: len({w["di"] for w in wk if a <= w["di"] <= b and w["sport"] == "weightlifting"})
        lw, lb = lifts(w0, w1), lifts(base0, base1) / 4.0
        green = len([1 for r in wr("recovery", w0, w1) if r is not None and r >= 67])
        scored = len([1 for r in wr("recovery", w0, w1) if r is not None])
        d = rec_w - rec_b
        if d >= 4 and lw >= lb - 0.5:
            head = "Strong week"
        elif d <= -5:
            head = "Tough week for recovery"
        elif lw >= lb + 1 and d > -5:
            head = "Big training week"
        elif lw <= lb - 1.5:
            head = "Light training week"
        else:
            head = "Steady week"
        out = ["COACH REPORT", "", "%s. Recovery averaged %.0f%% (your 4 week norm is %.0f%%), %d of %d scored days were green, and you lifted %d time%s (norm %.1f a week)." % (
            head, rec_w, rec_b, green, scored, lw, "" if lw == 1 else "s", lb)]
        # the one thing that mattered: each factor's recovery effect in your own data times how far the week moved from your norm
        hist0 = mon - 70
        rows = [i for i in range(hist0, mon - 1) if i in days and days[i].get("recovery") is not None]
        fac = {}
        xs = [(days[i].get("asleep"), days[i]["recovery"]) for i in rows if days[i].get("asleep") is not None]
        f = _fit([a for a, _ in xs], [b for _, b in xs])
        if f:
            fac["sleep"] = (f, _avg(wr("asleep", w0, w1)), _avg(wr("asleep", base0, base1)))
        xs = [(days[i - 1].get("strain"), days[i]["recovery"]) for i in rows if (i - 1) in days and days[i - 1].get("strain") is not None]
        f = _fit([a for a, _ in xs], [b for _, b in xs])
        if f:
            fac["strain"] = (f, _avg([days[i - 1].get("strain") for i in range(w0, w1 + 1) if (i - 1) in days]),
                             _avg([days[i - 1].get("strain") for i in range(base0, base1 + 1) if (i - 1) in days]))
        best = None
        for k, (fit, cur, ref) in fac.items():
            slope, r, n = fit
            if cur is None or ref is None or abs(r) < 0.25:
                continue
            eff = slope * (cur - ref)
            if best is None or abs(eff) > abs(best[1]):
                best = (k, eff, slope, r, n, cur, ref)
        out += ["", "The one thing that mattered most:"]
        if best and abs(best[1]) >= 1.5:
            k, eff, slope, r, n, cur, ref = best
            if k == "sleep":
                out.append("  Sleep. You averaged %.1f hours against your usual %.1f. In your last %d days each extra hour went with about %+.0f recovery points (correlation %.2f), so this shift is worth roughly %+.0f points." % (cur, ref, n, slope, r, eff))
            else:
                out.append("  The strain you carried in. Prior day strain averaged %.1f against your usual %.1f. In your last %d days each extra strain point went with about %+.1f recovery points the next morning (correlation %.2f), so this shift is worth roughly %+.0f points." % (cur, ref, n, slope, r, eff))
            out.append("  This is a pattern in your own days, not proof of cause.")
        else:
            wk_rows = [(i, days[i]["recovery"]) for i in range(w0, w1 + 1) if i in days and days[i].get("recovery") is not None]
            if len(wk_rows) >= 4:
                lo = min(wk_rows, key=lambda x: x[1])
                dd = days[lo[0]]
                bits = []
                if dd.get("asleep") is not None:
                    bits.append("%.1f hours asleep" % dd["asleep"])
                if (lo[0] - 1) in days and days[lo[0] - 1].get("strain") is not None:
                    bits.append("strain %.1f the day before" % days[lo[0] - 1]["strain"])
                out.append("  No single habit stood out this week. Your lowest recovery was %.0f%% on %s%s." % (lo[1], _dname(lo[0]), (" (" + ", ".join(bits) + ")") if bits else ""))
            else:
                out.append("  Not enough scored days this week to name one thing.")
        # the week ahead
        plan = []
        gr = [days[i]["asleep"] for i in rows if days[i]["recovery"] >= 67 and days[i].get("asleep") is not None]
        if len(gr) >= 5:
            gr.sort()
            plan.append("Sleep: aim for about %.1f hours. That is the middle of the nights before your green days (%d of them)." % (gr[len(gr) // 2], len(gr)))
        try:
            import gym as _g
            pl = _g.Plan(arch) if arch else None
            if pl and pl.ok and pl.prog:
                items = []
                for di in range(mon, mon + 7):
                    a = pl.at(di)
                    if a and not a.get("over") and not a["day"].get("rest"):
                        items.append("%s %s" % (_g.day_text(di).split(" ")[0], _g.day_focus(a["day"])))
                if items:
                    plan.append("Lifting: " + "; ".join(items) + ".")
        except Exception:
            pass
        if not any(p.startswith("Lifting") for p in plan) and lb >= 1:
            plan.append("Lifting: about %d sessions, matching your 4 week norm of %.1f." % (round(lb), lb))
        after_l = [days[i]["recovery"] for i in rows if (i - 1) in days and any(w["di"] == i - 1 and w["sport"] == "weightlifting" for w in wk)]
        after_r = [days[i]["recovery"] for i in rows if (i - 1) in days and not any(w["di"] == i - 1 and w["sport"] == "weightlifting" for w in wk)]
        if len(after_l) >= 8 and len(after_r) >= 8:
            al, ar = sum(after_l) / len(after_l), sum(after_r) / len(after_r)
            if ar - al >= 4:
                plan.append("Spacing: recovery averages %.0f%% the morning after lifting against %.0f%% after other days (%d and %d days), so put your hardest session before a day you can take easy." % (al, ar, len(after_l), len(after_r)))
        z_w = sum(w["z2"] for w in wk if w0 <= w["di"] <= w1)
        z_b = sum(w["z2"] for w in wk if base0 <= w["di"] <= base1) / 4.0
        if z_b > 0 or z_w > 0:
            tgt = max(z_b, z_w) * 1.1
            plan.append("Easy cardio: %.0f minutes in zone 2 (last week %.0f, 4 week norm %.0f), a 10%% step up." % (tgt, z_w, z_b))
        try:
            rl = run_line(wk, mon)
            if rl:
                plan.append(rl)
        except Exception:
            pass
        out += ["", "The week ahead:"] + ["  " + p for p in plan[:5]] if plan else []
        return out + [""]
    except Exception:
        return []


_DN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _dname(di):
    return _DN[(di + 3) % 7]


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
    lines = coach_lines(days, wk, mon, _gym_data()) + ["WEEK IN REVIEW (Monday to Sunday, against the week before)", ""]
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
    return mon, "WHOOP weekly coach report", "\n".join(lines)


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
