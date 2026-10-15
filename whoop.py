#!/usr/bin/env python3
"""WHOOP sync and dashboard builder, version 2.1. Standard library only.

What one run does:
  1. Refreshes your WHOOP login token (first run only: one browser approval).
  2. Pulls profile, body, recovery, cycles, sleep and workouts.
  3. Merges them into whoop_data.json by record id (newest updated_at wins),
     so your history is an archive that only grows.
  4. Rebuilds whoop_dashboard.html with the data embedded.

Usage:
  py whoop.py --setup              store client id and secret in .env (once)
  py whoop.py --auth               force the browser approval flow again
  py whoop.py                      sync and rebuild
  py whoop.py --open               sync, rebuild, open the dashboard
  py whoop.py --build-only         rebuild from the archive, no network
  py whoop.py --install-schedule   Windows: run automatically several times a day
  py whoop.py --uninstall-schedule
  py whoop.py --status             show the last sync result
  py whoop.py --doctor             check that everything is set up and healthy
  py whoop.py --full               pull all history instead of the quick recent pull
Other flags: --quiet --fresh --no-build

Credentials come from the environment (WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET)
or from a .env file next to this script. Nothing is stored in this file.
"""
import argparse
import getpass
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
try:
    import gym
except Exception:               # the gym module is optional; the WHOOP dashboard never depends on it
    gym = None
try:
    import whoop_export
except Exception:               # WHOOP export reading is optional
    whoop_export = None
try:
    import strava
except Exception:               # Strava history is optional
    strava = None
try:
    import update as selfupdate
except Exception:           # self update is optional
    selfupdate = None
from datetime import datetime, timedelta, timezone

VERSION = "2.1"
HERE = os.path.dirname(os.path.abspath(__file__))
SELF = os.path.abspath(__file__)


def P(name):
    return os.path.join(HERE, name)


FILES = {
    "archive": P("whoop_data.json"),
    "prev": P("whoop_data.prev.json"),
    "tokens": P("whoop_tokens.json"),
    "env": P(".env"),
    "dash": P("whoop_dashboard.html"),
    "classic": P("whoop_classic.html"),
    "entries": P("user_entries.json"),
    "log": P("sync.log"),
    "lock": P(".sync.lock"),
    "status": P("sync_status.json"),
    "backups": P("backups"),
    "gym": P("gym_data.json"),
    "export": P("whoop_export_data.json"),
    "strava": P("strava_data.json"),
}

# Credentials and login tokens live OUTSIDE this folder, so a cloud synced folder (Google Drive,
# OneDrive) never uploads them. Override with the WHOOP_SECRET_DIR environment variable.
SECRET_DIR = os.environ.get("WHOOP_SECRET_DIR") or (
    os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "WhoopDashboard")
    if os.name == "nt" else os.path.expanduser("~/.whoop_dashboard"))
FILES["tokens"] = os.path.join(SECRET_DIR, "whoop_tokens.json")
FILES["env"] = os.path.join(SECRET_DIR, ".env")


def migrate_secrets():
    """Copy secrets from the old in folder location once. The old copies are left for you to delete."""
    for key, name in (("tokens", "whoop_tokens.json"), ("env", ".env")):
        old = P(name)
        if os.path.exists(old) and not os.path.exists(FILES[key]):
            os.makedirs(SECRET_DIR, exist_ok=True)
            with open(old, "rb") as src, open(FILES[key], "wb") as dst:
                dst.write(src.read())
            try:
                os.chmod(FILES[key], 0o600)
            except OSError:
                pass
            log("Copied %s to %s. Delete the old copy in the data folder." % (name, SECRET_DIR))


AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
BASE = "https://api.prod.whoop.com/developer"
REDIRECT = os.environ.get("WHOOP_REDIRECT", "https://localhost:8080/callback")
SCOPES = ("offline read:recovery read:cycles read:sleep "
          "read:workout read:profile read:body_measurement")
UA = "whoop-dashboard/" + VERSION
ENDPOINTS = {
    "recovery": "/v2/recovery",
    "cycles": "/v2/cycle",
    "sleep": "/v2/activity/sleep",
    "workouts": "/v2/activity/workout",
}
KEYS = {"recovery": "cycle_id", "cycles": "id", "sleep": "id", "workouts": "id"}
SORT = {"recovery": "created_at", "cycles": "start", "sleep": "start", "workouts": "start"}
INCR_DAYS = 14              # a quick sync re-reads this many recent days (scores can still change)
FULL_EVERY_DAYS = 7         # and a full history pull runs at least this often
BACKUP_EVERY_DAYS = 7
BACKUPS_KEEP = 8
RECORD_CAP = 50000          # per record type; reaching it is an error, never a silent cut
PAGE_PAUSE = 0.3            # seconds between pages, stays well under WHOOP rate limits

