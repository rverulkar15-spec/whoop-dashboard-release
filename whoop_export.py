"""Reads WHOOP's own data export (the csv files WHOOP emails you) and layers it into the dashboard. Standard library only.

Files it understands (header checked, so unrelated csv files are never read):
  journal_entries.csv     your daily yes/no habits (the WHOOP API does not share these)
  physiological_cycles.csv, sleeps.csv, workouts.csv   used only to fill days the API archive does not have
It also reads the zip WHOOP emails (my_whoop_data*.zip). Exports are found by themselves in: the whoop_exports
folder here, this folder, Downloads, Desktop and a Google Drive folder named WHOOP Dashboard.
Journal answers are kept in whoop_export_data.json and grow with every export. Never raises into the sync.
"""
import csv
import datetime
import glob
import io
import json
import os
import re
import zipfile

VERSION = 1
KINDS = {
    "journal_entries.csv": ("Cycle start time", "Question text"),
    "physiological_cycles.csv": ("Cycle start time", "Recovery score %"),
    "sleeps.csv": ("Cycle start time", "Nap"),
    "workouts.csv": ("Cycle start time", "Activity name"),
}
# Questions that are never read into the dashboard (personal, and not useful for recovery or training).
SKIP_QUESTIONS = {"masturbated?"}


def _hdr(row):
    return [(h or "").strip() for h in row]


