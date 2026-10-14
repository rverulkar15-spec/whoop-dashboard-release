"""Phone page: puts a copy of your finished dashboard on a private web page that only you can open.

The page lives on Cloudflare Pages behind Cloudflare Access (a login by emailed code). Nothing is published until
the login wall is seen to be in place, and the check runs again before every publish. Uses only the standard
library plus npx (Node.js), which runs Cloudflare's own tool. Your Cloudflare token stays in the private folder
next to your other logins and never enters the data folder, Drive or the release."""
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import time
import urllib.error
import urllib.request

WRANGLER = "wrangler@4"
CFG = "phone.json"
STATE = "phone_state.json"


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def load_cfg(secret_dir):
    c = _read(os.path.join(secret_dir, CFG))
    return c if c and c.get("token") and c.get("account") and c.get("project") else None


def site_url(project):
    return "https://%s.pages.dev/" % project


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def protected(project, timeout=20):
    """True only when the address answers with the Cloudflare Access login redirect."""
    req = urllib.request.Request(site_url(project), headers={"User-Agent": "Mozilla/5.0 (whoop-dashboard check)", "Accept": "text/html"})
    try:
        urllib.request.build_opener(_NoRedirect).open(req, timeout=timeout)
        return False, "the address answers without asking for a login"
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location", "") if e.headers else ""
        if e.code in (301, 302, 303, 307, 308) and ("cloudflareaccess.com" in loc or "/cdn-cgi/access/" in loc):
            return True, "login wall in place"
        return False, "the address answered %s and not the Cloudflare login" % e.code
    except Exception as e:
        return False, "could not reach the address (%s)" % str(e)[:80]


def _npx():
    return shutil.which("npx")


def _run(args, cfg, timeout=300):
    env = dict(os.environ)
    env.update({"CLOUDFLARE_API_TOKEN": cfg["token"], "CLOUDFLARE_ACCOUNT_ID": cfg["account"], "CI": "1", "WRANGLER_SEND_METRICS": "false"})
    p = subprocess.run([_npx(), "--yes", WRANGLER] + args, env=env, capture_output=True, text=True, timeout=timeout)
    out = ((p.stdout or "") + "\n" + (p.stderr or "")).replace(cfg["token"], "***")
    return p.returncode, out


def publish(secret_dir, html_path, log, force=False):
    """Returns off, unchanged, blocked, error or ok. Never raises, never stops a refresh."""
    try:
        cfg = load_cfg(secret_dir)
        if not cfg:
            return "off"
        if not os.path.exists(html_path):
            return "error"
        with open(html_path, "rb") as f:
            data = f.read()
        h = hashlib.sha256(data).hexdigest()
        st_path = os.path.join(secret_dir, STATE)
        st = _read(st_path) or {}
        if not force and st.get("hash") == h and st.get("ok"):
            return "unchanged"
        ok, why = protected(cfg["project"])
        if not ok:
            log("Phone page NOT published: %s. Finish the login step (py whoop.py --phone-setup)." % why)
            _write(st_path, dict(st, ok=False, at=time.time(), note="blocked: " + why))
            return "blocked"
        if not _npx():
            log("Phone page not published: Node.js is not installed (it provides npx). Install it, then refresh.")
            _write(st_path, dict(st, ok=False, at=time.time(), note="Node.js missing"))
            return "error"
        stage = os.path.join(secret_dir, "phone_site")
        os.makedirs(stage, exist_ok=True)
        with open(os.path.join(stage, "index.html"), "wb") as f:
            f.write(data)
        with open(os.path.join(stage, "_headers"), "w", encoding="utf-8") as f:
            f.write("/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-cache\n")
        rc, out = _run(["pages", "deploy", stage, "--project-name", cfg["project"], "--branch", "main", "--commit-dirty=true"], cfg)
        if rc == 0:
            _write(st_path, {"hash": h, "ok": True, "at": time.time(), "note": "published"})
            log("Phone page published")
            return "ok"
        tail = " | ".join([x.strip() for x in out.strip().splitlines() if x.strip()][-3:])
        log("Phone page publish failed: " + tail[:300])
        _write(st_path, dict(st, ok=False, at=time.time(), note="failed"))
        return "error"
    except Exception as e:
        try:
            log("Phone page publish error: %s" % str(e)[:200])
        except Exception:
            pass
        return "error"