QUIET = False


class SyncError(Exception):
    def __init__(self, message, code=4):
        Exception.__init__(self, message)
        self.code = code


class ApiError(SyncError):
    def __init__(self, http_code, body):
        SyncError.__init__(self, "WHOOP returned HTTP %s: %s" % (http_code, body), 4)
        self.http_code = http_code


# ---------------------------------------------------------------- utilities

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg):
    line = "%s %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    if not QUIET and sys.stdout:
        try:
            print(line)
        except Exception:
            pass
    try:
        if os.path.exists(FILES["log"]) and os.path.getsize(FILES["log"]) > 1000000:
            with open(FILES["log"], "r", encoding="utf-8", errors="replace") as f:
                tail = f.read()[-200000:]
            with open(FILES["log"], "w", encoding="utf-8") as f:
                f.write(tail)
        with open(FILES["log"], "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def write_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except ValueError as e:
        raise SyncError("%s is not valid JSON (%s)" % (os.path.basename(path), e), 5)


def interactive():
    try:
        return bool(sys.stdin and sys.stdin.isatty())
    except Exception:
        return False


# ---------------------------------------------------------------- credentials

def read_env():
    out = {}
    try:
        with open(FILES["env"], "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def clean_cred(v):
    """Drop spaces, quotes and invisible control characters that sneak in when pasting."""
    return "".join(ch for ch in (v or "") if ch.isprintable() and not ch.isspace()).strip("\"'")


def setup_credentials():
    print("Paste the Client ID and Client Secret from your WHOOP developer dashboard.")
    print("They are saved outside the data folder, in " + SECRET_DIR + ".")
    cid = clean_cred(input("Client ID: "))
    print("The secret is shown as you paste it, so you can check it. Right click pastes in this window.")
    sec = clean_cred(input("Client Secret: "))
    if not cid or not sec:
        raise SyncError("Both values are required.", 2)
    write_atomic(FILES["env"], "WHOOP_CLIENT_ID=%s\nWHOOP_CLIENT_SECRET=%s\n" % (cid, sec))
    try:
        os.chmod(FILES["env"], 0o600)
    except OSError:
        pass
    print("Saved .env")
    return cid, sec


def credentials():
    env = read_env()
    cid = os.environ.get("WHOOP_CLIENT_ID") or env.get("WHOOP_CLIENT_ID")
    sec = os.environ.get("WHOOP_CLIENT_SECRET") or env.get("WHOOP_CLIENT_SECRET")
    if cid and sec:
        return clean_cred(cid), clean_cred(sec)
    if interactive():
        return setup_credentials()
    raise SyncError("Credentials missing. Run once: py whoop.py --setup", 2)


# ---------------------------------------------------------------- http and tokens

def http_json(req, tries=5):
    delay = 2
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:500]
            if e.code == 429 or e.code >= 500:
                ra = e.headers.get("Retry-After", "")
                wait = int(ra) if str(ra).isdigit() else delay
                log("HTTP %s from WHOOP, waiting %ss (attempt %d of %d)" % (e.code, min(wait, 60), attempt + 1, tries))
                time.sleep(min(wait, 60))
                delay *= 2
                continue
            raise ApiError(e.code, body)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            log("Network problem: %s (attempt %d of %d)" % (e, attempt + 1, tries))
            time.sleep(delay)
            delay *= 2
    raise SyncError("WHOOP unreachable after %d tries" % tries, 4)


def post_token(data):
    def send(d, basic=None):
        h = {"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA}
        if basic:
            import base64
            h["Authorization"] = "Basic " + base64.b64encode(("%s:%s" % basic).encode()).decode()
        return http_json(urllib.request.Request(TOKEN_URL, data=urllib.parse.urlencode(d).encode(), headers=h))
    try:
        return send(data)
    except ApiError as e:
        if e.http_code == 401 and "invalid_client" in str(getattr(e, "body", "") or e):
            log("Secret in form body rejected, retrying with HTTP Basic")
            d = {k: v for k, v in data.items() if k not in ("client_id", "client_secret")}
            return send(d, (data.get("client_id", ""), data.get("client_secret", "")))
        raise


def save_tokens(t):
    t["expires_at"] = time.time() + t["expires_in"]
    write_atomic(FILES["tokens"], json.dumps(t))      # written BEFORE use: each refresh kills the old pair
    try:
        os.chmod(FILES["tokens"], 0o600)
    except OSError:
        pass
    return t


def browser_auth(cid, sec):
    if not interactive():
        raise SyncError("WHOOP needs a fresh approval. Run once by hand: py whoop.py --auth", 3)
    state = secrets.token_urlsafe(8)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": REDIRECT, "response_type": "code",
        "scope": SCOPES, "state": state})
    print("\nOpening WHOOP in your browser. Approve access.")
    print("The next page will fail to load. That is expected.")
    print("Copy the FULL address from the browser bar and paste it below.\n")
    print(url + "\n")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    pasted = input("Paste the full address here: ").strip().strip('"')
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(pasted).query)
    code = qs["code"][0] if "code" in qs else pasted
    if "state" in qs and qs["state"][0] != state:
        raise SyncError("Approval state did not match. Start again with: py whoop.py --auth", 3)
    return save_tokens(post_token({
        "grant_type": "authorization_code", "code": code, "client_id": cid,
        "client_secret": sec, "redirect_uri": REDIRECT}))


