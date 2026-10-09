# Laufbuch

A small offline web app for your iPhone: the training plan, a run log, imports from Strava and COROS, and a guide to the different kinds of sessions.

Everything you log is stored on the phone itself. Nothing is sent anywhere.

## Put it online (GitHub Pages, about 10 minutes, on your Mac)

1. Unzip `laufbuch.zip`. You get a folder called `laufbuch` with all the app's files side by side (no subfolders).
2. On github.com, click **+** (top right) → **New repository**.
   - Name: `laufbuch`
   - Visibility: **Public** (free GitHub Pages needs a public repository; only the app's code and the default plan are visible, never your log).
   - Leave everything else unticked and click **Create repository**.
3. On the new repository's page, click **uploading an existing file**.
4. Open the unzipped `laufbuch` folder in Finder, select **all the files inside it** and drag them onto the upload area.
5. Click **Commit changes**.
6. Go to **Settings** → **Pages**. Under *Build and deployment*, set **Source** to *Deploy from a branch*, branch **main**, folder **/ (root)**, and click **Save**.
7. After a minute or two the page shows your address, for example `https://YOUR-USERNAME.github.io/laufbuch/`.

## Install it on the iPhone

1. Open that address in **Safari** (it has to be Safari).
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open Laufbuch from the Home Screen icon from now on. Opened that way, it runs full-screen, works offline, and its storage is kept.

## Updating

When you get new files, upload them the same way (drag them onto the repository, overwrite, commit). The app notices the new version the next time you open it and shows a **Reload** bar.

## Your data

- Logged runs, imports and settings live in the app's storage on the phone.
- **Settings → Export backup** saves a `.json` file you can keep in iCloud Drive. **Restore a backup** brings it back, also on a new phone.
- Deleting the Home Screen icon deletes the app's data, so export a backup first.

## Importing runs

- **Whole Strava history:** strava.com → Settings → My Account → Download or Delete Your Account → Request your archive. Unzip the archive in the Files app and import `activities.csv`.
- **Single activities:** GPX, TCX or FIT files (also `.gz`) exported from Strava or COROS Training Hub.
- Runs that fall on a day with a planned session are logged against it automatically. Importing the same run twice is detected and skipped.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | App shell |
| `app.css` | Styles |
| `app.js` | Screens and logic |
| `plan.js` | Default training plan and pace zones |
| `guide.js` | Session-type explanations |
| `importers.js`, `fit.js` | File import (GPX, TCX, FIT, Strava CSV) |
| `db.js` | On-device storage |
| `sw.js` | Offline support. Change `VERSION` whenever a file changes. |
| `manifest.webmanifest`, `*.png` | Home Screen name and icons |
