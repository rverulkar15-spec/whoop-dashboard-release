"""Gym log reader for the WHOOP dashboard. Standard library only.

Reads a MacroFactor Workouts export (.xlsx or .csv) and keeps a growing archive in gym_data.json:
  sessions   one entry per workout day: sets, weights, reps, reps in reserve, duration
  muscles    sets per muscle group per day (MacroFactor's own muscle credit, including indirect work)
  program    the active program plan, cycle by cycle (rep ranges and reps in reserve per set)

New exports are merged by date, so older history stays even if a later export covers fewer weeks.
Exports are found automatically: the gym_exports folder, this folder, and your Downloads and Desktop
folders (only files named MacroFactor*.xlsx there). Nothing is typed by hand.
"""
import datetime
import glob
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "pr": "http://schemas.openxmlformats.org/package/2006/relationships"}
VERSION = 1


# ---------------------------------------------------------------- xlsx reader (no third party code)

def _col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_xlsx(path):
    """Return {sheet name: [row lists]} with numbers as float and text as str. Empty cells are None."""
    out = {}
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = {r.get("Id"): r.get("Target") for r in rels.findall("pr:Relationship", NS)}
        for sh in wb.find("m:sheets", NS).findall("m:sheet", NS):
            rid = sh.get("{%s}id" % NS["r"])
            t = target[rid].lstrip("/")
            name_in_zip = t if t.startswith("xl/") else "xl/" + t
            root = ET.fromstring(z.read(name_in_zip))
            rows = []
            for row in root.iter("{%s}row" % NS["m"]):
                cells = {}
                for c in row.findall("m:c", NS):
                    v = c.find("m:v", NS)
                    typ = c.get("t")
                    if typ == "inlineStr":
                        val = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
                    elif v is None or v.text is None:
                        val = None
                    elif typ == "s":
                        val = shared[int(v.text)]
                    elif typ in ("str", "e"):
                        val = v.text
                    elif typ == "b":
                        val = v.text == "1"
                    else:
                        try:
                            val = float(v.text)
                        except ValueError:
                            val = v.text
                    cells[_col(c.get("r"))] = val
                if cells:
                    width = max(cells) + 1
                    rows.append([cells.get(i) for i in range(width)])
                else:
                    rows.append([])
            out[sh.get("name")] = rows
    return out


def _date(v):
    """Excel serial number or ISO text to YYYY-MM-DD."""
    if isinstance(v, (int, float)):
        return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))).isoformat()
    if isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}", v):
        return v[:10]
    return None


def _num(v):
    if isinstance(v, (int, float)):
        return round(float(v), 4)
    return None


# ---------------------------------------------------------------- sheet parsers

def parse_log(rows):
    """Workout Log sheet to {date: session}."""
    if not rows:
        return {}
    hdr = rows[0]
    ix = {h: i for i, h in enumerate(hdr) if h}

    def g(r, name):
        i = ix.get(name)
        return r[i] if i is not None and i < len(r) else None
    sessions = {}
    for r in rows[1:]:
        d = _date(g(r, "Date"))
        ex = g(r, "Exercise")
        if not d or not ex:
            continue
        wname = g(r, "Workout") or ""
        m = re.match(r"(.*?)(?:\s*\(Workout\s*([A-Za-z0-9]+)\))?\s*$", wname)
        program, letter = (m.group(1).strip(), m.group(2)) if m else (wname, None)
        key = d + "|" + (letter or wname)
        s = sessions.setdefault(key, {"date": d, "workout": letter, "name": wname, "program": program,
                                      "duration_s": _num(g(r, "Workout Duration")), "sets": []})
        t = g(r, "Set Type") or ""
        s["sets"].append({
            "ex": ex, "base": _num(g(r, "Exercise Base Weight (lb)")),
            "type": "Drop Set" if t == "Drop" else t,
            "w": _perhand(ex, _num(g(r, "Weight (lb)"))), "reps": _num(g(r, "Reps")), "rir": _num(g(r, "RIR")),
            "dur": _num(g(r, "Duration")), "yd": _num(g(r, "Distance short (Yd)")), "mi": _num(g(r, "Distance long (Mi)"))})
    return sessions


def parse_muscles(rows):
    """Muscle Groups sheet to {date: {muscle: value}}. Header cells look like 'Chest (sets)' or 'Chest (lb)'."""
    out = {}
    if not rows:
        return out
    names = [re.sub(r"\s*\((sets|lb)\)\s*$", "", h) if isinstance(h, str) else None for h in rows[0]]
    for r in rows[1:]:
        d = _date(r[0] if r else None)
        if not d:
            continue
        vals = {}
        for i, n in enumerate(names):
            if i == 0 or not n or i >= len(r):
                continue
            v = _num(r[i])
            if v:
                vals[n] = v
        out[d] = vals
    return out