def get_token(force_refresh=False, force_auth=False):
    cid, sec = credentials()
    t = None if force_auth else read_json(FILES["tokens"])
    if not t:
        return browser_auth(cid, sec)["access_token"]
    if not force_refresh and t.get("expires_at", 0) > time.time() + 120:
        return t["access_token"]
    try:
        t = save_tokens(post_token({
            "grant_type": "refresh_token", "refresh_token": t["refresh_token"],
            "client_id": cid, "client_secret": sec, "scope": "offline"}))
    except ApiError as e:
        if e.http_code in (400, 401):
            if interactive():
                log("Refresh token rejected, starting browser approval")
                return browser_auth(cid, sec)["access_token"]
            raise SyncError("WHOOP rejected the saved login. Run once by hand: py whoop.py --auth", 3)
        raise
    return t["access_token"]


_token = {"v": None}


def api_get(path):
    if _token["v"] is None:
        _token["v"] = get_token()
    for attempt in (0, 1):
        req = urllib.request.Request(BASE + path, headers={
            "Authorization": "Bearer " + _token["v"], "User-Agent": UA})
        try:
            return http_json(req)
        except ApiError as e:
            if e.http_code == 401 and attempt == 0:
                _token["v"] = get_token(force_refresh=True)
                continue
            raise


def page(path):
    out, tok = [], None
    while True:
        q = "limit=25" + ("&nextToken=" + urllib.parse.quote(tok, safe="") if tok else "")
        d = api_get(path + ("&" if "?" in path else "?") + q)
        out += d.get("records", [])
        tok = d.get("next_token")
        if not tok:
            return out
        if len(out) >= RECORD_CAP:
            raise SyncError("Reached %d records for %s. Raise RECORD_CAP on purpose." % (RECORD_CAP, path), 4)
        time.sleep(PAGE_PAUSE)


def fetch_all(since=None):
    data = {
        "profile": api_get("/v2/user/profile/basic"),
        "body": api_get("/v2/user/measurement/body"),
    }
    for kind, path in ENDPOINTS.items():
        q = "?start=" + urllib.parse.quote(since, safe="") if since else ""
        data[kind] = page(path + q)
    return data


