# Krok

*крок* — Ukrainian for "step". A small offline web app for the iPhone: training plan, run log, analysis of your runs, and a guide to the different kinds of sessions.

Everything is stored on the phone. Nothing is sent anywhere.

## Install on the iPhone

1. Open `https://sayyesdarling.github.io/Laufbuch/` in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open Krok from the Home Screen icon from now on. Opened that way it runs full-screen, works offline, and its storage is kept.

If you added an earlier version, it updates itself (tap **Reload** when it offers the new version). The Home Screen name and icon only change if you add it again, and a newly added app starts with empty storage, so first export a backup in Settings, then delete the old icon, add it again, restore the backup and re-import the Strava zip for the per-run charts.

## Bringing in your runs

- **Whole Strava history:** strava.com → Settings → My Account → Download or Delete Your Account → Request your archive. Import the zip Strava emails you as it is; Krok reads `activities.csv` and every activity file inside it.
- **Single activities:** GPX, TCX or FIT files (also `.gz`) from Strava or COROS Training Hub.
- Importing the same runs again never duplicates them; it adds detailed data to runs that only had a summary.
- Runs on a day with a planned session are logged against it automatically.

## What Krok works out

| Number | How |
| --- | --- |
| Training load | Banister TRIMP from heart rate (time weighted more steeply near max) |
| Fitness / fatigue | 42-day and 7-day exponentially weighted averages of daily load; their ratio is comparable with COROS's Intensity Trend |
| VDOT, pace zones, race predictions | Daniels & Gilbert formulas from your best effort of the last 4 months (sea-level runs) |
| Max HR | Highest 15-second average in the last 12 months |
| Threshold HR | Middle of: 90% of max HR, HR at threshold pace from steady km splits, highest 20-minute HR at threshold pace or faster |
| HR zones | % of threshold HR: <85, 85–89, 90–94, 95–99, 100+ |
| Aerobic efficiency | Pace converted to a fixed heart rate (80% of threshold HR) via heart-rate reserve and the oxygen cost of running; 4-week median |
| Pace discipline | Easy runs: share of time faster than easy pace or above Z2. Workouts: average pace of the fast parts against the target in the session's title |

Runs above 1,200 m altitude count for load but are left out of fitness estimates.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `app.css` | App shell and styles |
| `app.js` | Screens and logic |
| `analysis.js` | All calculations |
| `charts.js` | SVG charts |
| `streams.js` | Second-by-second data → compact per-run metrics |
| `importers.js`, `fit.js` | Strava zip, CSV, FIT, GPX, TCX import |
| `plan.js`, `guide.js` | Default training plan and session-type explanations |
| `db.js` | On-device storage (IndexedDB) |
| `sw.js` | Offline support. Change `VERSION` whenever a file changes. |
| `manifest.webmanifest`, `*.png` | Home Screen name and icons |