def parse_program(rows):
    """Active Program sheet to a plan: cycles, each with 7 day slots (rest or a workout with exercises and set targets)."""
    prog = {"name": None, "cycles": 0, "deload": None, "plan": []}
    if not rows:
        return prog
    for cell in rows[0]:
        if isinstance(cell, str):
            if cell.startswith("Program:"):
                prog["name"] = cell.split(":", 1)[1].strip()
            elif cell.startswith("Cycles:"):
                try:
                    prog["cycles"] = int(cell.split(":", 1)[1])
                except ValueError:
                    pass
            elif cell.startswith("Deload:"):
                prog["deload"] = cell.split(":", 1)[1].strip()
    cycle = day = None
    for r in rows[1:]:
        if not r or all(x is None for x in r):
            continue
        a = r[0] if len(r) > 0 else None
        b = r[1] if len(r) > 1 else None
        if isinstance(a, str) and re.match(r"Cycle\s+\d+$", a):
            cycle = {"cycle": int(a.split()[1]), "days": []}
            prog["plan"].append(cycle)
            day = None
            continue
        if cycle is None:
            continue
        if a == "Rest":
            day = {"rest": True}
            cycle["days"].append(day)
            continue
        if isinstance(a, str) and a.startswith("Workout"):
            m = re.match(r"Workout\s+(\S+)(?:\s*@\s*(.*))?$", a)
            day = {"rest": False, "workout": m.group(1) if m else a, "gym": (m.group(2) or "").strip() if m else "", "exercises": []}
            cycle["days"].append(day)
        if day is None or day.get("rest") or not isinstance(b, str):
            continue
        sets = []
        for k in range(5):
            base = 4 + 4 * k
            typ = r[base] if len(r) > base else None
            if not typ:
                continue
            rr = r[base + 1] if len(r) > base + 1 else None
            rir = r[base + 2] if len(r) > base + 2 else None
            sets.append({"type": typ, "reps": rr if isinstance(rr, str) else (str(int(rr)) if isinstance(rr, float) else None),
                         "rir": _num(rir)})
        day["exercises"].append({"name": b, "skipped": (r[2] if len(r) > 2 else None) == "Yes",
                                 "notes": r[3] if len(r) > 3 and isinstance(r[3], str) else None, "sets": sets})
    return prog


HIST_SHEETS = (("Exercises - 1-RM", 0), ("Exercises - Heaviest Weight", 1), ("Exercises - Total Sets", 2),
               ("Exercises - Total Volume", 3))


def parse_history(sheets):
    """The all-data export carries per exercise history by day: estimated 1RM, heaviest weight, sets, volume.
    Returns {exercise: {date: [e1rm, top weight, sets, volume]}}. Personal profile sheets are never read."""
    out = {}
    for sheet, slot in HIST_SHEETS:
        rows = sheets.get(sheet)
        if not rows:
            continue
        names = [re.sub(r"\s*\((lb|reps|sets)\)\s*$", "", h) if isinstance(h, str) else None for h in rows[0]]
        for r in rows[1:]:
            d = _date(r[0] if r else None)
            if not d:
                continue
            for i, n in enumerate(names):
                if i == 0 or not n or i >= len(r):
                    continue
                v = _num(r[i])
                if v is None:
                    continue
                rec = out.setdefault(n, {}).setdefault(d, [None, None, None, None])
                rec[slot] = round(v, 1)
    return out


def parse_body(sheets):
    """Scale weight, MacroFactor's trend weight and daily steps from the all-data export. Other body sheets are not read."""
    out = {}
    for key, sheet in (("trend", "Weight Trend"), ("scale", "Scale Weight"), ("steps", "Steps")):
        rows = sheets.get(sheet)
        if not rows:
            continue
        col = 1
        vals = {}
        for r in rows[1:]:
            d = _date(r[0] if r else None)
            v = _num(r[col]) if r and len(r) > col else None
            if d and v is not None:
                vals[d] = round(v, 2) if key != "steps" else int(round(v))
        if vals:
            out[key] = vals
    return out


def read_csv(path):
    """A MacroFactor workout log saved as csv: {sheet name: rows}, numbers as float."""
    import csv
    rows = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.reader(f):
            out = []
            for v in r:
                if v == "":
                    out.append(None)
                    continue
                try:
                    out.append(float(v))
                except ValueError:
                    out.append(v)
            rows.append(out)
    return {"Workout Log": rows}


def parse_export(path):
    sheets = read_csv(path) if path.lower().endswith(".csv") else read_xlsx(path)
    sess = parse_log(sheets.get("Workout Log"))
    hist = parse_history(sheets)
    if not sess and not hist and not parse_body(sheets):
        raise ValueError("not a MacroFactor workout export: " + os.path.basename(path))
    return {
        "sessions": sess,
        "muscles": parse_muscles(sheets.get("Muscle Groups - Sets")),
        "muscle_volume": parse_muscles(sheets.get("Muscle Groups - Volume")),
        "program": parse_program(sheets.get("Active Program")),
        "history": hist,
        "body": parse_body(sheets),
    }


# ---------------------------------------------------------------- archive and discovery

def empty():
    return {"version": VERSION, "sessions": [], "muscles": {}, "muscle_volume": {}, "program": {}, "history": {}, "body": {}, "source": {"files": []}}