def parse_iso(v):
    try:
        return datetime.strptime((v or "")[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def plan_sync(archive, force_full):
    """Return an ISO start time for a quick recent pull, or None when a full pull is needed."""
    if force_full:
        return None
    meta = archive.get("meta") or {}
    last_full = parse_iso(meta.get("last_full_at"))
    if last_full is None or not all(archive.get(k) for k in ENDPOINTS):
        return None
    age = (datetime.now(timezone.utc) - last_full).total_seconds() / 86400.0
    if age < 0 or age >= FULL_EVERY_DAYS:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=INCR_DAYS)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


# ---------------------------------------------------------------- archive

def merge(old, new, kind):
    key, sort = KEYS[kind], SORT[kind]
    d = {r.get(key): r for r in old if r.get(key) is not None}
    added = updated = 0
    for r in new:
        k = r.get(key)
        if k is None:
            continue
        if k not in d:
            d[k] = r
            added += 1
        elif (r.get("updated_at") or "") >= (d[k].get("updated_at") or ""):
            if r != d[k]:
                updated += 1
            d[k] = r
    out = sorted(d.values(), key=lambda r: r.get(sort) or "", reverse=True)
    return out, added, updated


def empty_archive():
    return {"profile": {}, "body": {}, "recovery": [], "cycles": [], "sleep": [], "workouts": [], "meta": {}}


def sync(archive, force_full=False):
    since = plan_sync(archive, force_full)
    try:
        fresh = fetch_all(since)
    except ApiError as e:
        if since and e.http_code in (400, 422):
            log("Quick pull was refused (%s), doing a full pull instead" % e.http_code)
            since = None
            fresh = fetch_all(None)
        else:
            raise
    full = since is None
    log("Pulling %s" % ("all history" if full else "the last %d days" % INCR_DAYS))
    out = dict(archive)
    out["profile"] = fresh["profile"]
    out["body"] = fresh["body"]
    # WHOOP shares only the current weight, so keep a dated log of it: a new entry whenever the value changes
    try:
        w = (fresh["body"] or {}).get("weight_kilogram")
        wl = dict(archive.get("weight_log") or {})
        if isinstance(w, (int, float)) and w > 20 and (not wl or wl[sorted(wl)[-1]] != round(w, 2)):
            wl[datetime.now().strftime("%Y-%m-%d")] = round(w, 2)
        if wl:
            out["weight_log"] = wl
    except Exception as e:
        log("Weight log skipped: %s" % e)
    added, updated = {}, {}
    for kind in ENDPOINTS:
        if not fresh[kind] and archive.get(kind):
            if full:
                log("WARNING: WHOOP returned no %s, keeping %d archived records" % (kind, len(archive[kind])))
            out[kind] = archive[kind]
            added[kind] = updated[kind] = 0
            continue
        out[kind], added[kind], updated[kind] = merge(archive.get(kind, []), fresh[kind], kind)
    meta = dict(archive.get("meta") or {})
    meta.update({
        "tool_version": VERSION,
        "pulled_at": now_iso(),
        "counts": {k: len(out[k]) for k in ENDPOINTS},
        "added": added,
        "updated": updated,
        "last_attempt_at": now_iso(),
        "last_error": None,
        "mode": "full" if full else "quick",
    })
    if full:
        meta["last_full_at"] = now_iso()
    out["meta"] = meta
    return out


def rolling_backup():
    """Keep a dated copy of the archive about once a week, newest eight kept."""
    try:
        if not os.path.exists(FILES["archive"]):
            return
        os.makedirs(FILES["backups"], exist_ok=True)
        names = sorted(n for n in os.listdir(FILES["backups"]) if n.startswith("whoop_data_") and n.endswith(".json"))
        if names:
            newest = os.path.getmtime(os.path.join(FILES["backups"], names[-1]))
            if time.time() - newest < BACKUP_EVERY_DAYS * 86400:
                return
        dst = os.path.join(FILES["backups"], "whoop_data_%s.json" % datetime.now().strftime("%Y%m%d"))
        with open(FILES["archive"], "rb") as src, open(dst, "wb") as out:
            out.write(src.read())
        names = sorted(n for n in os.listdir(FILES["backups"]) if n.startswith("whoop_data_") and n.endswith(".json"))
        for n in names[:-BACKUPS_KEEP]:
            os.unlink(os.path.join(FILES["backups"], n))
        log("Weekly backup saved: " + os.path.basename(dst))
    except OSError as e:
        log("Backup skipped: %s" % e)


# ---------------------------------------------------------------- dashboard build

def inject(html, tag, script_id, obj):
    pat = re.compile(r"<!--%s_START-->.*?<!--%s_END-->" % (tag, tag), re.S)
    if not pat.search(html):
        raise SyncError("Markers %s_START/%s_END not found in the dashboard file." % (tag, tag), 5)
    js = json.dumps(obj, separators=(",", ":"), ensure_ascii=True).replace("<", "\\u003c")
    block = '<!--%s_START--><script id="%s" type="application/json">%s</script><!--%s_END-->' % (
        tag, script_id, js, tag)
    return pat.sub(lambda m: block, html, count=1)


def load_entries():
    e = read_json(FILES["entries"], {"entries": []})
    if not isinstance(e, dict) or not isinstance(e.get("entries"), list):
        log("WARNING: user_entries.json ignored (expected an object with an entries list)")
        return {"entries": []}
    return e


SRC_DIR = P("dashboard_src")
V3_DIR = P("dashboard_v3")
SRC_JS = ["core.js", "charts.js", "sections1.js", "sections2.js", "sections3.js", "sections4.js", "orb.js"]
V3_JS = ["core.js", "charts.js", "sections1.js", "sections2.js", "sections3.js", "sections4.js"]
V3_OWN = ("gym.js", "story.js", "journal.js", "score.js", "plan.js", "call.js", "running.js", "season.js")


def _read(folder, n):
    with open(os.path.join(folder, n), "r", encoding="utf-8") as f:
        return f.read()


def assemble_from_source(variant="classic"):
    """Build a dashboard page from the parts folders. Returns None if the needed folder is absent.
    variant 'season' is the new design (dashboard_v3 on top of dashboard_src); 'classic' is the older single page."""
    if not os.path.isfile(os.path.join(SRC_DIR, "index.html")):
        return None
    if variant == "season":
        if not os.path.isfile(os.path.join(V3_DIR, "index.html")):
            return None
        html = _read(V3_DIR, "index.html").replace("/*CSS*/", _read(SRC_DIR, "style.css") + "\n" + _read(V3_DIR, "theme.css"))
        js = "\n".join([_read(SRC_DIR, n) for n in V3_JS] + [_read(V3_DIR, n) for n in V3_OWN if os.path.isfile(os.path.join(V3_DIR, n))])
    else:
        html = _read(SRC_DIR, "index.html").replace("/*CSS*/", _read(SRC_DIR, "style.css"))
        js = "\n".join(_read(SRC_DIR, n) for n in SRC_JS)
    if "</script" in js.lower():
        raise SyncError("A dashboard source file contains a closing script tag.", 5)
    return html.replace("/*JS*/", js)


def load_gym():
    """Ingest any new MacroFactor export, then return the gym archive for the page (or None)."""
    if gym is None:
        return None
    arch = gym.refresh(HERE, FILES["gym"], log)
    if not arch:
        return None
    slim = dict(arch)
    slim.pop("muscle_volume", None)
    return slim


_EXPORT = {"v": None}


def load_export():
    """Read any WHOOP export (journal, cycles, sleeps, workouts csv or zip) not yet seen. None if there is none."""
    if whoop_export is None:
        return None
    _EXPORT["v"] = whoop_export.refresh(HERE, FILES["export"], log)
    return _EXPORT["v"]


_STRAVA = {"v": None}


def load_strava():
    """Read any Strava export (activities.csv) not yet seen. None if there is none."""
    if strava is None:
        return None
    _STRAVA["v"] = strava.refresh(HERE, FILES["strava"], log)
    return _STRAVA["v"]


def layer_export(data):
    """Add export cycles the API archive lacks, then Strava history, in memory only. Returns the data to build and email from."""
    ex = _EXPORT["v"]
    if whoop_export is not None and ex:
        data, n = whoop_export.layer(data, ex)
        if n:
            log("WHOOP export layered in: %d days the API did not cover" % n)
    if strava is not None and _STRAVA["v"]:
        data, n = strava.layer(data, _STRAVA["v"])
        if n:
            log("Strava history layered in: %d activities WHOOP did not record" % n)
    return data


def build_dashboard(data):
    entries = load_entries()
    jdata = whoop_export.page_data(_EXPORT["v"]) if whoop_export is not None and _EXPORT["v"] else None
    gdata = load_gym()
    built = False
    # the new design is the main page; the classic page is kept beside it
    for variant, key in (("season", "dash"), ("classic", "classic")):
        html = assemble_from_source(variant)
        if html is None:
            if variant == "classic":
                continue
            if not os.path.exists(FILES["dash"]):
                log("Dashboard file not found, skipping build: " + FILES["dash"])
                return False
            with open(FILES["dash"], "r", encoding="utf-8") as f:
                html = f.read()
        html = inject(html, "WHOOP_DATA", "whoop-data", data)
        html = inject(html, "USER_DATA", "user-embed", entries)
        if variant == "season" and "<!--GYM_DATA_START-->" in html:
            html = inject(html, "GYM_DATA", "gym-data", gdata)
        if variant == "season" and "<!--JOURNAL_DATA_START-->" in html:
            html = inject(html, "JOURNAL_DATA", "journal-data", jdata)
        write_atomic(FILES[key], html)
        built = True
    return built


# ---------------------------------------------------------------- lock and status

def take_lock():
    try:
        if os.path.exists(FILES["lock"]) and time.time() - os.path.getmtime(FILES["lock"]) < 900:
            raise SyncError("Another sync is running (lock file is under 15 minutes old).", 6)
        with open(FILES["lock"], "w") as f:
            f.write(str(os.getpid()))
    except OSError:
        pass


def drop_lock():
    try:
        os.unlink(FILES["lock"])
    except OSError:
        pass


def write_status(ok, message, extra=None, code=None):
    try:
        prev = read_json(FILES["status"], {}) or {}
    except SyncError:
        prev = {}
    fails = 0 if ok else int(prev.get("fail_count", 0) or 0) + 1
    s = {"ok": ok, "at": now_iso(), "message": message, "version": VERSION, "fail_count": fails}
    if extra:
        s.update(extra)
    try:
        write_atomic(FILES["status"], json.dumps(s, indent=2))
    except OSError:
        pass
    if not ok and (fails >= 2 or code == 3):
        try:
            import mailer
            mailer.send_alert(SECRET_DIR, log, fails, message, code)
        except Exception as e:      # an alert must never make a failure worse
            log("Alert skipped: %s" % e)


# ---------------------------------------------------------------- morning email

def email_setup():
    import mailer
    print("Morning email setup. It sends a short summary to your own Gmail once a day.")
    print("You need a Google App Password: Google Account, Security, turn on 2 Step Verification,")
    print("then search 'App passwords', create one named WHOOP, and copy the 16 letters.")
    addr = clean_cred(input("Your Gmail address: "))
    pw = mailer.clean_pw(input("App password (16 letters, shown as you paste): "))
    if "@" not in addr or len(pw) < 16:
        raise SyncError("That does not look right. Address needs an @ and the app password is 16 letters.", 2)
    mailer.save_cfg(SECRET_DIR, {"address": addr, "app_password": pw})
    arch = read_json(FILES["archive"], None)
    if arch:
        print("Sending a test email now...")
        ok = mailer.send_daily(arch, SECRET_DIR, log, force=True)
        print("Test email sent. Check your inbox." if ok else
              "Saved, but the test did not send. See sync.log. A morning email will retry on each sync.")


def maybe_email(archive):
    try:
        import mailer
        sent = mailer.send_daily(archive, SECRET_DIR, log)
        if sent or mailer.load_cfg(SECRET_DIR) and mailer.build(archive):
            mailer.send_weekly(archive, SECRET_DIR, log)
    except Exception as e:      # the email must never break the sync
        log("Email skipped: %s" % e)


# ---------------------------------------------------------------- windows scheduler

def ps_quote(s):
    return "'" + s.replace("'", "''") + "'"


def schedule(install):
    if os.name != "nt":
        print("The scheduler installer is for Windows. On Mac or Linux use cron or launchd:")
        print("  python3 %s --quiet" % SELF)
        return 0
    if install:
        exe = sys.executable
        w = os.path.join(os.path.dirname(exe), "pythonw.exe")
        if os.path.exists(w):
            exe = w
        script = "\n".join([
            "$a = New-ScheduledTaskAction -Execute %s -Argument %s -WorkingDirectory %s" % (
                ps_quote(exe), ps_quote('"%s" --quiet' % SELF), ps_quote(HERE)),
            "$t = @((New-ScheduledTaskTrigger -Daily -At 6:00AM), (New-ScheduledTaskTrigger -Daily -At 9:30AM),"
            " (New-ScheduledTaskTrigger -Daily -At 1:00PM), (New-ScheduledTaskTrigger -Daily -At 6:00PM),"
            " (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME))",
            "$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries"
            " -DontStopIfGoingOnBatteries -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew"
            " -ExecutionTimeLimit (New-TimeSpan -Minutes 20)",
            "Register-ScheduledTask -TaskName 'WhoopSync' -Action $a -Trigger $t -Settings $s"
            " -Description 'Pull WHOOP data and rebuild the dashboard' -Force | Out-Null",
            "Write-Output 'WhoopSync task registered'",
        ])
    else:
        script = ("Unregister-ScheduledTask -TaskName 'WhoopSync' -Confirm:$false;"
                  " Write-Output 'WhoopSync task removed'")
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                       capture_output=True, text=True)
    print((r.stdout or "").strip())
    if r.returncode != 0:
        print("PowerShell reported a problem:\n" + (r.stderr or "").strip())
        return 1
    if install:
        print("Runs at 6:00 AM, 9:30 AM, 1:00 PM, 6:00 PM and at logon. A run missed while the PC was off")
        print("starts when it wakes. Check results any time with: py whoop.py --status")
    return 0


