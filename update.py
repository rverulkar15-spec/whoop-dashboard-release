"""Self update for the WHOOP dashboard. Standard library only.

Looks at the address saved in update_source.txt, reads manifest.json there, and replaces any dashboard
file whose fingerprint (sha256) differs. Never touches your data, logins or settings. Never raises:
an update problem is logged and the normal sync carries on.
"""
import hashlib
import json
import os
import shutil
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_FILE = os.path.join(HERE, "update_source.txt")
STATE_FILE = os.path.join(HERE, ".update_state.json")
BACKUP_DIR = os.path.join(HERE, "update_backup")
CHECK_EVERY_S = 3 * 3600
ALLOWED_DIRS = ("dashboard_src", "dashboard_v3")
ALLOWED_ROOT = (".py", ".txt")                       # .bat files are never replaced while they may be running
NEVER = {"gym_data.json", "whoop_data.json", "user_entries.json", "update_source.txt", ".env"}


def source():
    try:
        with open(SOURCE_FILE, "r", encoding="utf-8") as f:
            s = f.read().strip()
    except OSError:
        return None
    if not s.lower().startswith(("https://", "http://127.0.0.1", "http://localhost")):
        return None
    return s if s.endswith("/") else s + "/"


def _state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save(st):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(st, f)
    except OSError:
        pass


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "whoop-dashboard-update", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def _sha(path):
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None


def _ok_path(p):
    if not isinstance(p, str) or not p or p.startswith(("/", "\\")) or ".." in p.replace("\\", "/").split("/") or ":" in p:
        return False
    parts = p.replace("\\", "/").split("/")
    if parts[-1] in NEVER:
        return False
    if len(parts) == 1:
        return parts[0].lower().endswith(ALLOWED_ROOT)
    return len(parts) == 2 and parts[0] in ALLOWED_DIRS


def check(log, force=False):
    """Returns the list of files replaced (possibly empty). Python files among them mean: run again."""
    try:
        base = source()
        if not base:
            return []
        st = _state()
        if not force and time.time() - st.get("checked", 0) < CHECK_EVERY_S:
            return []
        st["checked"] = time.time()
        _save(st)
        man = json.loads(_get(base + "manifest.json").decode("utf-8"))
        files, rel = man.get("files"), man.get("release")
        if not isinstance(files, dict):
            log("Update skipped: manifest not understood")
            return []
        todo = [p for p, h in sorted(files.items()) if _ok_path(p) and isinstance(h, str) and _sha(os.path.join(HERE, *p.split("/"))) != h]
        if not todo:
            st["release"] = rel
            _save(st)
            return []
        fetched = {}
        for p in todo:
            data = _get(base + p)
            if hashlib.sha256(data).hexdigest() != files[p]:
                log("Update stopped: %s did not match its fingerprint, nothing was changed" % p)
                return []
            fetched[p] = data
        bk = os.path.join(BACKUP_DIR, str(rel or int(time.time())))
        for p, data in fetched.items():
            dst = os.path.join(HERE, *p.split("/"))
            if os.path.exists(dst):
                os.makedirs(os.path.dirname(os.path.join(bk, *p.split("/"))), exist_ok=True)
                shutil.copy2(dst, os.path.join(bk, *p.split("/")))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            tmp = dst + ".new"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dst)
        st["release"], st["updated"] = rel, time.time()
        _save(st)
        log("Updated to release %s: %s" % (rel, ", ".join(sorted(fetched))))
        return sorted(fetched)
    except Exception as e:
        log("Update check skipped: %s" % e)
        return []


def describe():
    """One line for DOCTOR."""
    st = _state()
    if not source():
        return "WARN", "Self update is not switched on (no update_source.txt)"
    if not st.get("checked"):
        return "OK", "Self update is on, first check has not run yet"
    hrs = (time.time() - st["checked"]) / 3600.0
    return ("OK" if hrs < 36 else "WARN"), "Self update is on, release %s, last checked %.0f hours ago" % (st.get("release", "unknown"), hrs)