def export_date(fname, mtime):
    """Day the export was made: MacroFactor puts it in the file name (MacroFactor-20261012163054), else the file time."""
    m = re.search(r"(20\d\d)(\d\d)(\d\d)\d{4,6}", fname)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            pass
    return datetime.date.fromtimestamp(mtime).isoformat()


def merge(arch, new, fname, mtime, size):
    """Fold one parsed export into the archive. A date in the new export replaces that date's old data."""
    sess = {s["date"] + "|" + (s.get("workout") or s.get("name") or ""): s for s in arch.get("sessions", [])}
    new_dates = {s["date"] for s in new["sessions"].values()}
    sess = {k: v for k, v in sess.items() if v["date"] not in new_dates}
    sess.update(new["sessions"])
    hist = arch.setdefault("history", {})
    for ex, days in (new.get("history") or {}).items():
        cur = hist.setdefault(ex, {})
        cur.update(days)
    arch["sessions"] = sorted(sess.values(), key=lambda s: (s["date"], s.get("workout") or ""))
    for k in ("muscles", "muscle_volume"):
        cur = dict(arch.get(k) or {})
        cur.update(new[k])
        arch[k] = dict(sorted(cur.items()))
    if new.get("body"):
        body = arch.setdefault("body", {})
        for k, v in new["body"].items():
            body.setdefault(k, {}).update(v)
    if new["program"] and new["program"].get("plan"):
        arch["program"] = new["program"]
    src = arch.setdefault("source", {"files": []})
    src["files"] = [f for f in src.get("files", []) if f.get("name") != fname] + [{"name": fname, "mtime": int(mtime), "size": size}]
    src["exported_on"] = max([export_date(f["name"], f.get("mtime", 0)) for f in src["files"]])
    src["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return arch


def _perhand(ex, w):
    """The MacroFactor export lists dumbbell weight as both hands together. The dashboard shows it per hand."""
    return round(w / 2.0, 4) if (w is not None and "dumbbell" in ex.lower()) else w


def find_exports(here):
    home = os.path.expanduser("~")
    found = []
    for pat in (os.path.join(here, "gym_exports", "*.xlsx"),
                os.path.join(here, "gym_exports", "*.csv"),
                os.path.join(here, "MacroFactor*.xlsx"),
                os.path.join(here, "MacroFactor*.csv"),
                os.path.join(home, "Downloads", "MacroFactor*.xlsx"),
                os.path.join(home, "Downloads", "MacroFactor*.csv"),
                os.path.join(home, "Desktop", "MacroFactor*.xlsx"),
                os.path.join(home, "Desktop", "MacroFactor*.csv")):
        found += glob.glob(pat)
    # a Google Drive for desktop folder, if one is mounted on this computer
    drive = [os.path.join(home, "Google Drive", "WHOOP Dashboard"), os.path.join(home, "Google Drive", "My Drive", "WHOOP Dashboard")]
    if os.name == "nt":
        for L in "DEFGHIJKLMNOPQRSTUVWXYZ":
            drive += [L + ":\\My Drive\\WHOOP Dashboard", L + ":\\WHOOP Dashboard"]
    for d in list(drive):                # the drop off folder inside the Drive folder takes any export name
        for dd in glob.glob(os.path.join(d, "1 Drop MacroFactor*")):
            found += glob.glob(os.path.join(dd, "*.xlsx")) + glob.glob(os.path.join(dd, "*.csv"))
    for d in drive:
        if os.path.isdir(d):
            found += glob.glob(os.path.join(d, "MacroFactor*.xlsx")) + glob.glob(os.path.join(d, "MacroFactor*.csv"))
    seen, out = set(), []
    for p in sorted(found, key=lambda p: os.path.getmtime(p)):
        if os.path.basename(p).startswith("~$"):
            continue
        k = (os.path.basename(p), os.path.getsize(p))
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


# ---------------------------------------------------------------- workout logs typed from screenshots
# Going forward each workout arrives as one small JSON file (made from a MacroFactor screenshot) dropped in
# the Drive folder "4 Drop workout logs here", or in a gym_logs folder next to this file. The format is
# documented in WORKOUT_LOG_FORMAT.txt. An export that covers the same date always wins over a log.

LOG_TYPES = {"warmup": "Warm-Up Set", "warm-up": "Warm-Up Set", "warm up": "Warm-Up Set", "warm-up set": "Warm-Up Set",
             "standard": "Standard Set", "standard set": "Standard Set", "working": "Standard Set", "normal": "Standard Set",
             "drop": "Drop Set", "drop set": "Drop Set", "failure": "Failure Set", "failure set": "Failure Set",
             "myo": "Myo Set", "myo set": "Myo Set", "myo-rep": "Myo Set", "mini": "Mini-set", "mini set": "Mini-set", "mini-set": "Mini-set"}
# the letter or number MacroFactor puts in the circle beside each set
SET_LABELS = {"w": "Warm-Up Set", "f": "Failure Set", "d": "Drop Set"}


def find_logs(here):
    home = os.path.expanduser("~")
    roots = [os.path.join(here, "gym_logs")]
    drive = [os.path.join(home, "Google Drive", "WHOOP Dashboard"), os.path.join(home, "Google Drive", "My Drive", "WHOOP Dashboard")]
    if os.name == "nt":
        for L in "DEFGHIJKLMNOPQRSTUVWXYZ":
            drive += [L + ":\\My Drive\\WHOOP Dashboard", L + ":\\WHOOP Dashboard"]
    for d in drive:
        roots += glob.glob(os.path.join(d, "4 Drop workout*"))
    found = []
    for r in roots:
        found += glob.glob(os.path.join(r, "*.json"))
    seen, out = set(), []
    for p in sorted(found, key=lambda p: (os.path.getmtime(p), p)):
        k = (os.path.basename(p), os.path.getsize(p))
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


def _set_type(st, ex):
    """Set type from a type name, or from the circle label MacroFactor shows (W, F, D or a set number)."""
    for key in ("type", "set"):
        v = st.get(key)
        if v is None or str(v).strip() == "":
            continue
        t = str(v).strip()
        low = t.lower()
        if low in LOG_TYPES:
            return LOG_TYPES[low]
        if low in SET_LABELS:
            return SET_LABELS[low]
        if re.fullmatch(r"\d+", low):
            return "Standard Set"
        if key == "type" and t in ("Warm-Up Set", "Standard Set", "Drop Set", "Failure Set", "Myo Set", "Mini-set"):
            return t
        raise ValueError("unknown set label %r for %s" % (t, ex))
    return "Standard Set"


def _reps(st, ex):
    """Effective reps as MacroFactor counts them: full reps plus a third of a rep per partial. Accepts 10, "10" or "10+4P"."""
    v = st.get("reps")
    part = st.get("partials")
    if isinstance(v, str):
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:\+\s*(\d+)\s*P)?\s*", v, re.I)
        if not m:
            raise ValueError("cannot read reps %r for %s" % (v, ex))
        full, part = float(m.group(1)), (int(m.group(2)) if m.group(2) else part)
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        full = float(v)
    else:
        return None, 0
    p = int(part) if isinstance(part, (int, float)) and not isinstance(part, bool) and part > 0 else 0
    return round(full + p / 3.0, 4), p


