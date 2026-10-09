// Turns exported files into activity records.
// Supported: Strava's archive .zip (read directly), activities.csv, and .gpx / .tcx / .fit
// files (each optionally .gz). Files with second-by-second data also get detailed metrics.

import { parseFIT } from "./fit.js";
import { processStream, distFromLatLon } from "./streams.js";

export function localISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const isRunName = s => /run|lauf|jog|carrera|correr/i.test(s || "");
export const baseName = n => String(n || "").split(/[\\/]/).pop();
export const fileKey = n => baseName(n).toLowerCase().replace(/\.gz$/, "");

function climb(eles) {
  let gain = 0, ref = null;
  for (const e of eles) {
    if (e == null || isNaN(e)) continue;
    if (ref == null) { ref = e; continue; }
    if (e - ref >= 2) { gain += e - ref; ref = e; }
    else if (ref - e >= 2) ref = e;
  }
  return Math.round(gain);
}

function tag(src, name) {
  const m = src.match(new RegExp("<(?:\\w+:)?" + name + "\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?" + name + ">"));
  return m ? m[1].trim() : null;
}

function decodeXml(s) {
  return (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function parseGPX(text) {
  const trk = tag(text, "trk") || text;
  const name = decodeXml(tag(trk, "name") || "");
  const type = decodeXml(tag(trk, "type") || "");
  const lat = [], lon = [], tt = [], ele = [], hr = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(text))) {
    const time = tag(m[2], "time");
    const t = time ? Date.parse(time) : NaN;
    if (isNaN(t)) continue;
    lat.push(parseFloat((m[1].match(/lat="([^"]+)"/) || [])[1]));
    lon.push(parseFloat((m[1].match(/lon="([^"]+)"/) || [])[1]));
    tt.push(t);
    const e = tag(m[2], "ele"); ele.push(e != null ? parseFloat(e) : null);
    const h = tag(m[2], "hr"); hr.push(h != null ? parseInt(h, 10) : null);
  }
  if (tt.length < 2) throw new Error("No timed track points found");
  const d = distFromLatLon(lat, lon);
  const t0 = tt[0];
  const stream = { t: tt.map(x => (x - t0) / 1000), d, hr: hr.some(x => x != null) ? hr : null, alt: ele.some(x => x != null) ? ele : null };
  let moving = 0;
  for (let i = 1; i < tt.length; i++) {
    const dt = (tt[i] - tt[i - 1]) / 1000;
    if (dt > 0 && dt < 60 && (d[i] - d[i - 1]) / dt > 0.8) moving += dt;
  }
  const hrs = hr.filter(h => h != null && h > 0);
  const run = isRunName(type) || (!type && isRunName(name));
  return {
    start: new Date(t0),
    name,
    sport: run ? "Run" : /bik|cycl|ride/i.test(type) ? "Ride" : type ? type.replace(/^\w/, c => c.toUpperCase()) : "Activity",
    isRun: run,
    distanceM: d[d.length - 1],
    elapsedSec: (tt[tt.length - 1] - t0) / 1000,
    movingSec: moving,
    avgHr: hrs.length ? Math.round(hrs.reduce((x, y) => x + y, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    elevGain: climb(ele),
    stream
  };
}

export function parseTCX(text) {
  const act = text.match(/<Activity\b[^>]*Sport="([^"]*)"/);
  const sport = act ? act[1] : "Other";
  const laps = [];
  const re = /<Lap\b([^>]*)>([\s\S]*?)<\/Lap>/g;
  let m;
  while ((m = re.exec(text))) {
    const head = m[2].split(/<Track\b/)[0];
    const st = (m[1].match(/StartTime="([^"]+)"/) || [])[1];
    const avgBlock = tag(head, "AverageHeartRateBpm");
    const maxBlock = tag(head, "MaximumHeartRateBpm");
    laps.push({
      start: st ? new Date(st) : null,
      time: parseFloat(tag(head, "TotalTimeSeconds") || "0"),
      dist: parseFloat(tag(head, "DistanceMeters") || "0"),
      avgHr: avgBlock ? parseInt(tag(avgBlock, "Value"), 10) : null,
      maxHr: maxBlock ? parseInt(tag(maxBlock, "Value"), 10) : null
    });
  }
  if (!laps.length) throw new Error("No laps found");
  const tt = [], d = [], hr = [], ele = [];
  const reP = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
  while ((m = reP.exec(text))) {
    const time = tag(m[1], "Time");
    const t = time ? Date.parse(time) : NaN;
    if (isNaN(t)) continue;
    tt.push(t);
    const dm = tag(m[1], "DistanceMeters"); d.push(dm != null ? parseFloat(dm) : null);
    const hb = tag(m[1], "HeartRateBpm"); hr.push(hb ? parseInt(tag(hb, "Value"), 10) : null);
    const al = tag(m[1], "AltitudeMeters"); ele.push(al != null ? parseFloat(al) : null);
  }
  const t0 = tt.length ? tt[0] : null;
  const stream = tt.length > 30 && d.some(x => x != null) ? { t: tt.map(x => (x - t0) / 1000), d, hr: hr.some(x => x != null) ? hr : null, alt: ele.some(x => x != null) ? ele : null } : null;
  const totalTime = laps.reduce((a, l) => a + l.time, 0);
  const hrLaps = laps.filter(l => l.avgHr);
  const notes = tag(text, "Notes");
  return {
    start: laps[0].start || (t0 ? new Date(t0) : null),
    name: notes ? decodeXml(notes).slice(0, 80) : "",
    sport: sport === "Running" ? "Run" : sport === "Biking" ? "Ride" : sport,
    isRun: /running/i.test(sport),
    distanceM: laps.reduce((a, l) => a + l.dist, 0),
    elapsedSec: tt.length > 1 ? Math.max(totalTime, (tt[tt.length - 1] - t0) / 1000) : totalTime,
    movingSec: totalTime,
    avgHr: hrLaps.length ? Math.round(hrLaps.reduce((a, l) => a + l.avgHr * l.time, 0) / hrLaps.reduce((a, l) => a + l.time, 0)) : null,
    maxHr: laps.reduce((x, l) => l.maxHr ? Math.max(x || 0, l.maxHr) : x, null),
    elevGain: ele.length ? climb(ele) : null,
    stream
  };
}

// ---- Strava archive: activities.csv ----

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === "\"") { if (text[i + 1] === "\"") { field += "\""; i++; } else q = false; }
      else field += c;
    } else if (c === "\"") q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || "").trim());
}

