Developer checks (not shipped to the user, not in the update manifest).
Needs a fixture folder FIX holding whoop_data.json and gym_data.json (copy of a real archive).
  python3 tools/mkedge.py FIX_PARENT      builds 9 edge case scenarios under FIX_PARENT/edge, expects FIX_PARENT/tt/ as the fixture
  for each scenario dir: WHOOP_NOUPDATE=1 WHOOP_SECRET_DIR=$PWD/sec python3 whoop.py --build-only --quiet
  node tools/edge.js FIX_PARENT/edge <scenario names>     JS errors, overflow, dashes, banners at 1200 and 390 wide
  node tools/axe.js <dashboard.html> <axe.min.js>         accessibility audit, both themes
  node tools/par.js FIX_PARENT ; tools/par2.js            dashboard numbers to compare with mailer.windows (they must match)
Node needs playwright (NODE_PATH=$(npm root -g)). Chromium is at /opt/pw-browsers/chromium.