# ---------------------------------------------------------------- doctor

def doctor():
    """Plain English health check. Never prints a secret."""
    rows = []

    def add(state, msg):
        rows.append((state, msg))

    add("OK" if sys.version_info >= (3, 7) else "FAIL", "Python %s" % sys.version.split()[0])
    env = read_env()
    add("OK" if env.get("WHOOP_CLIENT_ID") and env.get("WHOOP_CLIENT_SECRET") else "FAIL",
        "WHOOP client details saved on this PC" if env.get("WHOOP_CLIENT_ID") and env.get("WHOOP_CLIENT_SECRET")
        else "WHOOP client details are missing. Run SETUP.bat")
    try:
        t = read_json(FILES["tokens"])
    except SyncError:
        t = None
    add("OK" if t and t.get("refresh_token") else "FAIL",
        "WHOOP login is saved" if t and t.get("refresh_token") else "No WHOOP login saved. Double click FIX_LOGIN.bat")
    try:
        a = read_json(FILES["archive"])
    except SyncError:
        a = None
    if a:
        add("OK", "Archive holds %d cycles, %d sleeps, %d workouts" % (len(a.get("cycles") or []), len(a.get("sleep") or []), len(a.get("workouts") or [])))
        pulled = parse_iso((a.get("meta") or {}).get("pulled_at"))
        if pulled:
            hrs = (datetime.now(timezone.utc) - pulled).total_seconds() / 3600.0
            add("OK" if hrs < 30 else "WARN" if hrs < 72 else "FAIL", "Last good pull was %.0f hours ago%s" % (hrs, "" if hrs < 30 else ". Double click refresh_whoop.bat"))
    else:
        add("FAIL", "No data archive yet. Run refresh_whoop.bat")
    st = None
    try:
        st = read_json(FILES["status"])
    except SyncError:
        pass
    if st:
        add("OK" if st.get("ok") else "FAIL", "Last sync %s" % ("worked" if st.get("ok") else "failed: %s" % st.get("message")))
    if gym is not None:
        try:
            g = read_json(FILES["gym"])
        except SyncError:
            g = None
        if g and g.get("sessions"):
            last = max(x["date"] for x in g["sessions"])
            age = (datetime.now().date() - datetime.strptime(last, "%Y-%m-%d").date()).days
            nlog = sum(1 for x in g["sessions"] if x.get("src") == "log")
            add("OK" if age <= 10 else "WARN", "Gym log has %d sessions (%d from screenshots), latest %s%s" % (len(g["sessions"]), nlog, last, "" if age <= 10 else ". Send a workout screenshot to the workout chat, or export from MacroFactor again"))
        else:
            add("WARN", "No gym log yet. Save a MacroFactor workout export into Downloads and refresh")
    if whoop_export is not None:
        try:
            ex = read_json(FILES["export"])
        except SyncError:
            ex = None
        if ex and (ex.get("journal") or ex.get("cycles")):
            jr = ex.get("journal") or {}
            add("OK", "WHOOP export read: %d journal days%s, %d cycles" % (len(jr), (", latest " + max(jr)[:10]) if jr else "", len(ex.get("cycles") or [])))
        else:
            add("WARN", "No WHOOP export read yet. Optional: save the WHOOP data export (csv or zip) into your Drive folder or Downloads and refresh")
    if strava is not None:
        try:
            sv = read_json(FILES["strava"])
        except SyncError:
            sv = None
        if sv and sv.get("activities"):
            dts = sorted(a["s"][:10] for a in sv["activities"].values())
            add("OK", "Strava history read: %d activities, %s to %s" % (len(sv["activities"]), dts[0], dts[-1]))
        else:
            add("WARN", "No Strava history read yet. Optional: put your Strava export activities.csv in the Drive folder strava export and refresh")
    if selfupdate is not None:
        try:
            add(*selfupdate.describe())
        except Exception:
            pass
    for k, label in (("dash", "The Season dashboard"), ("classic", "Classic dashboard")):
        add("OK" if os.path.exists(FILES[k]) else "WARN", label + (" file is built" if os.path.exists(FILES[k]) else " file is not built yet"))
    if os.name == "nt":
        try:
            r = subprocess.run(["schtasks", "/Query", "/TN", "WhoopSync"], capture_output=True, text=True)
            add("OK" if r.returncode == 0 else "FAIL", "Automatic refresh is scheduled" if r.returncode == 0 else "Automatic refresh is NOT scheduled. Run SETUP.bat")
        except OSError:
            add("WARN", "Could not check the scheduled task")
    try:
        import mailer
        cfg = mailer.load_cfg(SECRET_DIR)
        add("OK" if cfg else "WARN", "Email is set up (morning, weekly and problem alerts)" if cfg else "Email is not set up. Run SETUP_EMAIL.bat if you want the morning email")
    except Exception:
        add("WARN", "Email module could not be loaded")
    for s_, m_ in rows:
        print("[%s] %s" % (s_.ljust(4), m_))
    bad = [m for s_, m in rows if s_ == "FAIL"]
    print("\nAll good." if not bad and not any(s_ == "WARN" for s_, _ in rows) else
          ("\n%d problem%s to fix. Do the step named on the line marked FAIL." % (len(bad), "" if len(bad) == 1 else "s")) if bad else "\nWorks, with small notes above.")
    return 1 if bad else 0