const MONTHS = {
  jan: 0, january: 0, januar: 0, feb: 1, february: 1, februar: 1, mar: 2, march: 2, mär: 2, märz: 2, maerz: 2,
  apr: 3, april: 3, may: 4, mai: 4, jun: 5, june: 5, juni: 5, jul: 6, july: 6, juli: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, okt: 9, oktober: 9, nov: 10, november: 10,
  dec: 11, december: 11, dez: 11, dezember: 11
};

export function parseStravaDate(s) {
  if (!s) return null;
  s = s.trim();
  let m = s.match(/^([A-Za-zäÄ]+)\.?\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  let mon, day, year, h, mi, se, ap;
  if (m) { [, mon, day, year, h, mi, se, ap] = m; }
  else if ((m = s.match(/^(\d{1,2})\.?\s+([A-Za-zäÄ]+)\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i))) { [, day, mon, year, h, mi, se, ap] = m; }
  else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/))) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  } else {
    const t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }
  const mo = MONTHS[mon.toLowerCase()];
  if (mo == null) return null;
  let hour = +h;
  if (ap) { ap = ap.toUpperCase(); if (ap === "PM" && hour < 12) hour += 12; if (ap === "AM" && hour === 12) hour = 0; }
  return new Date(Date.UTC(+year, mo, +day, hour, +mi, +(se || 0)));
}