def parse_log_file(path):
    """One workout log file to a list of sessions in the same shape the export reader makes. Raises ValueError with a plain reason.
    Dumbbell weights are stored per hand, exactly as shown on screen (never doubled)."""
    with open(path, "r", encoding="utf-8-sig") as f:
        raw = json.load(f)
    items = raw.get("sessions") if isinstance(raw, dict) and isinstance(raw.get("sessions"), list) else [raw]
    out = []
    for it in items:
        if not isinstance(it, dict):
            raise ValueError("not a workout log")
        d = _date(it.get("date"))
        if not d:
            raise ValueError("missing or bad date (need YYYY-MM-DD)")
        sets = []
        for st in it.get("sets") or []:
            ex = (st.get("ex") or "").strip() if isinstance(st, dict) else ""
            if not ex:
                raise ValueError("a set has no exercise name")
            t = _set_type(st, ex)
            w = _num(st.get("w"))
            reps, p = _reps(st, ex)
            if w is not None and not (0 <= w <= 1500):
                raise ValueError("weight %s for %s is not believable" % (w, ex))
            if reps is not None and not (0 <= reps <= 500):
                raise ValueError("reps %s for %s is not believable" % (reps, ex))
            row = {"ex": ex, "base": _num(st.get("base")), "type": t, "w": w, "reps": reps, "rir": _num(st.get("rir")),
                   "dur": _num(st.get("dur")), "yd": _num(st.get("yd")), "mi": _num(st.get("mi"))}
            if p:
                row["pr"] = p
            sets.append(row)
        if not sets:
            raise ValueError("no sets in the log for " + d)
        name = it.get("name") or ""
        letter = it.get("workout")
        m = re.match(r"(.*?)(?:\s*\(Workout\s*([A-Za-z0-9]+)\))?\s*$", name)
        program = it.get("program") or (m.group(1).strip() if m else name)
        if not letter and m and m.group(2):
            letter = m.group(2)
        mus = it.get("muscles") if isinstance(it.get("muscles"), dict) else None
        out.append({"date": d, "workout": letter, "name": name, "program": program, "duration_s": _num(it.get("duration_s")),
                    "sets": sets, "src": "log", "muscles": mus, "replace": bool(it.get("replace"))})
    return out


def infer_letter(arch, sess):
    """The program workout whose exercises best match the logged ones, or None when it is not clear."""
    plan = (arch.get("program") or {}).get("plan")
    if not plan:
        return None
    names = {x["ex"] for x in sess["sets"]}
    best, top = [], 0
    for d in plan[0]["days"]:
        if d.get("rest"):
            continue
        n = len(names & {e["name"] for e in d.get("exercises", [])})
        if n > top:
            best, top = [d["workout"]], n
        elif n == top and n > 0:
            best.append(d["workout"])
    return best[0] if top >= 1 and len(best) == 1 and top * 2 >= len(names) else None


