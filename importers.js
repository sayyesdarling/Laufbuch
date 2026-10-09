// Turns exported files into activity records.
// Supported: .gpx, .tcx, .fit (each optionally .gz), and Strava's bulk-export activities.csv.

import { parseFIT } from "./fit.js";

export function localISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function isRunName(s) { return /run|lauf|jog|carrera|correr/i.test(s || ""); }

function haversine(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function climb(eles) {
  // Sum of rises, ignoring wobble under 2 m.
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
  const pts = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(text))) {
    const lat = parseFloat((m[1].match(/lat="([^"]+)"/) || [])[1]);
    const lon = parseFloat((m[1].match(/lon="([^"]+)"/) || [])[1]);
    const time = tag(m[2], "time");
    const ele = tag(m[2], "ele");
    const hr = tag(m[2], "hr");
    pts.push({ lat, lon, t: time ? Date.parse(time) : null, ele: ele != null ? parseFloat(ele) : null, hr: hr != null ? parseInt(hr, 10) : null });
  }
  if (!pts.length) throw new Error("No track points found");
  let dist = 0, moving = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (isNaN(a.lat) || isNaN(b.lat)) continue;
    const d = haversine(a, b);
    dist += d;
    if (a.t != null && b.t != null) {
      const dt = (b.t - a.t) / 1000;
      if (dt > 0 && dt < 60 && d / dt > 0.8) moving += dt;
    }
  }
  const times = pts.map(p => p.t).filter(t => t != null);
  const hrs = pts.map(p => p.hr).filter(h => h != null && h > 0);
  const startTime = times.length ? new Date(times[0]) : null;
  const metaTime = tag(text, "time");
  const start = startTime || (metaTime ? new Date(metaTime) : null);
  const run = isRunName(type) || (!type && isRunName(name));
  return {
    start,
    name,
    sport: run ? "Run" : /bik|cycl|ride/i.test(type) ? "Ride" : type ? type.replace(/^\w/, c => c.toUpperCase()) : "Activity",
    isRun: run,
    distanceM: dist,
    elapsedSec: times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0,
    movingSec: moving,
    avgHr: hrs.length ? Math.round(hrs.reduce((x, y) => x + y, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    elevGain: climb(pts.map(p => p.ele))
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
  const eles = [];
  const reAlt = /<AltitudeMeters>([^<]+)<\/AltitudeMeters>/g;
  while ((m = reAlt.exec(text))) eles.push(parseFloat(m[1]));
  const times = [];
  const reT = /<Time>([^<]+)<\/Time>/g;
  while ((m = reT.exec(text))) times.push(Date.parse(m[1]));
  const totalTime = laps.reduce((a, l) => a + l.time, 0);
  const hrLaps = laps.filter(l => l.avgHr);
  const notes = tag(text, "Notes");
  return {
    start: laps[0].start,
    name: notes ? decodeXml(notes).slice(0, 80) : "",
    sport: sport === "Running" ? "Run" : sport === "Biking" ? "Ride" : sport,
    isRun: /running/i.test(sport),
    distanceM: laps.reduce((a, l) => a + l.dist, 0),
    elapsedSec: times.length > 1 ? Math.max(totalTime, (times[times.length - 1] - times[0]) / 1000) : totalTime,
    movingSec: totalTime,
    avgHr: hrLaps.length ? Math.round(hrLaps.reduce((a, l) => a + l.avgHr * l.time, 0) / hrLaps.reduce((a, l) => a + l.time, 0)) : null,
    maxHr: laps.reduce((x, l) => l.maxHr ? Math.max(x || 0, l.maxHr) : x, null),
    elevGain: eles.length ? climb(eles) : null
  };
}

// ---- Strava bulk export: activities.csv ----

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
  // Strava writes these dates in UTC.
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
  const out = [], skipped = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = (row[iId] || "").trim();
    if (!id) continue;
    const start = parseStravaDate(row[iDate]);
    if (!start) { skipped.push(id); continue; }
    // Strava's export has two Distance columns: kilometres first, metres later.
    let distM = null;
    if (iDist.length > 1 && num(row[iDist[1]]) != null) distM = num(row[iDist[1]]);
    else if (iDist.length) { const d = num(row[iDist[0]]); distM = d == null ? null : d > 500 ? d : d * 1000; }
    const elapsed = iElapsed.length ? num(row[iElapsed[0]]) : null;
    const moving = iMoving.length ? num(row[iMoving[0]]) : null;
    const type = (row[iType] || "").trim();
    out.push({
      id: "strava-" + id,
      source: "Strava export",
      start,
      name: (row[iName] || "").trim(),
      sport: type || "Activity",
      isRun: isRunName(type),
      distanceM: distM || 0,
      elapsedSec: elapsed || moving || 0,
      movingSec: moving || elapsed || 0,
      avgHr: iAvgHr.length ? num(row[iAvgHr[0]]) : null,
      maxHr: iMaxHr.length ? num(row[iMaxHr[0]]) : null,
      elevGain: iElev.length && num(row[iElev[0]]) != null ? Math.round(num(row[iElev[0]])) : null
    });
  }
  return { activities: out, skipped };
}

// ---- Dispatcher ----

async function gunzip(buf) {
  if (typeof DecompressionStream === "undefined") throw new Error("This device can't open .gz files. Unzip it first.");
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function finish(a, source, fileName) {
  if (!a.start || isNaN(a.start)) throw new Error("No start time in file");
  const rec = {
    id: a.id || ("act-" + a.start.toISOString().slice(0, 16) + "-" + Math.round(a.distanceM || 0)),
    source: a.source || source,
    file: fileName || null,
    start: a.start.toISOString(),
    date: localISO(a.start),
    name: a.name || "",
    sport: a.sport || "Activity",
    isRun: !!a.isRun,
    distanceKm: Math.round((a.distanceM || 0) / 10) / 100,
    movingSec: Math.round(a.movingSec || 0),
    elapsedSec: Math.round(a.elapsedSec || 0),
    avgHr: a.avgHr ? Math.round(a.avgHr) : null,
    maxHr: a.maxHr ? Math.round(a.maxHr) : null,
    elevGain: a.elevGain != null ? a.elevGain : null,
    importedAt: new Date().toISOString()
  };
  return rec;
}

// files: array of { name, buffer: ArrayBuffer }
export async function parseFiles(files) {
  const activities = [], problems = [];
  for (const f of files) {
    let name = f.name || "file";
    let buf = f.buffer;
    try {
      let lower = name.toLowerCase();
      if (lower.endsWith(".zip")) throw new Error("Unzip the archive first (tap it in the Files app), then import activities.csv or the files inside.");
      if (lower.endsWith(".gz")) { buf = await gunzip(buf); lower = lower.slice(0, -3); }
      const head = new Uint8Array(buf.slice(0, 16));
      const isFit = lower.endsWith(".fit") || (head.length >= 12 && String.fromCharCode(head[8], head[9], head[10], head[11]) === ".FIT");
      if (isFit) { activities.push(finish(parseFIT(buf), "FIT file", name)); continue; }
      const text = new TextDecoder("utf-8").decode(buf);
      if (lower.endsWith(".csv")) {
        const r = parseStravaCSV(text);
        r.activities.forEach(a => activities.push(finish(a, "Strava export", name)));
        if (r.skipped.length) problems.push({ name, reason: r.skipped.length + " rows had a date format the app couldn't read" });
        continue;
      }
      if (lower.endsWith(".gpx") || /<gpx[\s>]/.test(text.slice(0, 2000))) { activities.push(finish(parseGPX(text), "GPX file", name)); continue; }
      if (lower.endsWith(".tcx") || /TrainingCenterDatabase/.test(text.slice(0, 2000))) { activities.push(finish(parseTCX(text), "TCX file", name)); continue; }
      throw new Error("Not a GPX, TCX, FIT or Strava CSV file");
    } catch (e) {
      problems.push({ name, reason: e.message || String(e) });
    }
  }
  return { activities, problems };
}