function num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, "");
  if (!s) return null;
  const n = parseFloat(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

export function parseStravaCSV(text) {
  const rows = parseCSV(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new Error("The CSV file is empty");
  const head = rows[0].map(h => h.trim());
  const idx = name => head.reduce((a, h, i) => (h.toLowerCase() === name.toLowerCase() ? a.concat(i) : a), []);
  const iId = idx("Activity ID")[0], iDate = idx("Activity Date")[0], iName = idx("Activity Name")[0], iType = idx("Activity Type")[0];
  if (iId == null || iDate == null) throw new Error("This doesn't look like Strava's activities.csv");
  const iElapsed = idx("Elapsed Time"), iMoving = idx("Moving Time"), iDist = idx("Distance");
  const iAvgHr = idx("Average Heart Rate"), iMaxHr = idx("Max Heart Rate"), iElev = idx("Elevation Gain");
  const iFile = idx("Filename")[0], iRE = idx("Relative Effort"), iHigh = idx("Elevation High")[0], iLow = idx("Elevation Low")[0];
  const out = [], skipped = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = (row[iId] || "").trim();
    if (!id) continue;
    const start = parseStravaDate(row[iDate]);
    if (!start) { skipped.push(id); continue; }
    let distM = null;
    if (iDist.length > 1 && num(row[iDist[1]]) != null) distM = num(row[iDist[1]]);
    else if (iDist.length) { const dd = num(row[iDist[0]]); distM = dd == null ? null : dd > 500 ? dd : dd * 1000; }
    const elapsed = iElapsed.length ? num(row[iElapsed[0]]) : null;
    const moving = iMoving.length ? num(row[iMoving[0]]) : null;
    const type = (row[iType] || "").trim();
    const hi = iHigh != null ? num(row[iHigh]) : null, lo = iLow != null ? num(row[iLow]) : null;
    const re = iRE.map(i => num(row[i])).find(v => v != null);
    out.push({
      id: "strava-" + id,
      source: "Strava",
      srcFile: iFile != null && row[iFile] ? row[iFile].trim() : null,
      start,
      name: (row[iName] || "").trim(),
      sport: type || "Activity",
      isRun: isRunName(type),
      distanceM: distM || 0,
      elapsedSec: elapsed || moving || 0,
      movingSec: moving || elapsed || 0,
      avgHr: iAvgHr.length ? num(row[iAvgHr[0]]) : null,
      maxHr: iMaxHr.length ? num(row[iMaxHr[0]]) : null,
      elevGain: iElev.length && num(row[iElev[0]]) != null ? Math.round(num(row[iElev[0]])) : null,
      alt: hi != null && lo != null ? Math.round((hi + lo) / 2) : null,
      relEffort: re != null ? Math.round(re) : null
    });
  }
  return { activities: out, skipped };
}

// ---- Zip archives (read entry by entry, without loading the whole file) ----

async function inflate(buf, format) {
  if (typeof DecompressionStream === "undefined") throw new Error("This device can't unpack compressed files. Update iOS, or unzip the files first.");
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream(format));
  return await new Response(stream).arrayBuffer();
}

const WANTED = /(^|\/)activities\.csv$|\.(fit|gpx|tcx)(\.gz)?$/i;

async function zipEntries(file) {
  const size = file.size;
  const tailLen = Math.min(size, 65557);
  const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This zip file looks damaged.");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff) throw new Error("This archive is too large to read directly. Unzip it, then import activities.csv and the files in the activities folder.");
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    const csize = cd.getUint32(p + 20, true);
    const usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    const lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/") || !WANTED.test(name) || /__MACOSX/.test(name)) continue;
    out.push({
      name, size: usize,
      read: async () => {
        const lh = new DataView(await file.slice(lho, lho + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("Damaged entry in the zip");
        const startAt = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = await file.slice(startAt, startAt + csize).arrayBuffer();
        if (method === 0) return raw;
        if (method === 8) return inflate(raw, "deflate-raw");
        throw new Error("Unsupported compression in the zip");
      }
    });
  }
  return out;
}

// Turns picked files into readable entries; zips are opened and filtered to activity data.
export async function expandFiles(files) {
  const entries = [], problems = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      try { (await zipEntries(f)).forEach(e => entries.push(e)); }
      catch (e) { problems.push({ name: f.name, reason: e.message || String(e) }); }
    } else entries.push({ name: f.name, size: f.size, read: () => f.arrayBuffer() });
  }
  // The activity list goes first so that files can be matched to it by name.
  entries.sort((a, b) => (/\.csv$/i.test(b.name) ? 1 : 0) - (/\.csv$/i.test(a.name) ? 1 : 0));
  return { entries, problems };
}

