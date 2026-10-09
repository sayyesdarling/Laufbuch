// Turns a second-by-second activity stream into compact metrics that the analysis can
// reuse without loading the stream again: time per heart-rate value, time per pace,
// best efforts, km splits, cardiac drift, altitude.

export const HR_MIN = 30, HR_MAX = 230;                 // heart-rate histogram, 1 bpm bins
export const PACE_MIN = 150, PACE_STEP = 5, PACE_BINS = 90; // pace histogram, 2:30–10:00 /km in 5 s bins
export const BEST_DISTS = [400, 1000, 1609.344, 3000, 5000, 10000, 15000, 21097.5, 30000, 42195];

function trim(arr) {
  let a = 0, b = arr.length - 1;
  while (a <= b && !arr[a]) a++;
  while (b >= a && !arr[b]) b--;
  if (a > b) return null;
  return [a].concat(arr.slice(a, b + 1).map(x => Math.round(x)));
}

// Expand a trimmed histogram back to [ {index, seconds} ] pairs.
export function eachBin(h, fn) {
  if (!h) return;
  const off = h[0];
  for (let i = 1; i < h.length; i++) if (h[i]) fn(off + i - 1, h[i]);
}

function bestEfforts(t, d) {
  const out = {};
  const total = d[d.length - 1] - d[0];
  for (const D of BEST_DISTS) {
    if (total < D) break;
    let best = Infinity, i = 0;
    for (let k = 1; k < d.length; k++) {
      while (i + 1 < k && d[k] - d[i + 1] >= D) i++;
      if (d[k] - d[i] >= D) {
        const over = d[k] - d[i] - D;
        const seg = d[i + 1] - d[i];
        const tStart = seg > 0 ? t[i] + (t[i + 1] - t[i]) * Math.min(1, over / seg) : t[i];
        const sec = t[k] - tStart;
        if (sec > 0 && sec < best) best = sec;
      }
    }
    // Faster than 6.5 m/s over these distances is a GPS glitch, not a run.
    if (best < Infinity && D / best <= 6.5) out[D] = Math.round(best);
  }
  return out;
}

function kmSplits(t, d, hr) {
  const out = [];
  const base = d[0];
  let target = 1000, prevT = t[0], hrS = 0, hrW = 0;
  for (let k = 1; k < d.length; k++) {
    const dt = t[k] - t[k - 1];
    if (hr && hr[k] != null && dt > 0 && dt <= 30) { const w = Math.min(dt, 10); hrS += hr[k] * w; hrW += w; }
    while (d[k] - base >= target) {
      const seg = d[k] - d[k - 1];
      const frac = seg > 0 ? (target - (d[k - 1] - base)) / seg : 1;
      const tc = t[k - 1] + (t[k] - t[k - 1]) * Math.max(0, Math.min(1, frac));
      out.push([Math.round(tc - prevT), hrW ? Math.round(hrS / hrW) : null]);
      prevT = tc; target += 1000; hrS = 0; hrW = 0;
    }
  }
  return out;
}

function rollingMaxAvg(t, v, windowSec, minCover) {
  // Highest time-weighted average of v over any window of `windowSec` seconds.
  let best = null, sum = 0, w = 0, j = 1;
  const contrib = [];
  for (let k = 1; k < t.length; k++) {
    const dt = t[k] - t[k - 1];
    const ok = v[k] != null && dt > 0 && dt <= 30;
    const c = ok ? Math.min(dt, 10) : 0;
    contrib[k] = c;
    sum += ok ? v[k] * c : 0; w += c;
    while (j < k && t[k] - t[j] > windowSec) { sum -= contrib[j] ? v[j] * contrib[j] : 0; w -= contrib[j] || 0; j++; }
    if (t[k] - t[j - 1] >= windowSec * 0.98 && w >= windowSec * minCover) {
      const avg = sum / w;
      if (best == null || avg > best.avg) best = { avg, from: j - 1, to: k };
    }
  }
  return best;
}