# ---------------------------------------------------------------- main

def main():
    global QUIET
    ap = argparse.ArgumentParser(description="WHOOP sync and dashboard builder")
    ap.add_argument("--setup", action="store_true", help="store client id and secret in .env")
    ap.add_argument("--auth", action="store_true", help="force the browser approval flow")
    ap.add_argument("--build-only", action="store_true", help="rebuild the dashboard from the archive")
    ap.add_argument("--no-build", action="store_true", help="sync but skip the dashboard rebuild")
    ap.add_argument("--full", action="store_true", help="pull all history (keeps the archive)")
    ap.add_argument("--doctor", action="store_true", help="check the setup and report problems")
    ap.add_argument("--fresh", action="store_true", help="ignore the archive and rebuild it from WHOOP only")
    ap.add_argument("--open", action="store_true", help="open the dashboard when done")
    ap.add_argument("--quiet", action="store_true", help="log to sync.log only")
    ap.add_argument("--status", action="store_true", help="print the last sync result")
    ap.add_argument("--update", action="store_true", help="check for a dashboard update now")
    ap.add_argument("--setup-email", action="store_true", help="set up the morning email")
    ap.add_argument("--install-schedule", action="store_true")
    ap.add_argument("--uninstall-schedule", action="store_true")
    args = ap.parse_args()
    QUIET = args.quiet
    migrate_secrets()

    if args.status:
        s = read_json(FILES["status"])
        print(json.dumps(s, indent=2) if s else "No sync has run yet.")
        return 0
    if args.doctor:
        return doctor()
    if args.install_schedule or args.uninstall_schedule:
        return schedule(args.install_schedule)
    if args.setup_email:
        try:
            email_setup()
        except SyncError as e:
            print(str(e))
            return e.code
        return 0
    if args.setup:
        try:
            setup_credentials()
        except SyncError as e:
            print(str(e))
            return e.code
        return 0

    if selfupdate is not None and not os.environ.get("WHOOP_NOUPDATE"):
        changed = selfupdate.check(log, force=args.update)
        if any(c.endswith(".py") for c in changed):
            log("Restarting with the updated program")
            env = dict(os.environ, WHOOP_NOUPDATE="1")
            return subprocess.run([sys.executable, SELF] + sys.argv[1:], env=env).returncode
        if args.update:
            print("Updated: " + ", ".join(changed) if changed else "Already up to date (or no update address set).")
            if not changed:
                return 0
    try:
        take_lock()
    except SyncError as e:
        log("SKIPPED: %s" % e)
        return e.code
    archive = empty_archive()
    try:
        if not args.fresh:
            archive = read_json(FILES["archive"], None) or empty_archive()
            archive.setdefault("meta", {})
        embed = archive
        load_export()
        load_strava()
        if args.build_only:
            log("Build only, using archive with %s cycles" % len(archive.get("cycles", [])))
        else:
            if args.auth:
                _token["v"] = get_token(force_auth=True)
            try:
                merged = sync(archive, force_full=args.full)
            except SyncError as e:
                # Keep the archive untouched, but let the dashboard show the failure.
                embed = layer_export(dict(archive))
                meta = dict(embed.get("meta") or {})
                meta.update({"last_attempt_at": now_iso(), "last_error": str(e)})
                embed["meta"] = meta
                if not args.no_build:
                    try:
                        build_dashboard(embed)
                    except SyncError as e2:
                        log("Build also failed: %s" % e2)
                write_status(False, str(e), code=e.code)
                log("SYNC FAILED: %s" % e)
                return e.code
            rolling_backup()
            if os.path.exists(FILES["archive"]):
                try:
                    with open(FILES["archive"], "rb") as src, open(FILES["prev"], "wb") as dst:
                        dst.write(src.read())
                except OSError:
                    pass
            write_atomic(FILES["archive"], json.dumps(merged, indent=1))
            embed = layer_export(merged)
            m = merged["meta"]
            log("Synced. Totals %s, new %s, updated %s" % (m["counts"], m["added"], m["updated"]))
            write_status(True, "ok", {"counts": m["counts"], "added": m["added"]})
        if args.build_only:
            embed = layer_export(embed)
        if not args.no_build:
            if build_dashboard(embed):
                log("Dashboard rebuilt: " + FILES["dash"])
        if not args.build_only and embed.get("meta", {}).get("last_error") is None:
            maybe_email(embed)
        if args.open and os.path.exists(FILES["dash"]):
            webbrowser.open("file:///" + FILES["dash"].replace("\\", "/"))
        return 0
    except SyncError as e:
        log("ERROR: %s" % e)
        write_status(False, str(e), code=e.code)
        return e.code
    except Exception as e:
        log("UNEXPECTED ERROR: %s\n%s" % (e, traceback.format_exc()))
        write_status(False, "unexpected error: %s" % e)
        return 1
    finally:
        drop_lock()


if __name__ == "__main__":
    sys.exit(main())
