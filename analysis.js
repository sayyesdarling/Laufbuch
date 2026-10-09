// Everything Krok works out from your runs: heart-rate and pace zones, threshold,
// fitness (VDOT), race predictions, training load, fitness/fatigue, efficiency and
// how closely runs matched the plan. All pure functions; no storage or DOM here.

import { HR_MIN, PACE_MIN, PACE_STEP, eachBin } from "./streams.js";
import { localISO } from "./importers.js";

/* ---------- running formulas (Daniels & Gilbert) ---------- */
export const vo2 = v => -4.60 + 0.182258 * v + 0.000104 * v * v;                 // ml/kg/min at v m/min
const pctMax = tMin => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
export const vdotOf = (meters, sec) => { const t = sec / 60; return vo2(meters / t) / pctMax(t); };
export const vAt = x => (-0.182258 + Math.sqrt(0.182258 * 0.182258 + 4 * 0.000104 * (x + 4.6))) / (2 * 0.000104);
export const paceAt = (vdot, frac) => 60000 / vAt(vdot * frac);                 // seconds per km
export function predict(meters, vdot) {
  let lo = meters / 7, hi = meters / 1.2;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (vdotOf(meters, mid) > vdot) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/* ---------- dates ---------- */
const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return localISO(d); };
export const mondayOf = iso => { const d = parseISO(iso); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return localISO(d); };

/* ---------- small stats helpers ---------- */
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round5 = x => Math.round(x / 5) * 5;
function linfit(pts) {
  const n = pts.length; if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const vx = sxx - sx * sx / n, vy = syy - sy * sy / n, cxy = sxy - sx * sy / n;
  if (vx <= 0) return null;
  const b = cxy / vx, a = (sy - b * sx) / n;
  return { a, b, r2: vy > 0 ? (cxy * cxy) / (vx * vy) : 0, sdx: Math.sqrt(vx / n) };
}

export const ALTITUDE_M = 1200;
export const isAltitude = a => a.alt != null && a.alt >= ALTITUDE_M;
const EASY_TYPES = new Set(["easy", "recovery", "shakeout", "strides", "long", "wucd"]);
export const BEST_LABELS = { 1000: "1 km", 1609.344: "1 mile", 3000: "3 km", 5000: "5 km", 10000: "10 km", 15000: "15 km", 21097.5: "Half marathon", 30000: "30 km", 42195: "Marathon" };