export function processStream(s) {
  const t = s.t;
  const n = t.length;
  if (!t || n < 30) return null;
  let d = null;
  if (s.d && s.d.some(v => v != null)) {
    d = new Array(n);
    let last = null;
    for (let i = 0; i < n; i++) { let v = s.d[i]; if (v == null || (last != null && v < last)) v = last; d[i] = v; last = v; }
    const first = d.find(v => v != null) || 0;
    for (let i = 0; i < n && d[i] == null; i++) d[i] = first;
  }
  const hr = s.hr ? s.hr.map(h => (h != null && h >= HR_MIN && h <= HR_MAX ? h : null)) : null;
  const alt = s.alt;

  const hrHist = new Array(HR_MAX - HR_MIN + 1).fill(0);
  const paceHist = new Array(PACE_BINS).fill(0);
  const movingFlag = new Uint8Array(n);
  let moving = 0, hrTime = 0, hrSum = 0, vS = 0, v2S = 0, vW = 0, j = 0;

  for (let i = 1; i < n; i++) {
    const dt = t[i] - t[i - 1];
    if (dt <= 0 || dt > 30) continue;
    const w = Math.min(dt, 10);
    const h = hr ? hr[i] : null;
    if (h != null) { hrHist[h - HR_MIN] += w; hrTime += w; hrSum += h * w; }
    if (d) {
      while (j + 1 < i && t[i] - t[j + 1] >= 10) j++;
      const span = t[i] - t[j];
      const v10 = span > 0 ? (d[i] - d[j]) / span : 0;
      if (v10 > 1.0) { moving += dt; movingFlag[i] = 1; }
      if (v10 >= 1.67 && v10 <= 7) {
        const b = Math.floor((1000 / v10 - PACE_MIN) / PACE_STEP);
        if (b >= 0 && b < PACE_BINS) paceHist[b] += w;
        vS += v10 * w; v2S += v10 * v10 * w; vW += w;
      }
    }
  }

  const m = { v: 2, hrHist: trim(hrHist), paceHist: trim(paceHist) };
  m.avgHr = hrTime ? Math.round(hrSum / hrTime) : null;
  m.moving = Math.round(moving);
  if (vW) { const mean = vS / vW; m.cv = Math.round(Math.sqrt(Math.max(0, v2S / vW - mean * mean)) / mean * 1000) / 1000; }

  if (d) {
    m.dist = Math.round(d[n - 1] - d[0]);
    m.best = bestEfforts(t, d);
    m.splits = kmSplits(t, d, hr);

    // Cardiac drift: speed per heartbeat in the first vs second half, after a 10-minute warm-up.
    if (hr && moving >= 40 * 60) {
      let mt = 0;
      const halves = [{ d: 0, t: 0, h: 0, hw: 0 }, { d: 0, t: 0, h: 0, hw: 0 }];
      const usable = moving - 600;
      for (let i = 1; i < n; i++) {
        if (!movingFlag[i]) continue;
        const dt = t[i] - t[i - 1];
        if (dt <= 0 || dt > 30) continue;
        mt += dt;
        if (mt < 600) continue;
        const half = halves[mt - 600 < usable / 2 ? 0 : 1];
        half.d += d[i] - d[i - 1]; half.t += dt;
        if (hr[i] != null) { half.h += hr[i] * dt; half.hw += dt; }
      }
      if (halves[0].hw && halves[1].hw && halves[0].t && halves[1].t) {
        const ef = x => (x.d / x.t) / (x.h / x.hw);
        const e1 = ef(halves[0]), e2 = ef(halves[1]);
        m.decoup = Math.round((e1 - e2) / e1 * 1000) / 10;
      }
    }
  }

  if (hr) {
    const r15 = rollingMaxAvg(t, hr, 15, 0.6);
    if (r15) m.maxHr15 = Math.round(r15.avg);
    const r20 = rollingMaxAvg(t, hr, 1200, 0.8);
    if (r20) {
      const sp = d ? (d[r20.to] - d[r20.from]) / (t[r20.to] - t[r20.from]) : null;
      m.best20 = { hr: Math.round(r20.avg), v: sp ? Math.round(sp * 100) / 100 : null };
    }
  }

  if (alt) {
    const a = alt.filter(x => x != null && x > -500 && x < 9000).sort((x, y) => x - y);
    if (a.length) m.altMed = Math.round(a[Math.floor(a.length / 2)]);
  }

  // Downsampled copy (one point per 5 s) for per-run charts.
  const keep = { t: [], d: d ? [] : null, hr: hr ? [] : null, alt: alt ? [] : null };
  let lastKept = -Infinity;
  for (let i = 0; i < n; i++) {
    if (t[i] - lastKept < 5 && i !== n - 1) continue;
    lastKept = t[i];
    keep.t.push(Math.round(t[i]));
    if (keep.d) keep.d.push(Math.round(d[i] * 10) / 10);
    if (keep.hr) keep.hr.push(hr[i]);
    if (keep.alt) keep.alt.push(alt[i] != null ? Math.round(alt[i]) : null);
  }
  return { metrics: m, small: keep };
}

// Cumulative distance from GPS points (used for GPX files).
export function distFromLatLon(lat, lon) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const out = [0];
  for (let i = 1; i < lat.length; i++) {
    const a = { lat: lat[i - 1], lon: lon[i - 1] }, b = { lat: lat[i], lon: lon[i] };
    if (isNaN(a.lat) || isNaN(b.lat)) { out.push(out[i - 1]); continue; }
    const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
    out.push(out[i - 1] + 2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
  }
  return out;
}