function finish(a, source, fileName) {
  if (!a.start || isNaN(a.start)) throw new Error("No start time in file");
  const rec = {
    id: a.id || ("act-" + a.start.toISOString().slice(0, 16) + "-" + Math.round(a.distanceM || 0)),
    source: a.source || source,
    srcFile: a.srcFile ? fileKey(a.srcFile) : fileName ? fileKey(fileName) : null,
    start: a.start.toISOString(),
    // The watch's own time zone when the file has it, so runs keep their day when you travel.
    date: a.tzOffsetSec != null ? new Date(a.start.getTime() + a.tzOffsetSec * 1000).toISOString().slice(0, 10) : localISO(a.start),
    tz: a.tzOffsetSec != null ? a.tzOffsetSec : null,
    name: a.name || "",
    sport: a.sport || "Activity",
    isRun: !!a.isRun,
    distanceKm: Math.round((a.distanceM || 0) / 10) / 100,
    movingSec: Math.round(a.movingSec || 0),
    elapsedSec: Math.round(a.elapsedSec || 0),
    avgHr: a.avgHr ? Math.round(a.avgHr) : null,
    maxHr: a.maxHr ? Math.round(a.maxHr) : null,
    elevGain: a.elevGain != null ? a.elevGain : null,
    alt: a.alt != null ? a.alt : null,
    relEffort: a.relEffort != null ? a.relEffort : null,
    importedAt: new Date().toISOString()
  };
  let small = null;
  if (a.stream) {
    const p = processStream(a.stream);
    if (p) {
      rec.m = p.metrics;
      small = p.small;
      if (p.metrics.altMed != null) rec.alt = p.metrics.altMed;
      if (!rec.avgHr && p.metrics.avgHr) rec.avgHr = p.metrics.avgHr;
    }
  }
  return { rec, small };
}

// Reads one entry and returns the activities in it.
export async function parseEntry(entry) {
  const items = [], problems = [];
  const name = entry.name || "file";
  try {
    let lower = baseName(name).toLowerCase();
    let buf = await entry.read();
    if (lower.endsWith(".zip")) throw new Error("Zip files inside zip files aren't supported.");
    if (lower.endsWith(".gz")) { buf = await inflate(buf, "gzip"); lower = lower.slice(0, -3); }
    const head = new Uint8Array(buf.slice(0, 16));
    const isFit = lower.endsWith(".fit") || (head.length >= 12 && String.fromCharCode(head[8], head[9], head[10], head[11]) === ".FIT");
    if (isFit) { items.push(finish(parseFIT(buf), "FIT file", name)); return { items, problems }; }
    const text = new TextDecoder("utf-8").decode(buf);
    if (lower.endsWith(".csv")) {
      const r = parseStravaCSV(text);
      r.activities.forEach(a => items.push(finish(a, "Strava", null)));
      if (r.skipped.length) problems.push({ name, reason: r.skipped.length + " rows had a date the app couldn't read" });
      return { items, problems };
    }
    if (lower.endsWith(".gpx") || /<gpx[\s>]/.test(text.slice(0, 2000))) { items.push(finish(parseGPX(text), "GPX file", name)); return { items, problems }; }
    if (lower.endsWith(".tcx") || /TrainingCenterDatabase/.test(text.slice(0, 2000))) { items.push(finish(parseTCX(text), "TCX file", name)); return { items, problems }; }
    throw new Error("Not a GPX, TCX, FIT or Strava CSV file");
  } catch (e) {
    problems.push({ name: baseName(name), reason: e.message || String(e) });
  }
  return { items, problems };
}
