WHOOP DASHBOARD: SETUP AND DAILY USE

WHAT IS IN THIS FOLDER
  SETUP.bat             double click once. Saves your WHOOP login, pulls data, opens the dashboard, schedules auto refresh
  SETUP_EMAIL.bat       optional. Double click once to get a short summary emailed to you each morning
  refresh_whoop.bat     double click to refresh and open the dashboard on demand
  DOCTOR.bat            double click to check that everything is healthy. It names the fix for anything wrong
  FIX_LOGIN.bat         double click only if WHOOP asks for a new approval (the problem email tells you when)
  whoop.py              pulls your WHOOP data, merges it into the archive, rebuilds the dashboard
  mailer.py             builds and sends the morning email
  update.py             self update: fetches newer dashboard files by itself once an update address is set
  update_source.txt     the web address self update checks. Leave it alone
  whoop_export.py       reads the WHOOP data export (journal, cycles, sleeps, workouts) and layers it in
  gym.py                reads your MacroFactor exports (workouts, history, weight, steps) and builds the story lines
  whoop_export_data.json  created by the first run that finds a WHOOP export. Grows with every export
  gym_data.json         your gym history, built from the exports. Grows with every export
  dashboard_src         the shared parts the dashboard is built from. Keep this folder next to whoop.py
  dashboard_v3          the new look (The Season). Keep this folder next to whoop.py too
  whoop_dashboard.html  created by the first run. The new dashboard (The Season), one file, works offline
  whoop_classic.html    the older single page layout, built next to it
  whoop_data.json       created by the first run. Your growing archive, every record ever pulled

FIRST TIME SETUP
  1. Copy this whole folder from Google Drive to a normal folder on your PC (for example Documents). Run it from that
     copy, not from inside the Drive folder, so your data and logs are not synced back and forth. Keep all files together.
  2. Double click SETUP.bat.
  3. Paste your WHOOP client id, then your client secret. Use right click to paste, not Ctrl+V.
  4. Approve in the browser. The next page will not load, that is expected. Copy the full address
     from the browser bar and paste it back in the black window.
  5. The dashboard opens. A scheduled task called WhoopSync now refreshes it for you.

DAILY USE
  Nothing. The task runs at 6:00 am, 9:30 am, 1:00 pm, 6:00 pm and at every login. If the computer was
  off, it catches up when it wakes. Open whoop_dashboard.html and refresh the browser tab.
  The computer has to be on for a refresh to happen.

MORNING EMAIL (optional)
  Double click SETUP_EMAIL.bat and follow the prompts. You need a Google app password:
  Google Account, Security, turn on 2 Step Verification, search App passwords, create one, copy the
  16 letters. One email per day, sent once your recovery score for the day exists.

WHAT YOU GET
  Today's call: on the Today tab, a short call from your own history (push, steady or recovery day), the
  strain you usually land on in that recovery band, and when to be in bed tonight. Same lines are in the morning email.
  What moves your recovery: in Progress, below the long term trends, plain English splits such as bedtime, hours asleep and weekends.
  Today is short now. Growth, badges and the full list of morning numbers fold open when you tap them.
  The Story: its own tab. Your lifting in attempts, breaks and comebacks, built only from your logs: the arc, then and now
  for every lift, what the longest break cost, what your body did in lifting weeks, rough patches in recovery, body
  weight and steps, a month by month table and the next marks to beat. A short version sits at the top of Today.
  The Season: bottom tabs (Today, Story, Training, Sleep, Progress, Goals, More; the old Drivers tab is now at the bottom of Progress), dark and light themes,
  a fitness score (0 to 100, built from lifting consistency, strength gains, cardio, recovery trend and sleep, with days off costing points) and badges, a 90 day map, growth against last month and weekly targets. Theme and text size are in More.
  Dashboard: the Progress section compares week over week, month over month and beginning to now.
  It shows where you grew and where to look, plus charts and personal records.
  Morning email: your recovery, last night, last 28 days against the 28 before, and an early warning
  line when HRV, resting heart rate, skin temperature and breathing rate drift the wrong way together.
  Weekly review email: last week against the week before, and first 28 days against the last 28.
  Sent after the first sync that follows each Monday.

GYM LOG (MacroFactor)
  In MacroFactor, export your workouts (the xlsx or csv file). Save it in Downloads, or in a gym_exports folder
  here. The next refresh finds any file named MacroFactor*.xlsx or MacroFactor*.csv by itself, reads it and keeps the history.
  Newer exports replace the same dates and never delete older ones. The Training tab then shows your
  program week, the next workout with suggested weights, lift progress, sets per muscle and recent sessions.
  Today's call and the morning email follow your program (rest days, workout days, missed workouts).

WHOOP EXPORT (journal and older days)
  In the WHOOP app, Settings, Data Export, request your data. You get journal_entries.csv, physiological_cycles.csv,
  sleeps.csv and workouts.csv (or one my_whoop_data zip). Put them in your Google Drive WHOOP Dashboard folder, in
  Downloads, or in a whoop_exports folder here. The next refresh finds them by itself and keeps the history.
  The journal is not available any other way. Progress shows what your habits did to recovery (same cycle), and Story
  compares your habits in the latest break against the run. Days the live WHOOP link does not hold are filled in from
  the export, in the page only, so your archive is never altered. A newer export adds to the old one.
  One journal question (Masturbated?) is skipped on purpose. To skip others, edit SKIP_QUESTIONS in whoop_export.py.

DROP OFF FOLDERS (Google Drive, WHOOP Dashboard folder)
  1 Drop MacroFactor exports here   any MacroFactor .xlsx or .csv export, any file name
  2 Drop WHOOP exports here         the WHOOP export csv files (or the my_whoop_data zip)
  3 Drop Apple Health export here   reserved, not read yet
  Drop the file in, then the next refresh picks it up. Old files can stay, they are only read once.
  Needs Google Drive for desktop running on this PC. The older places (Downloads, Desktop) still work too.

SELF UPDATE
  When update_source.txt (one line, the web address of the release) is present, every refresh checks for a newer
  release at most every 3 hours. It replaces only dashboard and program files whose fingerprint differs, checks each
  download against its fingerprint first, keeps the old copies in update_backup, and never touches your data,
  logins or settings. To check right now: py whoop.py --update. DOCTOR.bat shows its status.
  The .bat files are not replaced automatically.

CREDENTIALS
  Your client id, secret, login tokens and email password are saved OUTSIDE the data folder, in
  %LOCALAPPDATA%\WhoopDashboard, so nothing sensitive sits in a synced or shared folder.

SELF CARE
  Quick refreshes pull the last 14 days and a full history pull runs at least weekly, so syncs stay fast.
  A dated backup of your archive is kept weekly in the backups folder (newest 8).
  If email is set up and a refresh fails twice in a row, or WHOOP needs a new approval, you get one
  email with the exact fix (at most one every 20 hours).

IF SOMETHING GOES WRONG
  Double click DOCTOR.bat first. It lists what is fine and what to fix.
  The dashboard shows a red banner with the reason and keeps the last good data. sync.log has details.
  If WHOOP asks for a new approval (rare), double click FIX_LOGIN.bat.
  If you get 401 invalid_client, the client id and secret do not match. Check both in the WHOOP developer dashboard.

GOOD TO KNOW
  Every assumption is a setting in the Controls section. Every calculated number shows its formula
  and sample size. MEASURED comes from WHOOP, MODELED is computed in the dashboard, USER ENTERED is typed by you.
  WHOOP does not share journal entries or raw heart rate through its API. The journal comes from the export file above. Raw heart rate is not in the dashboard.
