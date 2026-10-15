"""Strava history for the WHOOP dashboard. Standard library only.

Reads the activities.csv from a Strava data export (Strava, Settings, My Account, Download or Delete Your Account, Request Your Archive),
keeps a growing archive of it (strava_data.json), and layers those activities into the workouts the dashboard reads, in memory only.
Nothing is written to whoop_data.json. A Strava activity that WHOOP also recorded (WHOOP sends its workouts to Strava) is left out so
nothing is counted twice. Only the facts the dashboard needs are kept: no activity names, descriptions, maps or contacts.
"""
import csv
import datetime
import glob
import json
import os

VERSION = 1
SPORTS = {"Run": "running", "Walk": "walking", "Hike": "hiking", "Weight Training": "weightlifting", "Yoga": "yoga",
          "Workout": "activity", "Ride": "cycling", "Virtual Ride": "cycling", "E-Bike Ride": "cycling",
          "Stair-Stepper": "stairmaster", "Rowing": "rowing"}
MONTHS = {m: i + 1 for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
REQUIRED = ("Activity ID", "Activity Date", "Activity Type")


def empty():
    return {"version": VERSION, "activities": {}, "source": {"files": []}}


def _num(v):
    try:
        x = float(str(v).strip())
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def _utc(s):
    """'Oct 12, 2026, 10:53:36 PM' (Strava writes UTC) to an ISO string, without depending on the PC's language."""
    try:
        mon, rest = s.strip().split(" ", 1)
        day, year, clock, ap = rest.replace(",", "").split()
        h, m, sec = [int(x) for x in clock.split(":")]
        h = h % 12 + (12 if ap.upper() == "PM" else 0)
        return datetime.datetime(int(year), MONTHS[mon[:3]], int(day.strip(",")), h, m, sec).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


def read_file(path):
    """Parse one Strava activities.csv. Returns {id: activity}. Raises ValueError if it is not a Strava activities file."""
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    if not rows or any(k not in rows[0] for k in REQUIRED):
        raise ValueError("not a Strava activities file")
    pos = {}
    for i, name in enumerate(rows[0]):
        pos.setdefault(name, []).append(i)

    def col(r, name, last=True):
        idx = pos.get(name, [])
        for i in (reversed(idx) if last else idx):      # Strava repeats some headings, the later one holds the exact figure
            if i < len(r) and r[i].strip() != "":
                return r[i].strip()
        return None
    out = {}
    for r in rows[1:]:
        try:
            aid, typ = col(r, "Activity ID"), col(r, "Activity Type")
            start = _utc(col(r, "Activity Date") or "")
            if not aid or not start or typ not in SPORTS:
                continue
            a = {"s": start, "t": typ}
            el, mv = _num(col(r, "Elapsed Time")), _num(col(r, "Moving Time"))
            if el:
                a["el"] = round(el)
            if mv:
                a["mv"] = round(mv)
            d = _num(col(r, "Distance"))
            if d:
                a["d"] = round(d, 1)                      # the later Distance column is in metres
            hr, mx, kc, re = _num(col(r, "Average Heart Rate")), _num(col(r, "Max Heart Rate")), _num(col(r, "Calories")), _num(col(r, "Relative Effort"))
            if hr:
                a["hr"] = round(hr)
            if mx:
                a["mx"] = round(mx)
            if kc:
                a["kc"] = round(kc)
            if re:
                a["re"] = round(re)
            g = col(r, "Activity Gear")
            if g:
                a["g"] = g
            out[aid] = a
        except Exception:
            continue
    return out


def search_dirs(here):
    home = os.path.expanduser("~")
    dirs = [os.path.join(here, "strava_exports"), os.path.join(home, "Downloads"), os.path.join(home, "Desktop")]
    drive = [os.path.join(home, "Google Drive", "WHOOP Dashboard"), os.path.join(home, "Google Drive", "My Drive", "WHOOP Dashboard")]
    if os.name == "nt":
        for L in "DEFGHIJKLMNOPQRSTUVWXYZ":
            drive += [L + ":\\My Drive\\WHOOP Dashboard", L + ":\\WHOOP Dashboard"]
    for d in drive:
        if os.path.isdir(d):
            dirs.append(d)
            dirs += glob.glob(os.path.join(d, "strava export*")) + glob.glob(os.path.join(d, "Strava export*")) + glob.glob(os.path.join(d, "*Drop Strava*"))
    return [d for d in dirs if os.path.isdir(d)]


def find_files(here):
    found = []
    for d in search_dirs(here):
        base = os.path.basename(d).lower()
        if "strava" in base or d.endswith("strava_exports"):
            found += glob.glob(os.path.join(d, "*.csv"))                       # any csv here is checked by its heading row
        else:
            found += glob.glob(os.path.join(d, "strava*.csv")) + glob.glob(os.path.join(d, "*", "activities.csv"))
        found += glob.glob(os.path.join(d, "activities.csv")) if "strava" in base else []
    seen, out = set(), []
    for p in sorted(found, key=lambda p: os.path.getmtime(p)):
        k = (os.path.basename(p), os.path.getsize(p))
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def refresh(here, archive_path, log):
    """Ingest any Strava export not yet seen. Returns the archive (or None when there is nothing). Never raises."""
    try:
        arch = None
        if os.path.exists(archive_path):
            with open(archive_path, "r", encoding="utf-8") as f:
                arch = json.load(f)
        if not isinstance(arch, dict) or "activities" not in arch:
            arch = empty()
        known = {(f.get("name"), f.get("size")) for f in arch.get("source", {}).get("files", [])}
        changed = False
        for p in find_files(here):
            label, size = os.path.basename(p), os.path.getsize(p)
            if (label, size) in known:
                continue
            try:
                part = read_file(p)
            except ValueError:
                continue                                  # some other csv (a Strava export holds dozens)
            except Exception as e:
                log("Strava export skipped (%s): %s" % (label, e))
                continue
            before = len(arch["activities"])
            arch["activities"].update(part)               # a newer export replaces the same activity and never deletes older ones
            arch["source"]["files"] = [f for f in arch["source"]["files"] if f.get("name") != label] + [{"name": label, "size": size}]
            arch["source"]["updated_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            changed = True
            log("Strava export read: %s (%d activities, %d new)" % (label, len(part), len(arch["activities"]) - before))
        if changed:
            tmp = archive_path + ".tmp"
            with open(tmp, "w", encoding="utf-8", newline="\n") as f:
                json.dump(arch, f, separators=(",", ":"), ensure_ascii=True)
            os.replace(tmp, archive_path)
        return arch if arch.get("activities") else None
    except Exception as e:
        log("Strava data skipped: %s" % e)
        return None


# ---------------------------------------------------------------- layering into the archive the dashboard reads

def central_offset(u):
    """US Central time offset for a UTC datetime, with the current daylight saving rule (second Sunday of March to first Sunday of November)."""
    y = u.year
    d = datetime.date(y, 3, 1)
    d += datetime.timedelta(days=(6 - d.weekday()) % 7 + 7)
    start = datetime.datetime(y, 3, d.day, 8)
    e = datetime.date(y, 11, 1)
    e += datetime.timedelta(days=(6 - e.weekday()) % 7)
    end = datetime.datetime(y, 11, e.day, 7)
    return "-05:00" if start <= u < end else "-06:00"


def _dt(s):
    return datetime.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")


def _iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def layer(archive, sv):
    """Return (copy of the archive with Strava activities added as workouts, number added).
    Skips any activity WHOOP also recorded (starts within 15 minutes, or overlaps by half) and Strava's own near duplicates."""
    try:
        if not sv or not sv.get("activities"):
            return archive, 0
        spans = []
        for w in archive.get("workouts", []):
            if w.get("start") and w.get("end"):
                try:
                    spans.append((_dt(w["start"]), _dt(w["end"])))
                except ValueError:
                    pass

        def seen_by_whoop(s, e):
            for a, b in spans:
                if abs((a - s).total_seconds()) <= 900:
                    return True
                ov = (min(e, b) - max(s, a)).total_seconds()
                if ov > 0 and ov >= 0.5 * min((e - s).total_seconds(), (b - a).total_seconds()):
                    return True
            return False
        items = []
        for aid, a in sv["activities"].items():
            sport = SPORTS.get(a.get("t"))
            dur = a.get("el") or a.get("mv")
            if not sport or not dur:
                continue
            s = _dt(a["s"])
            items.append((s, sport, aid, a, dur))
        items.sort(key=lambda x: x[0])
        keep = []
        for it in items:                                   # near duplicates inside Strava: same sport, starts within 10 minutes, keep the fuller one
            if keep and keep[-1][1] == it[1] and (it[0] - keep[-1][0]).total_seconds() < 600:
                if (it[3].get("d") or 0, it[4]) > (keep[-1][3].get("d") or 0, keep[-1][4]):
                    keep[-1] = it
                continue
            keep.append(it)
        add = []
        for s, sport, aid, a, dur in keep:
            e = s + datetime.timedelta(seconds=dur)
            if seen_by_whoop(s, e):
                continue
            sc = {}
            if a.get("hr"):
                sc["average_heart_rate"] = a["hr"]
            if a.get("mx"):
                sc["max_heart_rate"] = a["mx"]
            if a.get("kc"):
                sc["kilojoule"] = round(a["kc"] * 4.184, 1)
            if a.get("d") and sport in ("running", "walking", "hiking", "cycling"):
                sc["distance_meter"] = a["d"]
            row = {"id": "strava-" + str(aid), "sport_name": sport, "start": _iso(s), "end": _iso(e),
                   "timezone_offset": central_offset(s), "score_state": "SCORED", "score": sc, "src": "strava"}
            if a.get("g"):
                row["gear"] = a["g"]
            add.append(row)
        if not add:
            return archive, 0
        out = dict(archive)
        out["workouts"] = sorted(list(archive.get("workouts", [])) + add, key=lambda r: r.get("start") or "", reverse=True)
        meta = dict(archive.get("meta") or {})
        meta["strava_layer"] = {"workouts": len(add), "first": min(w["start"] for w in add)[:10]}
        out["meta"] = meta
        return out, len(add)
    except Exception:
        return archive, 0