def describe(secret_dir):
    """One line for DOCTOR."""
    cfg = load_cfg(secret_dir)
    if not cfg:
        return "WARN", "Phone page is not set up. Optional: run py whoop.py --phone-setup"
    st = _read(os.path.join(secret_dir, STATE)) or {}
    if not st:
        return "WARN", "Phone page is set up, nothing published yet"
    hrs = (time.time() - st.get("at", 0)) / 3600.0
    if st.get("ok"):
        return ("OK" if hrs < 36 else "WARN"), "Phone page %s is current as of %.0f hours ago" % (site_url(cfg["project"]), hrs)
    return "WARN", "Phone page last attempt did not publish (%s). Details are in sync.log" % st.get("note", "unknown")


ACCESS_STEPS = """
Now turn on the login wall (one time, about 10 minutes). Nothing is published until it is on.
  1. Open https://dash.cloudflare.com, go to Workers and Pages, and click the project named {project}.
  2. Settings, General, then Enable access policy. If Cloudflare asks you to set up Zero Trust first, pick a team name
     and the Free plan. It asks for payment details even on Free, and the Free plan is not charged.
  3. Back in Settings, General, click Manage next to the access policy. That opens Access, Applications.
     Open the application for this project and click Configure.
  4. Under Public hostname, clear the * from the Subdomain field so it reads exactly {project}, with domain pages.dev.
     If it complains about the name, rename the application (for example Season) and save.
  5. Go back to the project, Settings, General, and turn Enable access policy on again. That protects preview links too.
  6. Check the policy: it must allow only your own email address. Under Zero Trust, Settings, Authentication,
     Login methods, make sure One-time PIN is added so a code can be emailed to you.
"""

IPHONE = """
Done. On your iPhone:
  1. Open Safari and go to {url}
  2. Enter your email, then the code Cloudflare emails you.
  3. Tap Share, then Add to Home Screen, then Add. It opens like an app.
The page updates after every refresh on this PC (while the PC is on and online).
"""


def setup(secret_dir, html_path, log):
    print("Phone page setup")
    if not _npx():
        print("Node.js is needed first. In a Command Prompt run:  winget install OpenJS.NodeJS.LTS")
        print("Then close this window, open a new one and run this setup again.")
        return 1
    cfg = load_cfg(secret_dir) or {}
    if not cfg:
        print("Create a Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens")
        print("  Create Token, Get started next to Custom token, permission: Account, Cloudflare Pages, Edit, then Continue to summary and Create Token.")
        print("  Copy the token right away, Cloudflare shows it once.")
        print("Your Account ID is the 32 letters and numbers in the address bar right after dash.cloudflare.com/ when you are signed in.")
        acct = re.sub(r"[^0-9a-fA-F]", "", input("Account ID: "))
        if len(acct) != 32:
            print("That Account ID does not look right (it is 32 letters and numbers). Run the setup again.")
            return 1
        print("The token is shown as you paste it. Right click pastes in this window.")
        tok = "".join(ch for ch in input("API token: ") if ch.isprintable() and not ch.isspace())
        if len(tok) < 20:
            print("That token looks too short. Run the setup again.")
            return 1
        cfg = {"account": acct.lower(), "token": tok, "project": "whoop-season-" + secrets.token_hex(3)}
        _write(os.path.join(secret_dir, CFG), cfg)
    rc, out = _run(["pages", "project", "create", cfg["project"], "--production-branch", "main"], cfg, timeout=180)
    if rc != 0 and "already exists" not in out.lower():
        print("Could not create the page. Cloudflare said:")
        print("\n".join(out.strip().splitlines()[-6:]))
        return 1
    host = cfg["project"] + ".pages.dev"
    print(ACCESS_STEPS.format(project=cfg["project"]))
    for attempt in range(4):
        input("Press Enter once the application is saved... ")
        ok, why = protected(cfg["project"])
        if ok:
            break
        print("Not protected yet: " + why + ". Check step 4, the hostname must be exactly %s, then try again." % host)
    else:
        print("Still not protected, so nothing was published. Run the setup again when ready.")
        return 1
    res = publish(secret_dir, html_path, log, force=True)
    if res == "ok":
        print(IPHONE.format(url=site_url(cfg["project"])))
        return 0
    print("The login wall is on, but the first publish did not finish (%s). Details are in sync.log. Run: py whoop.py --phone-now" % res)
    return 1