def _num(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def _off(tz):
    m = re.match(r"UTC([+-])(\d\d):(\d\d)", (tz or "").strip())
    if not m:
        return 0
    s = (int(m.group(2)) * 60 + int(m.group(3)))
    return s if m.group(1) == "+" else -s


def _off_text(tz):
    o = _off(tz)
    return "%s%02d:%02d" % ("-" if o < 0 else "+", abs(o) // 60, abs(o) % 60)


def _utc(local, tz):
    """'2026-10-10 00:48:50' on a clock at tz -> '2026-10-10T05:48:50.000Z'."""
    if not local:
        return None
    try:
        d = datetime.datetime.strptime(local.strip()[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return (d - datetime.timedelta(minutes=_off(tz))).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _ms(iso):
    return int(datetime.datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def _rows(text):
    r = list(csv.reader(io.StringIO(text)))
    if not r:
        return []
    h = _hdr(r[0])
    return [dict(zip(h, [(c or "").strip() for c in row])) for row in r[1:] if any(row)]


def identify(text):
    first = text.split("\n", 1)[0]
    h = _hdr(next(csv.reader([first]), []))
    for name, need in KINDS.items():
        if all(n in h for n in need):
            if name == "physiological_cycles.csv" and "Nap" in h:
                continue
            if name == "workouts.csv" and "Question text" in h:
                continue
            return name
    return None


# ---------------------------------------------------------------- parsers to API shaped records

def _ids(start_iso):
    return re.sub(r"\D", "", start_iso)


def _stage(r):
    mn = lambda k: (_num(r.get(k)) or 0) * 60000
    return {"total_in_bed_time_milli": mn("In bed duration (min)"), "total_awake_time_milli": mn("Awake duration (min)"),
            "total_light_sleep_time_milli": mn("Light sleep duration (min)"), "total_slow_wave_sleep_time_milli": mn("Deep (SWS) duration (min)"),
            "total_rem_sleep_time_milli": mn("REM duration (min)"), "sleep_cycle_count": None, "disturbance_count": None}


def _sleep_score(r):
    need, debt = _num(r.get("Sleep need (min)")), _num(r.get("Sleep debt (min)"))
    sn = None
    if need is not None and debt is not None:
        sn = {"baseline_milli": max(0.0, need - debt) * 60000, "need_from_sleep_debt_milli": debt * 60000,
              "need_from_recent_strain_milli": 0, "need_from_recent_nap_milli": 0}
    return {"stage_summary": _stage(r), "sleep_needed": sn, "respiratory_rate": _num(r.get("Respiratory rate (rpm)")),
            "sleep_performance_percentage": _num(r.get("Sleep performance %")), "sleep_consistency_percentage": _num(r.get("Sleep consistency %")),
            "sleep_efficiency_percentage": _num(r.get("Sleep efficiency %"))}


def parse_cycles(rows):
    cyc, rec, slp = [], [], []
    for r in rows:
        tz = r.get("Cycle timezone")
        s, e = _utc(r.get("Cycle start time"), tz), _utc(r.get("Cycle end time"), tz)
        if not s:
            continue
        cid = "x" + _ids(s)
        strain = _num(r.get("Day Strain"))
        cal = _num(r.get("Energy burned (cal)"))
        cyc.append({"id": cid, "start": s, "end": e, "timezone_offset": _off_text(tz), "score_state": "SCORED" if strain is not None and e else "PENDING_SCORE",
                    "score": {"strain": strain, "kilojoule": cal * 4.184 if cal is not None else None,
                              "average_heart_rate": _num(r.get("Average HR (bpm)")), "max_heart_rate": _num(r.get("Max HR (bpm)"))}, "src": "export"})
        on, wk = _utc(r.get("Sleep onset"), tz), _utc(r.get("Wake onset"), tz)
        if on and wk:
            sid = "x-sl-" + _ids(on)
            slp.append({"id": sid, "cycle_id": cid, "nap": False, "start": on, "end": wk, "timezone_offset": _off_text(tz), "score_state": "SCORED",
                        "score": _sleep_score(r), "src": "export"})
            if _num(r.get("Recovery score %")) is not None:
                rec.append({"cycle_id": cid, "sleep_id": sid, "created_at": on, "updated_at": wk, "score_state": "SCORED",
                            "score": {"user_calibrating": False, "recovery_score": _num(r.get("Recovery score %")),
                                      "resting_heart_rate": _num(r.get("Resting heart rate (bpm)")), "hrv_rmssd_milli": _num(r.get("Heart rate variability (ms)")),
                                      "spo2_percentage": _num(r.get("Blood oxygen %")), "skin_temp_celsius": _num(r.get("Skin temp (celsius)"))}, "src": "export"})
    return cyc, rec, slp


def parse_naps(rows):
    out = []
    for r in rows:
        if (r.get("Nap") or "").lower() != "true":
            continue
        tz = r.get("Cycle timezone")
        cs, on, wk = _utc(r.get("Cycle start time"), tz), _utc(r.get("Sleep onset"), tz), _utc(r.get("Wake onset"), tz)
        if cs and on and wk:
            out.append({"id": "x-nap-" + _ids(on), "cycle_id": "x" + _ids(cs), "nap": True, "start": on, "end": wk, "timezone_offset": _off_text(tz),
                        "score_state": "SCORED", "score": _sleep_score(r), "src": "export"})
    return out


def parse_workouts(rows):
    out = []
    for r in rows:
        tz = r.get("Cycle timezone")
        s, e = _utc(r.get("Workout start time"), tz), _utc(r.get("Workout end time"), tz)
        if not s or not e:
            continue
        dur = (_ms(e) - _ms(s))
        z = [(_num(r.get("HR Zone %d %%" % k)) or 0) / 100.0 * dur for k in range(1, 6)]
        cal = _num(r.get("Energy burned (cal)"))
        name = (r.get("Activity name") or "activity").strip().lower().replace(" ", "-")
        out.append({"id": "x-w-" + _ids(s), "sport_name": name, "start": s, "end": e, "timezone_offset": _off_text(tz), "score_state": "SCORED",
                    "score": {"strain": _num(r.get("Activity Strain")), "average_heart_rate": _num(r.get("Average HR (bpm)")), "max_heart_rate": _num(r.get("Max HR (bpm)")),
                              "kilojoule": cal * 4.184 if cal is not None else None, "percent_recorded": 100,
                              "zone_durations": {"zone_zero_milli": max(0.0, dur - sum(z)), "zone_one_milli": z[0], "zone_two_milli": z[1], "zone_three_milli": z[2],
                                                 "zone_four_milli": z[3], "zone_five_milli": z[4]}}, "src": "export"})
    return out


def parse_journal(rows):
    """{ 'YYYY-MM-DD HH:MM:SS' (cycle start, local): {'o': '-05:00', 'a': {question: 1 or 0}} }"""
    out = {}
    for r in rows:
        q = (r.get("Question text") or "").strip()
        if not q or q.lower() in SKIP_QUESTIONS:
            continue
        k = (r.get("Cycle start time") or "").strip()[:19]
        if not k:
            continue
        d = out.setdefault(k, {"o": _off_text(r.get("Cycle timezone")), "a": {}})
        d["a"][q] = 1 if (r.get("Answered yes") or "").lower() == "true" else 0
    return out


# ---------------------------------------------------------------- archive and discovery

def empty():
    return {"version": VERSION, "journal": {}, "cycles": [], "recovery": [], "sleep": [], "workouts": [], "source": {"files": []}}


def _by(lst, key):
    return {r[key]: r for r in lst}


def merge(arch, parts, label, size, mtime):
    for k, v in (parts.get("journal") or {}).items():
        arch["journal"].setdefault(k, {"o": v["o"], "a": {}})["a"].update(v["a"])
    for kind, key in (("cycles", "id"), ("recovery", "cycle_id"), ("sleep", "id"), ("workouts", "id")):
        d = _by(arch.get(kind) or [], key)
        d.update(_by(parts.get(kind) or [], key))
        arch[kind] = sorted(d.values(), key=lambda r: r.get("start") or r.get("created_at") or "")
    src = arch.setdefault("source", {"files": []})
    src["files"] = [f for f in src["files"] if f.get("name") != label] + [{"name": label, "size": size, "mtime": int(mtime)}]
    src["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return arch


def search_dirs(here):
    home = os.path.expanduser("~")
    dirs = [os.path.join(here, "whoop_exports"), here, os.path.join(home, "Downloads"), os.path.join(home, "Desktop"),
            os.path.join(home, "Google Drive", "WHOOP Dashboard"), os.path.join(home, "Google Drive", "My Drive", "WHOOP Dashboard")]
    if os.name == "nt":
        for L in "DEFGHIJKLMNOPQRSTUVWXYZ":
            dirs += [L + ":\\My Drive\\WHOOP Dashboard", L + ":\\WHOOP Dashboard"]
    return [d for d in dirs if os.path.isdir(d)]


def find_files(here):
    """[(label, path, kind-or-None for zip)] newest last."""
    found = []
    for d in search_dirs(here):
        for name in KINDS:
            p = os.path.join(d, name)
            if os.path.isfile(p):
                found.append(p)
        found += glob.glob(os.path.join(d, "my_whoop_data*.zip"))
    seen, out = set(), []
    for p in sorted(found, key=lambda p: os.path.getmtime(p)):
        k = (os.path.basename(p), os.path.getsize(p))
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def _parse_text(kind, text):
    rows = _rows(text)
    if kind == "journal_entries.csv":
        return {"journal": parse_journal(rows)}
    if kind == "physiological_cycles.csv":
        c, r, s = parse_cycles(rows)
        return {"cycles": c, "recovery": r, "sleep": s}
    if kind == "sleeps.csv":
        return {"sleep": parse_naps(rows)}
    if kind == "workouts.csv":
        return {"workouts": parse_workouts(rows)}
    return {}


def read_file(path):
    """-> parts dict. Handles a csv or the emailed zip."""
    parts = {}

    def add(p):
        for k, v in p.items():
            if isinstance(v, dict):
                parts.setdefault(k, {}).update(v)
            else:
                parts.setdefault(k, []).extend(v)
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.lower().endswith(".csv"):
                    text = z.read(n).decode("utf-8-sig", "replace")
                    kind = identify(text)
                    if kind:
                        add(_parse_text(kind, text))
    else:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            text = f.read()
        kind = identify(text)
        if not kind:
            raise ValueError("not a WHOOP export file: " + os.path.basename(path))
        add(_parse_text(kind, text))
    return parts


def refresh(here, archive_path, log):
    """Ingest any export not yet seen. Returns the export archive (or None). Never raises."""
    try:
        arch = None
        if os.path.exists(archive_path):
            with open(archive_path, "r", encoding="utf-8") as f:
                arch = json.load(f)
        if not isinstance(arch, dict) or "journal" not in arch:
            arch = empty()
        known = {(f.get("name"), f.get("size")) for f in arch.get("source", {}).get("files", [])}
        changed = False
        for p in find_files(here):
            label = os.path.basename(p)
            if (label, os.path.getsize(p)) in known:
                continue
            try:
                parts = read_file(p)
                before = len(arch["journal"])
                merge(arch, parts, label, os.path.getsize(p), os.path.getmtime(p))
                changed = True
                log("WHOOP export read: %s (%d journal days, %d new)" % (label, len(parts.get("journal") or {}), len(arch["journal"]) - before))
            except Exception as e:
                log("WHOOP export skipped (%s): %s" % (label, e))
        if changed:
            tmp = archive_path + ".tmp"
            with open(tmp, "w", encoding="utf-8", newline="\n") as f:
                json.dump(arch, f, separators=(",", ":"), ensure_ascii=True)
            os.replace(tmp, archive_path)
        return arch if (arch.get("journal") or arch.get("cycles")) else None
    except Exception as e:
        log("WHOOP export data skipped: %s" % e)
        return None


# ---------------------------------------------------------------- layering into the archive the dashboard reads

def _span(rec, default_h=24):
    s = _ms(rec["start"])
    e = _ms(rec["end"]) if rec.get("end") else s + default_h * 3600000
    return s, max(e, s + 1)


def layer(archive, ex):
    """Return a copy of the API archive with export records added ONLY for cycles the API archive does not cover.
    Nothing is written to whoop_data.json. Safe to call on every build."""
    try:
        if not ex or not ex.get("cycles"):
            return archive, 0
        api = [c for c in archive.get("cycles", []) if c.get("start") and not str(c.get("id", "")).startswith("x")]
        spans = [_span(c) for c in api]

        def covered(s, e):
            for a, b in spans:
                ov = min(e, b) - max(s, a)
                if ov > 0 and ov / float(min(e - s, b - a)) > 0.25:
                    return True
            return False
        add_ids = set()
        add_c = []
        for c in ex["cycles"]:
            s, e = _span(c)
            if not covered(s, e):
                add_ids.add(c["id"])
                add_c.append(c)
        if not add_c:
            return archive, 0
        out = dict(archive)
        out["cycles"] = sorted(list(archive.get("cycles", [])) + add_c, key=lambda r: r.get("start") or "", reverse=True)
        out["recovery"] = sorted(list(archive.get("recovery", [])) + [r for r in ex["recovery"] if r["cycle_id"] in add_ids], key=lambda r: r.get("created_at") or "", reverse=True)
        out["sleep"] = sorted(list(archive.get("sleep", [])) + [s for s in ex["sleep"] if s["cycle_id"] in add_ids], key=lambda r: r.get("start") or "", reverse=True)
        api_w = [(_ms(w["start"])) for w in archive.get("workouts", []) if w.get("start")]
        new_w = [w for w in ex["workouts"] if not any(abs(_ms(w["start"]) - t) < 120000 for t in api_w)
                 and any(_span(c)[0] <= _ms(w["start"]) < _span(c)[1] for c in add_c)]
        out["workouts"] = sorted(list(archive.get("workouts", [])) + new_w, key=lambda r: r.get("start") or "", reverse=True)
        meta = dict(archive.get("meta") or {})
        meta["export_layer"] = {"cycles": len(add_c), "workouts": len(new_w)}
        out["meta"] = meta
        return out, len(add_c)
    except Exception:
        return archive, 0


def page_data(ex):
    """The slim journal block the page needs."""
    if not ex or not ex.get("journal"):
        return None
    return {"rows": [{"k": k, "o": v["o"], "a": v["a"]} for k, v in sorted(ex["journal"].items())],
            "through": max(ex["journal"]) if ex["journal"] else None}