/* ---------- the main pass ---------- */
export function analyze(acts, sessions, settings, today = localISO(new Date())) {
  const runs = acts.filter(a => a.isRun);
  const P = { today, notes: [] };
  const rest = Math.max(30, Math.min(90, +settings.restHr || 45));
  P.rest = rest;

  /* Max HR: highest 15-second average in the last 12 months (spikes filtered). */
  const yearAgo = addDays(today, -365);
  const fromStreams = acts.filter(a => a.date >= yearAgo && a.m && a.m.maxHr15 >= 120 && a.m.maxHr15 <= 225);
  let maxSrc = null, maxHr = null;
  if (fromStreams.length >= 3) {
    maxSrc = fromStreams.reduce((b, a) => (a.m.maxHr15 > b.m.maxHr15 ? a : b));
    maxHr = maxSrc.m.maxHr15;
  } else {
    const c = acts.filter(a => a.date >= yearAgo && a.maxHr >= 120 && a.maxHr <= 225).sort((x, y) => y.maxHr - x.maxHr);
    // With summary data only, skip the single highest value in case it's a sensor spike.
    const pick = c.length >= 5 ? c[1] : c[0];
    if (pick) { maxSrc = pick; maxHr = pick.maxHr; }
  }
  P.maxHr = { value: +settings.maxHrOverride || maxHr || 200, auto: maxHr, source: maxSrc, overridden: !!+settings.maxHrOverride };
  const HRmax = P.maxHr.value;

  /* VDOT from the best effort of the last 120 days (sea-level runs only). */
  const effortsIn = from => {
    const out = [];
    for (const a of runs) {
      if (a.date < from || a.date > today || isAltitude(a)) continue;
      if (a.m && a.m.best) {
        for (const D of [3000, 5000, 10000, 15000, 21097.5, 30000, 42195]) {
          const sec = a.m.best[D];
          if (sec) out.push({ a, D, sec, vdot: vdotOf(D, sec), inRun: Math.abs(a.distanceKm * 1000 - D) > D * 0.03 });
        }
      } else if (a.distanceKm >= 3 && (a.movingSec || a.elapsedSec)) {
        const sec = a.movingSec || a.elapsedSec;
        out.push({ a, D: a.distanceKm * 1000, sec, vdot: vdotOf(a.distanceKm * 1000, sec), inRun: false });
      }
    }
    return out.filter(e => e.vdot > 20 && e.vdot < 85);
  };
  let efforts = effortsIn(addDays(today, -120)), older = false;
  if (!efforts.length) { efforts = effortsIn(addDays(today, -365)); older = efforts.length > 0; }
  const bestEffort = efforts.reduce((b, e) => (!b || e.vdot > b.vdot ? e : b), null);
  P.vdot = bestEffort ? { value: Math.round(bestEffort.vdot * 10) / 10, effort: bestEffort, older } : null;

  if (P.vdot) {
    const v = P.vdot.value;
    const M = predict(42195, v) / 42.195;
    const T = paceAt(v, 0.87), I = paceAt(v, 0.97), R = paceAt(v, 1.05);
    P.paces = {
      easy: [paceAt(v, 0.66), paceAt(v, 0.59)],
      steady: [M, M + 20],
      threshold: [T - 4, T + 6],
      interval: [I - 3, I + 4],
      reps: [R - 3, R + 3],
      T, I, R, M
    };
    P.predictions = [5000, 10000, 21097.5, 42195].map(D => ({ D, label: BEST_LABELS[D], sec: predict(D, v) }));
  }
  const vT = P.paces ? 1000 / P.paces.T : null;                                      // threshold speed, m/s

  /* Heart rate vs speed from steady km splits of the last 90 days. */
  const from90 = addDays(today, -90);
  const pts = [];
  for (const a of runs) {
    if (a.date < from90 || isAltitude(a)) continue;
    if (a.m && a.m.splits && a.m.splits.length >= 3) {
      const sp = a.m.splits;
      for (let i = 2; i < sp.length; i++) {
        const [s, h] = sp[i], [s0] = sp[i - 1];
        if (!h || s < 150 || s > 600 || h < rest + 40) continue;
        if (Math.abs(s - s0) / s > 0.04) continue;
        pts.push([1000 / s, h]);
      }
    } else if (a.avgHr && a.movingSec >= 1200 && a.distanceKm > 0) pts.push([a.distanceKm * 1000 / a.movingSec, a.avgHr]);
  }
  const fit = pts.length >= 12 ? linfit(pts) : null;
  P.hrSpeed = fit && fit.b > 0 && fit.sdx > 0.12 ? { ...fit, n: pts.length } : null;

  /* Threshold heart rate: middle of up to three independent estimates. */
  const est = [];
  if (P.maxHr.auto || +settings.maxHrOverride) est.push({ v: Math.round(0.9 * HRmax), how: "90% of your max heart rate" });
  if (P.hrSpeed && vT) {
    const h = Math.round(P.hrSpeed.a + P.hrSpeed.b * vT);
    if (h > 0.8 * HRmax && h < 0.98 * HRmax) est.push({ v: h, how: "your heart rate at threshold pace, from " + P.hrSpeed.n + " steady kilometres" });
  }
  if (vT) {
    const hard = runs.filter(a => a.date >= addDays(today, -120) && !isAltitude(a) && a.m && a.m.best20 && a.m.best20.v && a.m.best20.v >= 0.97 * vT);
    if (hard.length) {
      const top = hard.reduce((b, a) => (a.m.best20.hr > b.m.best20.hr ? a : b));
      est.push({ v: top.m.best20.hr, how: "your highest 20-minute heart rate at threshold pace or faster (" + (top.name || "run") + ")" });
    }
  }
  const lthrAuto = est.length ? Math.round(median(est.map(e => e.v))) : null;
  P.lthr = { value: +settings.lthrOverride || lthrAuto || Math.round(0.9 * HRmax), auto: lthrAuto, estimates: est, overridden: !!+settings.lthrOverride };
  const L = P.lthr.value;
  P.zoneBounds = [Math.round(0.85 * L), Math.round(0.90 * L), Math.round(0.95 * L), L];
  const zb = P.zoneBounds;
  P.hrZones = [
    { n: 1, name: "Easy", lo: null, hi: zb[0] - 1 },
    { n: 2, name: "Aerobic", lo: zb[0], hi: zb[1] - 1 },
    { n: 3, name: "Tempo", lo: zb[1], hi: zb[2] - 1 },
    { n: 4, name: "Threshold", lo: zb[2], hi: zb[3] - 1 },
    { n: 5, name: "Above threshold", lo: zb[3], hi: null }
  ];
  const zoneOf = h => (h < zb[0] ? 0 : h < zb[1] ? 1 : h < zb[2] ? 2 : h < zb[3] ? 3 : 4);

  /* Training load per activity: Banister TRIMP (heart-rate reserve, exponentially weighted). */
  const w = h => { const r = (h - rest) / (HRmax - rest); if (r <= 0) return 0; const x = Math.min(r, 1.1); return x * 0.64 * Math.exp(1.92 * x); };
  const loadOf = a => {
    if (a.m && a.m.hrHist) { let s = 0; eachBin(a.m.hrHist, (i, sec) => { s += sec / 60 * w(HR_MIN + i); }); if (s > 0) return s; }
    const min = (a.movingSec || a.elapsedSec || 0) / 60;
    if (a.avgHr) return min * w(a.avgHr);
    if (a.isRun && a.distanceKm && a.movingSec && P.hrSpeed) return min * w(P.hrSpeed.a + P.hrSpeed.b * a.distanceKm * 1000 / a.movingSec);
    return min * w(rest + 0.55 * (HRmax - rest));
  };
  P.loadOf = new Map();
  const daily = {};
  for (const a of acts) { const l = loadOf(a); P.loadOf.set(a.id, l); daily[a.date] = (daily[a.date] || 0) + l; }

  /* Fitness (42-day) and fatigue (7-day) as exponentially weighted averages of daily load. */
  const dates = Object.keys(daily).sort();
  P.series = [];
  if (dates.length) {
    const kC = 1 - Math.exp(-1 / 42), kA = 1 - Math.exp(-1 / 7);
    let ctl = 0, atl = 0, d = dates[0];
    const end = today > dates[dates.length - 1] ? today : dates[dates.length - 1];
    let guard = 0;
    while (d <= end && guard++ < 8000) {
      const l = daily[d] || 0;
      ctl += (l - ctl) * kC; atl += (l - atl) * kA;
      P.series.push({ date: d, load: l, ctl, atl, ratio: ctl > 0.5 ? atl / ctl : null });
      d = addDays(d, 1);
    }
    P.historyDays = P.series.length;
  }
  const last = P.series.length ? P.series[P.series.length - 1] : null;
  if (last) {
    const pct = last.ratio != null ? last.ratio * 100 : null;
    let st;
    if (P.historyDays < 28 || last.ctl < 5) st = { key: "start", label: "Building a baseline", text: "Import more history so fitness and fatigue have something to compare against." };
    else if (pct >= 150) st = { key: "over", label: "Overload", text: "Recent load is far above what you're used to. This is where overuse injuries happen. Back off for a few days." };
    else if (pct >= 130) st = { key: "fast", label: "Building fast", text: "Productive, but aggressive. Don't stay here for more than a week or two, especially if you're injury-prone." };
    else if (pct >= 100) st = { key: "build", label: "Building", text: "You're training a bit more than your usual level, so fitness is rising." };
    else if (pct >= 80) st = { key: "keep", label: "Maintaining", text: "Load matches your usual level. Fitness holds steady." };
    else if (pct >= 50) st = { key: "fresh", label: "Fresh", text: "Lighter than usual. Good for recovering or racing; fitness slowly fades if it lasts more than two or three weeks." };
    else st = { key: "drop", label: "Detraining", text: "Much less than usual, so fitness is dropping. Fine for a planned break." };
    P.status = { ...st, ctl: last.ctl, atl: last.atl, form: last.ctl - last.atl, pct };
    const mon = mondayOf(today);
    let wk = 0;
    for (let x = mon; x <= today; x = addDays(x, 1)) wk += daily[x] || 0;
    P.week = { load: wk, maintain: last.ctl * 7, build: last.ctl * 7 * 1.3 };
  }

  /* Efficiency: pace at a fixed heart rate, from steady sea-level runs. */
  const refHr = round5(0.8 * L);
  P.refHr = refHr;
  const fr = (refHr - rest) / (HRmax - rest);
  const effPts = [];
  for (const a of runs) {
    const hr = a.m && a.m.avgHr ? a.m.avgHr : a.avgHr;
    const mov = a.m && a.m.moving ? a.m.moving : a.movingSec;
    const dist = a.m && a.m.dist ? a.m.dist : a.distanceKm * 1000;
    if (!hr || !mov || mov < 1200 || dist < 3000 || isAltitude(a)) continue;
    if (Math.abs(hr - refHr) > 18) continue;
    if (a.m && a.m.cv != null && a.m.cv > 0.15) continue;           // interval sessions
    const f = (hr - rest) / (HRmax - rest);
    if (f <= 0.2) continue;
    const v = dist / (mov / 60);
    const vRef = vAt(3.5 + (vo2(v) - 3.5) * fr / f);
    const pace = 60000 / vRef;
    if (pace > 180 && pace < 600) effPts.push({ date: a.date, pace, a });
  }
  effPts.sort((x, y) => (x.date < y.date ? -1 : 1));
  const trend = [];
  if (effPts.length) {
    let wkEnd = addDays(mondayOf(effPts[0].date), 6);
    while (wkEnd <= addDays(today, 6)) {
      const from = addDays(wkEnd, -27);
      const inWin = effPts.filter(p => p.date >= from && p.date <= wkEnd).map(p => p.pace);
      if (inWin.length >= 2) trend.push({ date: wkEnd > today ? today : wkEnd, pace: median(inWin), n: inWin.length });
      wkEnd = addDays(wkEnd, 7);
    }
  }
  P.efficiency = { refHr, points: effPts, trend };
  if (trend.length) {
    const now = trend[trend.length - 1];
    const back = trend.filter(t => t.date <= addDays(now.date, -56)).pop();
    P.efficiency.now = now;
    P.efficiency.change = back ? now.pace - back.pace : null;
    P.efficiency.since = back ? back.date : null;
  }

  /* Time in heart-rate zones per week (last 12 weeks) and the last 28 days. */
  const zoneTime = a => {
    const z = [0, 0, 0, 0, 0];
    if (a.m && a.m.hrHist) eachBin(a.m.hrHist, (i, sec) => { z[zoneOf(HR_MIN + i)] += sec; });
    else if (a.avgHr && (a.movingSec || a.elapsedSec)) z[zoneOf(a.avgHr)] += a.movingSec || a.elapsedSec;
    return z;
  };
  P.zoneTime = zoneTime;
  const thisMon = mondayOf(today);
  P.zoneWeeks = [];
  for (let i = 11; i >= 0; i--) P.zoneWeeks.push({ mon: addDays(thisMon, -7 * i), z: [0, 0, 0, 0, 0] });
  const z28 = [0, 0, 0, 0, 0];
  const from28 = addDays(today, -27);
  for (const a of runs) {
    if (a.date < P.zoneWeeks[0].mon) continue;
    const z = zoneTime(a);
    const wk = P.zoneWeeks.find(x => x.mon === mondayOf(a.date));
    if (wk) z.forEach((s, i) => { wk.z[i] += s; });
    if (a.date >= from28) z.forEach((s, i) => { z28[i] += s; });
  }
  const t28 = z28.reduce((x, y) => x + y, 0);
  P.split28 = t28 ? { easy: (z28[0] + z28[1]) / t28, moderate: z28[2] / t28, hard: (z28[3] + z28[4]) / t28, total: t28 } : null;

  /* Personal bests (all time) from best efforts inside runs and from whole races. */
  P.records = [];
  for (const D of [1000, 1609.344, 5000, 10000, 21097.5, 42195]) {
    let best = null;
    for (const a of runs) {
      let sec = a.m && a.m.best ? a.m.best[D] : null;
      if (!sec && !(a.m && a.m.best) && Math.abs(a.distanceKm * 1000 - D) <= D * 0.02) sec = a.movingSec || a.elapsedSec;
      if (sec && (!best || sec < best.sec)) best = { sec, a };
    }
    if (best) P.records.push({ D, label: BEST_LABELS[D], ...best });
  }

  const longest = runs.filter(a => a.date >= addDays(today, -56)).reduce((m, a) => Math.max(m, a.distanceKm || 0), 0);
  P.longest8w = longest;

  /* Plan check for every planned run that has an imported activity. */
  const byId = new Map(acts.map(a => [a.id, a]));
  P.checks = new Map();
  for (const s of sessions) {
    if (!s.activityId) continue;
    const a = byId.get(s.activityId);
    if (a) P.checks.set(s.id, planCheck(s, a, P));
  }
  const recentChecks = sessions.filter(s => s.date >= from28 && s.date <= today && P.checks.has(s.id)).map(s => ({ s, c: P.checks.get(s.id) }));
  P.discipline = {
    list: recentChecks,
    easy: recentChecks.filter(x => x.c.kind === "easy"),
    work: recentChecks.filter(x => x.c.kind === "work")
  };
  P.runCount = runs.length;
  P.detailCount = runs.filter(a => a.m).length;
  return P;
}