def merge_log(arch, sessions, fname, mtime, size):
    """Fold log sessions into the archive. Returns (added, skipped_dates).
    A date already held from an export is kept as is. A second file for the same workout adds its exercises to the first
    (an exercise in both is replaced by the newer file), unless it says "replace": true."""
    cur = arch.get("sessions", [])
    added, skipped = 0, []
    for s in sessions:
        same = [x for x in cur if x["date"] == s["date"]]
        if any(x.get("src") != "log" for x in same):
            skipped.append(s["date"])
            continue
        if not s.get("workout"):
            s["workout"] = infer_letter(arch, s)
            if not s["workout"] and len(same) == 1:
                s["workout"] = same[0].get("workout")
            if s["workout"] and not s.get("name"):
                pn = s.get("program") or (arch.get("program") or {}).get("name") or ""
                s["name"] = pn or "Gym session"
                s["program"] = s.get("program") or pn
        old = [x for x in same if x.get("workout") == s.get("workout")]
        mus = s.pop("muscles", None)
        rep = s.pop("replace", False)
        if old and not rep:
            o = old[0]
            have = {x["ex"] for x in s["sets"]}
            o["sets"] = [x for x in o["sets"] if x["ex"] not in have] + s["sets"]
            for k in ("duration_s", "name", "program"):
                if s.get(k):
                    o[k] = s[k]
        else:
            cur = [x for x in cur if x not in old]
            cur.append(s)
        if mus and s["date"] not in (arch.get("muscles") or {}):
            arch.setdefault("muscles", {})[s["date"]] = {k: v for k, v in mus.items() if isinstance(v, (int, float))}
        added += 1
    arch["sessions"] = sorted(cur, key=lambda s: (s["date"], s.get("workout") or ""))
    src = arch.setdefault("source", {"files": []})
    src["files"] = [f for f in src.get("files", []) if f.get("name") != fname] + [{"name": fname, "mtime": int(mtime), "size": size, "log": True}]
    src["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if added:                        # the log now reaches at least to the newest logged workout
        src["exported_on"] = max([x for x in (src.get("exported_on"), max(s["date"] for s in sessions)) if x])
    return added, skipped


def refresh(here, archive_path, log):
    """Ingest any export not yet seen. Returns the archive dict, or None when there is no gym data at all.
    Never raises: a bad export is logged and skipped."""
    try:
        arch = None
        if os.path.exists(archive_path):
            with open(archive_path, "r", encoding="utf-8") as f:
                arch = json.load(f)
        if not isinstance(arch, dict) or "sessions" not in arch:
            arch = empty()
        known = {(f.get("name"), f.get("size")) for f in arch.get("source", {}).get("files", [])}
        changed = False
        for p in find_exports(here):
            key = (os.path.basename(p), os.path.getsize(p))
            if key in known:
                continue
            try:
                new = parse_export(p)
                n_new = sum(1 for s in new["sessions"].values() if s["date"] not in {x["date"] for x in arch["sessions"]})
                merge(arch, new, os.path.basename(p), os.path.getmtime(p), os.path.getsize(p))
                changed = True
                log("Gym export read: %s (%d sessions in file, %d new days)" % (os.path.basename(p), len(new["sessions"]), n_new))
            except Exception as e:      # a bad file must never stop the sync
                log("Gym export skipped (%s): %s" % (os.path.basename(p), e))
        for p in find_logs(here):
            key = (os.path.basename(p), os.path.getsize(p))
            if key in known:
                continue
            try:
                sess = parse_log_file(p)
                added, skipped = merge_log(arch, sess, os.path.basename(p), os.path.getmtime(p), os.path.getsize(p))
                changed = True
                log("Workout log read: %s (%d session%s added%s)" % (os.path.basename(p), added, "" if added == 1 else "s",
                    ", kept the export's version for " + ", ".join(skipped) if skipped else ""))
            except Exception as e:      # a bad log must never stop the sync
                log("Workout log skipped (%s): %s" % (os.path.basename(p), e))
        if changed:
            tmp = archive_path + ".tmp"
            with open(tmp, "w", encoding="utf-8", newline="\n") as f:
                json.dump(arch, f, separators=(",", ":"), ensure_ascii=True)
            os.replace(tmp, archive_path)
        return arch if arch.get("sessions") else None
    except Exception as e:
        log("Gym data skipped: %s" % e)
        return None


# ---------------------------------------------------------------- program plan and lines for the emails
# This mirrors dashboard_v3/gym.js so the morning email and the dashboard say the same thing.
# Days are whole day numbers since 1970-01-01, the same as the mailer uses.

import math
import statistics

_EPOCH = datetime.date(1970, 1, 1)
_WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_BW = re.compile(r"(chin|pull)[- ]?up|(^|\s)dips?(\s|$)", re.I)


# What a workout trains, read from its exercises (never a letter). Mirrors gFocus in dashboard_v3/gym.js.
_GF_RULES = [
    ("quad", r"squat|leg press|leg extension|hack|lunge|split squat"),
    ("ham", r"romanian|deadlift|hamstring|hip hinge|glute ham|hip thrust|good morning|back extension|abduction|adduction"),
    ("calf", r"calf"),
    ("core", r"crunch|ab wheel|plank|leg raise|sit-?up"),
    ("shoulder", r"overhead press|lateral raise|rear delt|face pull|shoulder press|upright row|reverse (pec|fly)"),
    ("triceps", r"tricep|pushdown|skull|dip\b|kickback|overhead extension"),
    ("biceps", r"curl"),
    ("back", r"row|pulldown|pull-?down|chin|pull-?up|pullover|lat\b|shrug"),
    ("chest", r"bench|chest|pec|fly|incline|decline|push-?up|press"),
]
_GF_RULES = [(k, re.compile(v, re.I)) for k, v in _GF_RULES]
_GF_BIG = re.compile(r"squat|leg press|romanian|deadlift|hip thrust|bench|overhead press|(^|\s)row|chin|pull-?up|incline.*press|dip\b", re.I)
_GF_NAME = {"chest": "chest", "back": "back", "shoulder": "shoulders", "biceps": "biceps", "triceps": "triceps"}


def focus(names):
    """Plain words for what a workout trains, e.g. 'legs, quad focused'."""
    c, first = {}, {}
    for i, n in enumerate(names or []):
        k = next((k for k, r in _GF_RULES if r.search(n)), None)
        if k:
            c[k] = c.get(k, 0) + (2 if _GF_BIG.search(n) else 1)
            first.setdefault(k, i)
    leg = sum(c.get(k, 0) for k in ("quad", "ham", "calf"))
    up_k = ("chest", "back", "shoulder", "biceps", "triceps")
    up = sum(c.get(k, 0) for k in up_k)
    if not leg and not up:
        return "full body"
    if leg >= up + 2 or (leg > up and leg >= 4):
        q, h = c.get("quad", 0), c.get("ham", 0)
        return "legs, " + ("quad focused" if q > h else "hamstring and glute focused" if h > q else "quads and hamstrings")
    t = [_GF_NAME[k] for k in sorted([k for k in up_k if c.get(k)], key=lambda k: (-c[k], first[k]))[:3]]
    if not t:
        return "full body"
    lab = t[0] if len(t) == 1 else ", ".join(t[:-1]) + " and " + t[-1]
    return "upper body, " + lab + (" with some legs" if leg >= 2 else "")


def day_focus(day):
    return focus([e["name"] for e in day.get("exercises", []) if not e.get("skipped")])


def day_num(iso):
    return (datetime.date.fromisoformat(iso[:10]) - _EPOCH).days


def day_text(di):
    d = _EPOCH + datetime.timedelta(days=di)
    return "%s %s %d" % (_WD[d.weekday()], _MON[d.month - 1], d.day)


def _rnd(x):
    return math.floor(x + 0.5)


class Plan:
    def __init__(self, arch):
        self.ok = False
        self.prog = None
        sess = sorted(arch.get("sessions") or [], key=lambda s: (s["date"], s.get("workout") or ""))
        if not sess:
            return
        self.sessions = [dict(s, di=day_num(s["date"])) for s in sess]
        self.by = {}
        for s in self.sessions:
            self.by.setdefault(s["di"], []).append(s)
        days = set(self.by)
        self.hist = {}
        for ex, d in (arch.get("history") or {}).items():
            self.hist[ex] = {day_num(k): v for k, v in d.items()}
            days |= set(self.hist[ex])
        self.days = days
        self.last = max(days)
        ed = (arch.get("source") or {}).get("exported_on")
        self.export_di = day_num(ed) if ed else self.last
        bws = []
        for s in self.sessions:
            by = {}
            for x in s["sets"]:
                if x["type"] != "Warm-Up Set" and _BW.search(x["ex"]) and x.get("w") is not None:
                    by[x["ex"]] = max(by.get(x["ex"], -1), x["w"])
            for ex, added in by.items():
                pt = self.hist.get(ex, {}).get(s["di"])
                if pt and pt[1] is not None:
                    bws.append(pt[1] - added)
        self.bw = 0
        if len(bws) >= 2:
            m = statistics.median(bws)
            if 60 <= m <= 400:
                self.bw = m
        P = arch.get("program") or {}
        if P.get("plan"):
            mine = [s for s in self.sessions if s.get("workout") and (not s.get("program") or not P.get("name") or s["program"] == P["name"])]
            if mine:
                f = mine[0]
                k = next((i for i, d in enumerate(P["plan"][0]["days"]) if not d.get("rest") and d.get("workout") == f["workout"]), -1)
                if k >= 0:
                    start = f["di"] - k
                    ok = 0
                    for s in mine:
                        c, sl = (s["di"] - start) // 7, (s["di"] - start) % 7
                        pl = P["plan"][c]["days"][sl] if 0 <= c < len(P["plan"]) and sl < len(P["plan"][c]["days"]) else None
                        if pl and not pl.get("rest") and pl.get("workout") == s["workout"]:
                            ok += 1
                    if ok / len(mine) >= 0.7:
                        self.prog = {"name": P.get("name") or "Your program", "cycles": P.get("cycles") or len(P["plan"]),
                                     "deload": P.get("deload") or "", "plan": P["plan"], "start": start}
        self.ok = True
        # strength series for the weekly note
        self.E = {}                      # per lift: (day, heaviest weight actually lifted, reps at that weight or None)
        for ex, d in self.hist.items():
            bwl = bool(_BW.search(ex))
            for k, v in d.items():
                t = v[1]
                if t is None:
                    continue
                if bwl:
                    if not self.bw:
                        continue
                    t = t - self.bw
                if t > 0:
                    self.E.setdefault(ex, []).append((k, round(t, 1), None))
        for s in self.sessions:
            by = {}
            for x in s["sets"]:
                if x["type"] != "Warm-Up Set":
                    by.setdefault(x["ex"], []).append(x)
            for ex, xs in by.items():
                ws = [x for x in xs if x.get("w") is not None and x.get("reps") is not None and x["reps"] >= 1]
                if ws and max(x["w"] for x in ws) > 0:
                    top = max(x["w"] for x in ws)
                    reps = int(max(x["reps"] for x in ws if x["w"] == top))
                    old = [p for p in self.E.get(ex, []) if p[0] == s["di"]]
                    if old:                  # the logged sets are exact; the history figure only fills days with no sets
                        self.E[ex].remove(old[0])
                    self.E.setdefault(ex, []).append((s["di"], top, reps))
        self.prs = []
        for ex in self.E:
            self.E[ex].sort(key=lambda p: p[0])
            mx, mr = 0, 0
            for i, (di, v, r) in enumerate(self.E[ex]):
                r = r or 0
                if i >= 2 and (v > mx or (v == mx and r > mr)):
                    self.prs.append((di, ex, v, r))
                if v > mx:
                    mx, mr = v, r
                elif v == mx and r > mr:
                    mr = r
        self.prs.sort()

    def e1(self, ex, s):
        w, r = s.get("w"), s.get("reps")
        if w is None or r is None or r < 1:
            return None
        k = r + (s["rir"] if s.get("rir") is not None else 0)
        if k > 15:
            return None
        load = w + (self.bw if self.bw and _BW.search(ex) else 0)
        return load * (1 + k / 30.0) if load > 0 else None

    def at(self, di):
        p = self.prog
        if not p or di < p["start"]:
            return None
        c = (di - p["start"]) // 7
        if c >= len(p["plan"]):
            return {"over": True, "cycle": c + 1}
        sl = (di - p["start"]) % 7
        days = p["plan"][c]["days"]
        return {"cycle": c + 1, "slot": sl, "day": days[sl]} if sl < len(days) else None

    def status(self, di, today):
        a = self.at(di)
        if not a or a.get("over") or a["day"].get("rest"):
            return None
        has = lambda d: any(s.get("workout") == a["day"]["workout"] for s in self.by.get(d, []))
        if has(di):
            return "done"
        for d in range(di - a["slot"], di - a["slot"] + 7):
            if has(d):
                return "shifted"
        if di == today:
            return "today"
        if di > today or di > self.export_di:
            return "upcoming"
        return "missed"

    def next(self, frm, today):
        for d in range(frm, frm + 21):
            a = self.at(d)
            if not a:
                continue
            if a.get("over"):
                return None
            if a["day"].get("rest"):
                continue
            st = self.status(d, today)
            if st in ("today", "upcoming"):
                return dict(a, st=st, di=d)
        return None

    def cycle_text(self, a):
        p = self.prog
        return "cycle %d of %d%s" % (a["cycle"], p["cycles"], ", the deload week" if a["cycle"] == p["cycles"] and re.search("last", p["deload"], re.I) else "")

    def last_sets(self, ex, before):
        for s in reversed(self.sessions):
            if s["di"] >= before:
                continue
            w = [x for x in s["sets"] if x["ex"] == ex and x["type"] != "Warm-Up Set"]
            if w:
                return w
        return None

    def first_try(self, day, di):
        """Suggested load for the first set of the first exercise: (name, text or None)."""
        e = next((x for x in day["exercises"] if not x.get("skipped")), None)
        if not e or not e["sets"]:
            return None
        s0 = e["sets"][0]
        m = re.match(r"^(\d+)(?:-(\d+)|(\+))?$", re.sub(r"\s+", "", str(s0.get("reps") or "")))
        last = self.last_sets(e["name"], di)
        if not m or not last:
            return (e["name"], None)
        lo, hi = int(m.group(1)), (int(m.group(2)) if m.group(2) else None)
        tr = _rnd((lo + hi) / 2.0) if hi is not None else lo
        fail = s0["type"] == "Failure Set"
        rir = 0 if fail else (s0["rir"] if s0.get("rir") is not None else 0)
        best = max([self.e1(e["name"], x) or 0 for x in last] + [0])
        if not best:
            return (e["name"], None)
        w = best / (1 + (tr + rir) / 30.0)
        if self.bw and _BW.search(e["name"]):
            w -= self.bw
        w = max(0, _rnd(w / 2.5) * 2.5)
        return (e["name"], ("%.1f" if w % 1 else "%.0f") % w + " lb")


def call_lines(arch, today, band, lifted=False):
    """Plain text lifting lines for the morning email. today is a day number. Same logic as gymCallLines in gym.js."""
    try:
        pl = Plan(arch)
        if not pl.ok or not pl.prog:
            return []
        a = pl.at(today)
        if not a:
            return []
        out = []
        if a.get("over"):
            return ["Your %s program has run all %d cycles. Start the next block in MacroFactor and export again to bring the plan here." % (pl.prog["name"], pl.prog["cycles"])]
        if a["day"].get("rest"):
            nx = pl.next(today + 1, today)
            out.append("Rest day in your program (%s)." % pl.cycle_text(a) + (" Next up: %s on %s." % (day_focus(nx["day"]), day_text(nx["di"])) if nx else "") +
                       (" Green morning, so zone 2 or a run fits well." if band == "high" else ""))
        else:
            st = pl.status(today, today)
            L = day_focus(a["day"])
            if st == "done" or lifted:
                out.append("Your %s workout is done for today. Keep the rest of the day easy." % L)
            else:
                ft = pl.first_try(a["day"], today)
                opens = (" It opens with %s%s." % (ft[0], ", try about %s for the first set" % ft[1] if ft[1] else "")) if ft else ""
                if band == "high":
                    out.append("Today is %s (%s). Green light: go as planned and push the top sets.%s" % (L, pl.cycle_text(a), opens))
                elif band == "mid":
                    out.append("Today is %s (%s). Train it as planned and leave a rep or two in reserve on the failure sets.%s" % (L, pl.cycle_text(a), opens))
                else:
                    out.append("Today is %s, but recovery is low. Either move it back a day, or do it lighter: about 10 percent off the weights and every set stopped 3 reps short of failure." % L)
        for d in range(today - 1, today - 4, -1):
            if pl.status(d, today) == "missed":
                out.append("Your %s workout from %s is not in your MacroFactor log." % (day_focus(pl.at(d)["day"]), day_text(d)))
                break
        return out
    except Exception:
        return []


def weekly_lines(arch, mon):
    """Strength note for the week that started on day number mon (a Monday)."""
    try:
        pl = Plan(arch)
        if not pl.ok:
            return []
        out = []
        if pl.prog:
            planned = done = 0
            cyc = None
            for d in range(mon, mon + 7):
                st = pl.status(d, mon + 7)
                a = pl.at(d)
                if a and not a.get("over"):
                    cyc = cyc or a
                if st:
                    planned += 1
                    done += st in ("done", "shifted")
            if planned:
                out.append("Program workouts: %d of %d done%s." % (done, planned, " (%s)" % pl.cycle_text(cyc) if cyc else ""))
        prs = [p for p in pl.prs if mon <= p[0] < mon + 7]
        if prs:
            out.append("New bests: " + "; ".join("%s %.0f lb%s" % (p[1], p[2], " x %d" % p[3] if p[3] else "") for p in prs[:5]) + ".")
        if pl.export_di < mon + 6:
            out.append("The gym log was last exported %s, so this week may be incomplete." % day_text(pl.export_di))
        return out
    except Exception:
        return []


# ---------------------------------------------------------------- the story line (mirrors stSegment and stStrip in dashboard_v3/story.js)

STORY_GAP = 14


def story_attempts(days, today):
    """Runs of lifting days split by more than STORY_GAP idle days. Returns (attempts, ongoing)."""
    att = []
    for di in sorted(set(days)):
        if att and di - att[-1]["end"] <= STORY_GAP:
            att[-1]["end"] = di
            att[-1]["days"].append(di)
        else:
            att.append({"start": di, "end": di, "days": [di]})
    if not att:
        return att, False
    ongoing = today - att[-1]["end"] <= STORY_GAP
    for i, a in enumerate(att):
        a["i"] = i + 1
        a["weeks"] = (a["end"] - a["start"]) // 7 + 1
    return att, ongoing


def _wk(n):
    return "%d %s" % (n, "week" if n == 1 else "weeks")


def story_strip(att, ongoing, today):
    if not att:
        return ""
    n, cur = len(att), att[-1]
    if ongoing:
        prior = max([0] + [a["weeks"] for a in att[:-1]])
        t = "Week %d of %s" % (cur["weeks"], "your first run" if n == 1 else "attempt %d" % n)
        if n > 1:
            t += (", your longest yet" if cur["weeks"] > prior else ", level with your longest" if cur["weeks"] == prior
                  else ", your longest was %d weeks" % prior)
        return t + "."
    d = today - cur["end"]
    return "%d %s since your last lift. Attempt %d held %s." % (d, "day" if d == 1 else "days", n, _wk(cur["weeks"]))


def story_lines(arch, today, extra_days=()):
    """One or two lines for the emails: where the current run stands. extra_days are WHOOP weightlifting days."""
    try:
        days = {day_num(s["date"]) for s in (arch.get("sessions") or [])} | set(extra_days)
        if len(days) < 3:
            return []
        att, ongoing = story_attempts(days, today)
        out = [story_strip(att, ongoing, today)]
        if ongoing and len(att) > 1:
            out.append("You have stopped %d %s before and come back each time." % (len(att) - 1, "time" if len(att) == 2 else "times"))
        return out
    except Exception:
        return []