/* ---------- plan check ---------- */
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function parseTarget(s) {
  const text = (s.title || "") + " " + (s.detail || "");
  const m = text.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (m) {
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    return [Math.min(a, b), Math.max(a, b)];
  }
  const r = text.match(/(\d+)\s*m\s+in\s+(\d+)\s*[–-]\s*(\d+)\s*s/);
  if (r) { const d = +r[1] / 1000; return [+r[2] / d, +r[3] / d]; }
  return null;
}

function zoneTarget(type, P) {
  if (!P.paces) return null;
  if (type === "tempo" || type === "threshold") return P.paces.threshold;
  if (type === "intervals" || type === "fartlek") return P.paces.interval;
  if (type === "reps" || type === "hills") return P.paces.reps;
  if (type === "long-steady") return P.paces.steady;
  return null;
}

export function planCheck(s, a, P) {
  const hist = a.m && a.m.paceHist;
  const mov = a.m && a.m.moving ? a.m.moving : a.movingSec;
  const dist = a.m && a.m.dist ? a.m.dist : a.distanceKm * 1000;
  const avgPace = mov && dist ? mov / (dist / 1000) : null;
  if (s.type === "tt") {
    return { kind: "race", verdict: "info", text: avgPace ? `${mmss(avgPace)} /km average` : "Logged" };
  }
  if (EASY_TYPES.has(s.type)) {
    if (!P.paces) return { kind: "easy", verdict: "na", text: "Needs a recent hard effort to know your easy pace" };
    const fastLimit = P.paces.easy[0];
    const allow = s.type === "strides" ? 0.15 : 0.1;
    let share = null;
    if (hist) {
      let fast = 0, tot = 0;
      eachBin(hist, (i, sec) => { const p = PACE_MIN + (i + 0.5) * PACE_STEP; tot += sec; if (p < fastLimit - 5) fast += sec; });
      share = tot ? fast / tot : null;
    }
    let hrShare = null;
    if (a.m && a.m.hrHist && P.zoneBounds) {
      let hi = 0, tot = 0;
      eachBin(a.m.hrHist, (i, sec) => { tot += sec; if (HR_MIN + i >= P.zoneBounds[1]) hi += sec; });
      hrShare = tot ? hi / tot : null;
    }
    const alt = isAltitude(a);
    const tooFast = share != null ? share > allow : avgPace != null && avgPace < fastLimit;
    const tooHard = !alt && (hrShare != null ? hrShare > 0.2 : (a.avgHr && P.zoneBounds ? a.avgHr >= P.zoneBounds[1] : false));
    if (tooFast) {
      const where = alt ? " (and at altitude easy should be slower still)" : "";
      return { kind: "easy", verdict: "fast", share, hrShare, text: (share != null ? `Too fast for easy: ${Math.round(share * 100)}% of it faster than ${mmss(fastLimit)} /km` : `Too fast for easy: ${mmss(avgPace)} /km average, easy starts at ${mmss(fastLimit)}`) + where };
    }
    if (tooHard) return { kind: "easy", verdict: "fast", share, hrShare, text: `Heart rate too high for easy: ${Math.round((hrShare || 0) * 100)}% above ${P.zoneBounds[1]} bpm` };
    return { kind: "easy", verdict: "ok", share, hrShare, text: `Easy as planned${avgPace ? ` · ${mmss(avgPace)} /km` : ""}${alt ? " · at altitude" : ""}` };
  }
  const target = parseTarget(s) || zoneTarget(s.type, P);
  if (!target) return { kind: "work", verdict: "na", text: "No pace target to compare with" };
  if (!hist) return { kind: "work", verdict: "na", target, text: "Import this run's file to check the fast parts" };
  let sum = 0, tot = 0;
  eachBin(hist, (i, sec) => { const p = PACE_MIN + (i + 0.5) * PACE_STEP; if (p < target[1] + 15) { sum += p * sec; tot += sec; } });
  if (tot < 60) return { kind: "work", verdict: "slow", target, text: `Hardly any running at the target pace (${mmss(target[0])}–${mmss(target[1])})` };
  const work = sum / tot;
  const minutes = Math.round(tot / 60);
  if (work < target[0] - 4) return { kind: "work", verdict: "fast", target, work, text: `Fast parts ${mmss(work)} /km: ${Math.round(target[0] - work)} s faster than the ${mmss(target[0])}–${mmss(target[1])} target (${minutes} min)` };
  if (work > target[1] + 4) return { kind: "work", verdict: "slow", target, work, text: `Fast parts ${mmss(work)} /km: ${Math.round(work - target[1])} s slower than the ${mmss(target[0])}–${mmss(target[1])} target (${minutes} min)` };
  return { kind: "work", verdict: "ok", target, work, text: `On target: fast parts ${mmss(work)} /km for ${minutes} min` };
}
