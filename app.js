import { openDB, getAll, get, put, putMany, del, delMany, clearStore, getKV, setKV } from "./db.js";
import { DEFAULT_BLOCK, DEFAULT_SESSIONS, DEFAULT_SETTINGS, FALLBACK_ZONES } from "./plan.js";
import { TYPES, TYPE_ORDER, COMPARE } from "./guide.js";
import { expandFiles, parseEntry, localISO } from "./importers.js";
import { analyze, addDays, mondayOf, isAltitude, BEST_LABELS } from "./analysis.js";
import { lineChart, barChart, bindCharts, dateLabel } from "./charts.js";

const APP_NAME = "Krok";
const APP_VERSION = "2.0.0";
const S = { sessions: [], acts: [], settings: null, block: null, view: "plan", histFilter: "runs", statsRange: 90, P: null };

/* ---------------- helpers ---------------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const todayISO = () => localISO(new Date());
const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtKm = n => (Math.round(n * 10) / 10).toString();
const kmLabel = s => s.kmLabel || fmtKm(s.km || 0);
const typeOf = s => TYPES[s.type] || TYPES.easy;
const tagOf = s => s.label || typeOf(s).name;
const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const sessionById = id => S.sessions.find(s => s.id === id);
const actById = id => S.acts.find(a => a.id === id);
const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
const mmss = sec => { sec = Math.round(sec); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
const fmtPace = (sec, km) => (sec && km ? mmss(sec / km) : "");
const range = r => `${mmss(r[0])}–${mmss(r[1])}`;
function parseClock(str) {
  if (str == null) return null;
  const p = String(str).trim().replace(/[’'"]/g, ":").split(":").filter(x => x !== "").map(Number);
  if (!p.length || p.some(isNaN)) return null;
  return p.reduce((a, b) => a * 60 + b, 0);
}
function dayLabel(iso) { const d = parseISO(iso); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; }
function paceText(p, type) {
  if (!p) return "";
  return /^\d{1,2}[:.]\d{2}$/.test(p.trim()) && type !== "tt" ? p.trim().replace(".", ":") + " /km" : p.trim();
}
function loggedKm(s) {
  if (s.status === "done" || s.status === "changed") {
    const v = parseFloat(String(s.actualKm || "").replace(",", "."));
    return isFinite(v) && v > 0 ? v : (s.km || 0);
  }
  return 0;
}
function weekFor(iso) { return (S.block.weeks || []).find(w => iso >= w.start && iso <= w.end) || null; }
function currentWeekN() {
  const t = todayISO(), ws = S.block.weeks;
  if (!ws.length) return null;
  if (t < ws[0].start) return ws[0].n;
  const w = weekFor(t);
  return w ? w.n : ws[ws.length - 1].n;
}

let toastTimer;
function toast(msg, ms = 3800) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function armed(btn) {
  if (btn.dataset.armed === "1") return true;
  btn.dataset.armed = "1";
  btn.dataset.label = btn.textContent;
  btn.textContent = btn.dataset.confirm || "Tap again to confirm";
  btn.classList.add("armed");
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed === "1") { btn.dataset.armed = ""; btn.textContent = btn.dataset.label; btn.classList.remove("armed"); } }, 4000);
  return false;
}

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="kg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#2EF0D8"/><stop offset=".55" stop-color="#3BA6FF"/><stop offset="1" stop-color="#A77BFF"/></linearGradient></defs><path d="M9.5 6v20M10.5 17.5 22 6M14.5 14.8 23 26" stroke="url(#kg)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="23.6" cy="6" r="1.9" fill="#2EF0D8"/></svg>`;

/* ---------------- storage ---------------- */
async function seed() {
  await clearStore("sessions");
  await putMany("sessions", DEFAULT_SESSIONS.map(s => ({ ...s })));
  await setKV("block", DEFAULT_BLOCK);
  await setKV("settings", DEFAULT_SETTINGS);
  await setKV("seeded", true);
}

async function load() {
  await openDB();
  if (!(await getKV("seeded"))) await seed();
  S.sessions = (await getAll("sessions")).sort(byDate);
  S.acts = (await getAll("activities")).sort((a, b) => (a.start < b.start ? 1 : -1));
  S.block = (await getKV("block")) || structuredClone(DEFAULT_BLOCK);
  const st = (await getKV("settings")) || {};
  S.settings = { ...structuredClone(DEFAULT_SETTINGS), ...st };
  if (!S.settings.coros) S.settings.coros = {};
  runAnalysis();
}

function runAnalysis() {
  try { S.P = analyze(S.acts, S.sessions, S.settings, todayISO()); }
  catch (e) { console.error(e); S.P = null; }
}
let anaTimer;
function scheduleAnalysis() {
  clearTimeout(anaTimer);
  anaTimer = setTimeout(() => {
    runAnalysis();
    if (S.view === "plan") S.sessions.forEach(s => refreshCheck(s.id));
  }, 300);
}

function saveSession(s) {
  const i = S.sessions.findIndex(x => x.id === s.id);
  if (i >= 0) S.sessions[i] = s; else S.sessions.push(s);
  S.sessions.sort(byDate);
  return put("sessions", s).catch(e => toast("Couldn't save. " + (e.message || "")));
}

async function saveSettings() { await setKV("settings", S.settings); }

/* ---------------- theme ---------------- */
function applyTheme() {
  const t = S.settings ? S.settings.theme : "system";
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", bg));
  });
}

/* ---------------- routing ---------------- */
function route() {
  const h = (location.hash || "#plan").slice(1);
  const [view, arg] = h.split("/");
  S.view = ["plan", "runs", "stats", "guide", "settings"].includes(view) ? view : "plan";
  document.querySelectorAll(".tabbar a").forEach(a => a.setAttribute("aria-current", a.dataset.view === S.view ? "page" : "false"));
  const v = $("#view");
  if (S.view === "plan") { v.innerHTML = planHTML(); refreshPlan(); }
  else if (S.view === "runs") v.innerHTML = runsHTML();
  else if (S.view === "stats") v.innerHTML = statsHTML();
  else if (S.view === "guide") v.innerHTML = guideHTML();
  else v.innerHTML = settingsHTML();
  v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter");
  bindCharts(v);
  if (S.view === "guide" && arg && TYPES[arg]) {
    const el = document.getElementById("g-" + arg);
    if (el) { el.open = true; requestAnimationFrame(() => el.scrollIntoView({ block: "start" })); }
  } else if (!(S.view === "plan" && S.pendingScroll)) window.scrollTo(0, 0);
  if (S.view === "plan" && S.pendingScroll) { const id = S.pendingScroll; S.pendingScroll = null; requestAnimationFrame(() => goRun(id)); }
  if (S.view === "settings") refreshStorageStatus();
}

/* ---------------- plan view ---------------- */
function planGroups() {
  const groups = S.block.weeks.map(w => ({ week: w, runs: [] }));
  const other = [];
  for (const s of S.sessions) {
    const g = groups.find(g => s.date >= g.week.start && s.date <= g.week.end);
    (g ? g.runs : other).push(s);
  }
  return { groups, other };
}

function cardHTML(s) {
  const t = typeOf(s);
  const d = parseISO(s.date);
  return `<article class="run k-${t.cat}" id="run-${esc(s.id)}" data-id="${esc(s.id)}">
  <div class="run-main">
    <div class="date"><span class="dow">${DOW[d.getDay()]}</span><span class="dom">${d.getDate()}</span><span class="mon">${MON[d.getMonth()]}</span></div>
    <div class="body">
      <div class="tagrow"><button type="button" class="tag" data-act="guide-sheet" data-type="${esc(s.type)}" aria-label="What is ${esc(t.name)}?">${esc(tagOf(s))}<span class="q" aria-hidden="true">?</span></button><span class="flag"></span></div>
      <button type="button" class="title" data-act="edit">${esc(s.title)}</button>
      ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ""}
      <div class="logged"></div>
      <div class="linked"></div>
      <div class="check"></div>
    </div>
    <div class="km"><b>${esc(kmLabel(s))}</b><span>km</span></div>
  </div>
  <div class="controls" role="group" aria-label="Status for ${esc(dayLabel(s.date))}">
    <button type="button" class="st" data-act="status" data-s="done" aria-pressed="false" aria-label="Done"><span class="g">✓</span><span class="t">Done</span></button>
    <button type="button" class="st" data-act="status" data-s="changed" aria-pressed="false" aria-label="Changed"><span class="g">≈</span><span class="t">Changed</span></button>
    <button type="button" class="st" data-act="status" data-s="missed" aria-pressed="false" aria-label="Missed"><span class="g">✕</span><span class="t">Missed</span></button>
    <button type="button" class="more" data-act="details" aria-expanded="false">Details</button>
  </div>
  <div class="log-wrap"><div class="log">
    <label>Actual km<input id="f-km-${esc(s.id)}" data-field="actualKm" type="text" inputmode="decimal" autocomplete="off" placeholder="Planned ${esc(kmLabel(s))}" value="${esc(s.actualKm || "")}"></label>
    <label>${s.type === "tt" ? "Time or avg pace" : "Avg pace"}<input id="f-pace-${esc(s.id)}" data-field="pace" type="text" autocomplete="off" placeholder="${s.type === "tt" ? "e.g. 37:52" : "e.g. 4:32"}" value="${esc(s.pace || "")}"></label>
    <label>Effort<select id="f-eff-${esc(s.id)}" data-field="effort"><option value="">–</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}" ${String(s.effort) === String(n) ? "selected" : ""}>${n}/10${n === 2 ? " easy" : n === 5 ? " steady" : n === 7 ? " hard" : n === 10 ? " max" : ""}</option>`).join("")}</select></label>
    <label class="full">Notes<textarea id="f-note-${esc(s.id)}" data-field="note" placeholder="How it felt, splits, heart rate, anything off">${esc(s.note || "")}</textarea></label>
    <div class="full log-actions"><button type="button" class="linkbtn" data-act="edit">Edit or move this run</button></div>
  </div></div>
</article>`;
}

function planHTML() {
  const { groups, other } = planGroups();
  const cw = currentWeekN();
  const first = S.block.weeks[0], last = S.block.weeks[S.block.weeks.length - 1];
  const rng = first && last ? `${dayLabel(first.start).slice(4)} – ${dayLabel(last.end).slice(4)} · ${S.block.weeks.length} weeks` : "";
  const showInstall = !isStandalone() && !localStorageGet("installDismissed");
  return `
<header class="top">
  <div class="brand">${LOGO}<span class="wordmark">${APP_NAME}</span><span class="eyebrow">${esc(rng)}</span></div>
  <h1>${esc(S.block.name || "Training")}</h1>
  <div class="stats">
    <div class="stat"><b class="num" id="statRuns">0</b><span>Runs done</span></div>
    <div class="stat"><b class="num" id="statKm">0</b><span>Km logged</span></div>
    <div class="stat"><b class="num" id="statMissed">0</b><span>Missed</span></div>
  </div>
  <div class="laps" style="grid-template-columns:repeat(${Math.max(1, S.block.weeks.length)},minmax(0,1fr))" aria-label="Km logged per week">
    ${S.block.weeks.map(w => `<button type="button" class="lap${w.n === cw ? " now" : ""}" data-act="week" data-n="${w.n}" aria-label="Week ${w.n}"><span class="bar"><i id="lap-${w.n}"></i></span><span class="lbl">W${w.n}</span></button>`).join("")}
  </div>
  ${showInstall ? `<div class="hint"><div><b>Install it:</b> in Safari tap Share, then <i>Add to Home Screen</i>. It then opens like an app and works offline.</div><button type="button" class="x" data-act="dismiss-install" aria-label="Dismiss">×</button></div>` : ""}
  <div class="next" id="next" hidden>
    <div class="eyebrow" id="nextWhen">Next up</div>
    <div class="next-row"><div class="next-title" id="nextTitle"></div><div class="next-km num" id="nextKm"></div></div>
    <div class="next-meta" id="nextMeta"></div>
    <button class="linkbtn" id="nextGo" type="button" data-act="next-go">Go to this run</button>
  </div>
</header>
<nav class="weeks" aria-label="Weeks"><div class="chips">
  ${S.block.weeks.map(w => `<button type="button" class="chip${w.n === cw ? " now" : ""}" data-act="week" data-n="${w.n}">W${w.n}</button>`).join("")}
  ${other.length ? `<button type="button" class="chip" data-act="week" data-n="other">Other</button>` : ""}
  <button type="button" class="chip add" data-act="add-run">+ Add run</button>
</div></nav>
${groups.map(({ week: w, runs }) => `
<section class="week" id="week-${w.n}">
  <div class="week-head">
    <div class="week-title"><h2>Week ${w.n}</h2><span class="phase">${esc(w.phase || "")} · ${esc(dayLabel(w.start).slice(4))} – ${esc(dayLabel(w.end).slice(4))}</span></div>
    <div class="week-sum" id="sum-${w.n}"></div>
  </div>
  ${w.note ? `<p class="week-note">${esc(w.note)}</p>` : ""}
  ${runs.length ? runs.map(cardHTML).join("") : `<p class="empty">No runs planned this week.</p>`}
</section>`).join("")}
${other.length ? `<section class="week" id="week-other"><div class="week-head"><div class="week-title"><h2>Other runs</h2><span class="phase">Outside the block</span></div></div>${other.map(cardHTML).join("")}</section>` : ""}
<p class="foot center">Tap a run's title to edit or move it. Tap its label to see what that kind of session is.</p>`;
}

function refreshCheck(id) {
  const art = document.getElementById("run-" + id);
  if (!art) return;
  const box = art.querySelector(".check");
  const c = S.P && S.P.checks ? S.P.checks.get(id) : null;
  box.innerHTML = c && c.verdict !== "na" ? `<span class="verdict v-${c.verdict}"><i aria-hidden="true">${c.verdict === "ok" ? "✓" : c.verdict === "fast" ? "▲" : c.verdict === "slow" ? "▼" : "·"}</i>${esc(c.text)}</span>` : "";
}

function refreshCard(id) {
  const s = sessionById(id);
  const art = document.getElementById("run-" + id);
  if (!s || !art) return;
  const t = todayISO();
  art.classList.remove("st-done", "st-changed", "st-missed");
  if (s.status) art.classList.add("st-" + s.status);
  art.classList.toggle("today", s.date === t);
  art.querySelectorAll(".st").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.s === s.status)));
  const flag = art.querySelector(".flag");
  flag.className = "flag";
  if (s.date === t) { flag.textContent = "Today"; flag.classList.add("today-flag"); }
  else if (!s.status && s.date < t) flag.textContent = "Not logged";
  else flag.textContent = "";
  for (const [k, sel] of [["actualKm", "#f-km-"], ["pace", "#f-pace-"], ["effort", "#f-eff-"], ["note", "#f-note-"]]) {
    const el = art.querySelector(sel + CSS.escape(id));
    if (el && document.activeElement !== el) el.value = s[k] == null ? "" : s[k];
  }
  const bits = [];
  if (s.actualKm) bits.push(s.actualKm + " km");
  if (s.pace) bits.push(paceText(s.pace, s.type));
  if (s.effort) bits.push("effort " + s.effort + "/10");
  let line = bits.join(" · ");
  if (s.note) line += (line ? " — " : "") + s.note;
  art.querySelector(".logged").textContent = line;
  const linked = art.querySelector(".linked");
  const a = s.activityId ? actById(s.activityId) : null;
  linked.innerHTML = a ? `<button type="button" class="linkchip" data-act="act" data-id="${esc(a.id)}">↳ ${esc(a.name || a.source)} · ${fmtKm(a.distanceKm)} km${a.movingSec ? " · " + fmtPace(a.movingSec, a.distanceKm) + " /km" : ""}${a.avgHr ? " · " + a.avgHr + " bpm" : ""}</button>` : "";
  refreshCheck(id);
}

function refreshPlanSummary() {
  if (!$("#statRuns")) return;
  let done = 0, missed = 0, km = 0, planned = 0;
  for (const s of S.sessions) {
    planned += s.km || 0;
    if (s.status === "done" || s.status === "changed") done++;
    if (s.status === "missed") missed++;
    km += loggedKm(s);
  }
  $("#statRuns").innerHTML = `${done}<small>/${S.sessions.length}</small>`;
  $("#statKm").innerHTML = `${fmtKm(km)}<small>/${Math.round(planned)}</small>`;
  $("#statMissed").textContent = missed;
  const { groups } = planGroups();
  for (const { week: w, runs } of groups) {
    const wk = runs.reduce((a, s) => a + loggedKm(s), 0);
    const wp = runs.reduce((a, s) => a + (s.km || 0), 0);
    const wd = runs.filter(s => s.status === "done" || s.status === "changed").length;
    const bar = document.getElementById("lap-" + w.n);
    if (bar) bar.style.width = (wp ? Math.min(100, wk / wp * 100) : 0) + "%";
    const sum = document.getElementById("sum-" + w.n);
    if (sum) sum.innerHTML = `<b>${wd}/${runs.length}</b> runs · <b>${fmtKm(wk)}</b> / ${fmtKm(wp)} km`;
  }
  const t = todayISO();
  const nxt = S.sessions.find(s => s.date >= t && !s.status) || S.sessions.find(s => !s.status);
  const box = $("#next");
  if (!box) return;
  box.hidden = false;
  if (!nxt) {
    $("#nextWhen").textContent = "Block complete";
    $("#nextTitle").textContent = "Every run is logged.";
    $("#nextKm").textContent = "";
    $("#nextMeta").textContent = "Time to plan the next block.";
    $("#nextGo").hidden = true;
    return;
  }
  $("#nextWhen").textContent = nxt.date === t ? "Today" : (nxt.date < t ? "Not logged yet · " : "Next up · ") + dayLabel(nxt.date);
  $("#nextTitle").textContent = nxt.title;
  $("#nextKm").textContent = kmLabel(nxt) + " km";
  $("#nextMeta").textContent = tagOf(nxt) + (nxt.detail ? " · " + nxt.detail : "");
  $("#nextGo").hidden = false;
  $("#nextGo").dataset.id = nxt.id;
}

function refreshPlan() { S.sessions.forEach(s => refreshCard(s.id)); refreshPlanSummary(); }

function goRun(id) {
  const a = document.getElementById("run-" + id);
  if (!a) return;
  a.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  a.classList.add("flash");
  setTimeout(() => a.classList.remove("flash"), 1400);
}

async function setStatus(id, st) {
  const s = sessionById(id); if (!s) return;
  const next = { ...s, ...readLog(id) };
  next.status = s.status === st ? null : st;
  const saved = saveSession(next);
  refreshCard(id); refreshPlanSummary();
  const btn = document.querySelector(`#run-${CSS.escape(id)} .st[data-s="${st}"]`);
  if (btn && next.status) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
  await saved;
}

function readLog(id) {
  const art = document.getElementById("run-" + id);
  if (!art) return {};
  const v = sel => { const el = art.querySelector(sel + CSS.escape(id)); return el ? el.value.trim() : ""; };
  return { actualKm: v("#f-km-"), pace: v("#f-pace-"), effort: v("#f-eff-"), note: v("#f-note-") };
}

const logTimers = {};
async function commitLog(id) {
  const s = sessionById(id); if (!s) return;
  const vals = readLog(id);
  if (["actualKm", "pace", "effort", "note"].every(k => String(s[k] || "") === vals[k])) return;
  const next = { ...s, ...vals };
  if (!next.status && (vals.actualKm || vals.pace)) next.status = "done";
  const saved = saveSession(next);
  refreshCard(id); refreshPlanSummary();
  await saved;
}

/* ---------------- edit sheet ---------------- */
function typeOptions(sel) {
  const groups = [["easy", "Easy running"], ["long", "Long runs"], ["quality", "Workouts"], ["test", "Tests"]];
  return groups.map(([cat, label]) => `<optgroup label="${label}">${TYPE_ORDER.filter(k => TYPES[k].cat === cat && k !== "wucd").map(k => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(TYPES[k].name)}</option>`).join("")}</optgroup>`).join("");
}

function openEditSheet(id, date) {
  const s = id ? sessionById(id) : { id: "", date: date || todayISO(), type: "easy", title: "", detail: "", km: "" };
  if (!s) return;
  openSheet(`
<h2 class="sheet-title">${id ? "Edit run" : "Add a run"}</h2>
<form class="form" id="editForm" data-id="${esc(s.id)}">
  <label>Date<input id="e-date" type="date" required value="${esc(s.date)}"></label>
  <label>Kind of session<select id="e-type">${typeOptions(s.type)}</select></label>
  <label>What to run<input id="e-title" type="text" autocomplete="off" placeholder="e.g. 5 × 1000 m at 3:42–3:45" value="${esc(s.title)}"></label>
  <label>Extra detail <span class="opt">optional</span><input id="e-detail" type="text" autocomplete="off" placeholder="e.g. 2:30 jog between · WU + CD" value="${esc(s.detail || "")}"></label>
  <div class="row2">
    <label>Planned km<input id="e-km" type="text" inputmode="decimal" autocomplete="off" value="${esc(s.km === "" ? "" : fmtKm(s.km || 0))}"></label>
    <label>Label <span class="opt">optional</span><input id="e-label" type="text" autocomplete="off" placeholder="${esc(typeOf(s).name)}" value="${esc(s.label || "")}"></label>
  </div>
  <div class="sheet-actions">
    <button type="submit" class="btn primary">${id ? "Save changes" : "Add run"}</button>
    ${id ? `<button type="button" class="btn danger ghost" data-act="delete-session" data-id="${esc(s.id)}" data-confirm="Tap again to delete">Delete run</button>` : ""}
  </div>
</form>`);
  $("#editForm").addEventListener("submit", e => { e.preventDefault(); saveEdit(); });
}

async function saveEdit() {
  const form = $("#editForm");
  const id = form.dataset.id;
  const date = $("#e-date").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Pick a date first."); return; }
  const type = $("#e-type").value;
  const kmRaw = parseFloat($("#e-km").value.replace(",", "."));
  const km = isFinite(kmRaw) && kmRaw >= 0 ? kmRaw : 0;
  const base = id ? sessionById(id) : { id: "u-" + Date.now().toString(36) };
  const s = { ...base, date, type, title: $("#e-title").value.trim() || TYPES[type].name, detail: $("#e-detail").value.trim(), km, label: $("#e-label").value.trim() || undefined };
  if (!s.label) delete s.label;
  if (id && base.km !== km) delete s.kmLabel;
  await saveSession(s);
  closeSheet();
  runAnalysis();
  S.pendingScroll = s.id;
  if (S.view === "plan") route(); else location.hash = "#plan";
  toast(id ? "Run updated" : "Run added");
}

async function deleteSession(id) {
  S.sessions = S.sessions.filter(s => s.id !== id);
  await del("sessions", id);
  closeSheet();
  runAnalysis();
  if (S.view === "plan") { const y = window.scrollY; route(); window.scrollTo(0, y); }
  toast("Run deleted");
}

/* ---------------- guide ---------------- */
function zoneFor(key) {
  const P = S.P;
  if (P && P.paces) {
    const z = P.zoneBounds;
    if (key === "easy") return { pace: range(P.paces.easy) + " /km", hr: `below ${z[1]} bpm`, computed: true };
    if (key === "steady") return { pace: range(P.paces.steady) + " /km", hr: `${z[0]}–${z[2] - 1} bpm`, computed: true };
    if (key === "threshold") return { pace: range(P.paces.threshold) + " /km", hr: `${z[2]}–${P.lthr.value} bpm`, computed: true };
    if (key === "interval") return { pace: range(P.paces.interval) + " /km", hr: `${P.lthr.value}+ bpm late in each rep`, computed: true };
    if (key === "reps") return { pace: `200 m ${Math.round(P.paces.R * 0.2)} s · 400 m ${Math.round(P.paces.R * 0.4)} s`, hr: "ignore", computed: true };
  }
  return FALLBACK_ZONES[key] || null;
}

function guideEntryHTML(key, full) {
  const t = TYPES[key]; if (!t) return "";
  const z = t.zone ? zoneFor(t.zone) : null;
  return `
  <p class="g-short">${esc(t.short)}</p>
  <dl class="g-dl">
    <dt>What it is</dt><dd>${esc(t.what)}</dd>
    <dt>Why you do it</dt><dd>${esc(t.why)}</dd>
    <dt>How it should feel</dt><dd>${esc(t.feel)}</dd>
    ${z ? `<dt>Your pace</dt><dd><b>${esc(z.pace)}</b>${z.hr && z.hr !== "ignore" ? ` · HR ${esc(z.hr)}` : ""}${z.computed ? ` <span class="muted">· from your runs</span>` : ""}</dd>` : ""}
    ${t.mistakes.length ? `<dt>Common mistakes</dt><dd><ul>${t.mistakes.map(m => `<li>${esc(m)}</li>`).join("")}</ul></dd>` : ""}
    ${t.notSame.length ? `<dt>Not the same as</dt><dd><ul>${t.notSame.map(([k, txt]) => `<li><b>${esc(TYPES[k].name)}:</b> ${esc(txt)}</li>`).join("")}</ul></dd>` : ""}
  </dl>
  ${full ? "" : `<button type="button" class="linkbtn" data-act="open-guide" data-type="${esc(key)}">Open the full guide</button>`}`;
}

function openGuideSheet(key) {
  const t = TYPES[key] || TYPES.easy;
  openSheet(`<div class="eyebrow cat-${t.cat}">${{ easy: "Easy running", long: "Long run", quality: "Workout", test: "Test" }[t.cat]}</div><h2 class="sheet-title">${esc(t.name)}</h2>${guideEntryHTML(key, false)}`);
}

function guideHTML() {
  return `
<header class="top"><div class="eyebrow">Session types</div><h1>Guide</h1>
<p class="lede">What each kind of run is for and how it should feel. Paces come from your own runs once Krok has enough data.</p></header>
<section class="card">
  <h2 class="h2">The ones that get mixed up</h2>
  <div class="cmp">${COMPARE.map(r => `
    <a class="cmp-row cat-${TYPES[r.key].cat}" href="#guide/${r.key}">
      <span class="cmp-name">${esc(TYPES[r.key].name)}</span>
      <span class="cmp-kv"><span>Fast part</span>${esc(r.hard)}</span>
      <span class="cmp-kv"><span>Recovery</span>${esc(r.rest)}</span>
      <span class="cmp-kv"><span>Effort</span>${esc(r.effort)}</span>
      <span class="cmp-kv"><span>Trains</span>${esc(r.aim)}</span>
    </a>`).join("")}</div>
  <p class="foot">Rule of thumb: if you finish a set tired, it was intervals. Strides and reps should leave you as fresh at the end as at the start.</p>
</section>
${[["easy", "Easy running"], ["long", "Long runs"], ["quality", "Workouts"], ["test", "Tests"]].map(([cat, label]) => `
<h2 class="group-h">${label}</h2>
${TYPE_ORDER.filter(k => TYPES[k].cat === cat).map(k => `
<details class="panel g cat-${cat}" id="g-${k}"><summary><span>${esc(TYPES[k].name)}</span></summary><div class="panel-body">${guideEntryHTML(k, true)}</div></details>`).join("")}`).join("")}`;
}

/* ---------------- runs ---------------- */
function weeklyKmChart() {
  const thisMon = mondayOf(todayISO());
  const weeks = [];
  for (let i = 11; i >= 0; i--) weeks.push({ mon: addDays(thisMon, -7 * i), km: 0, n: 0 });
  for (const a of S.acts) {
    if (!a.isRun) continue;
    const w = weeks.find(w => w.mon === mondayOf(a.date));
    if (w) { w.km += a.distanceKm || 0; w.n++; }
  }
  const total = weeks.reduce((x, w) => x + w.km, 0);
  return { total, html: barChart({ title: "Running km per week", height: 150, classes: ["b-km"], labelEvery: 2, yFormat: v => Math.round(v), bars: weeks.map(w => ({ label: `${parseISO(w.mon).getDate()}.${parseISO(w.mon).getMonth() + 1}`, parts: [w.km], now: w.mon === thisMon, tip: [`Week of ${dayLabel(w.mon)}`, `${fmtKm(w.km)} km · ${w.n} run${w.n === 1 ? "" : "s"}`] })) }) };
}

function runsHTML() {
  const list = S.acts.filter(a => S.histFilter === "all" || a.isRun);
  const allRuns = S.acts.filter(a => a.isRun);
  const detailed = allRuns.filter(a => a.m).length;
  const linkedIds = new Set(S.sessions.filter(s => s.activityId).map(s => s.activityId));
  const byMonth = [];
  for (const a of list) {
    const key = a.date.slice(0, 7);
    let g = byMonth[byMonth.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; byMonth.push(g); }
    g.items.push(a);
  }
  const wk = weeklyKmChart();
  return `
<header class="top"><div class="eyebrow">Imported from Strava and COROS</div><h1>Runs</h1></header>
<section class="card">
  <h2 class="h2">Import runs</h2>
  <p>Pick the zip Strava emails you, or single files from Strava or COROS. Runs on a planned day are logged against that session automatically.</p>
  ${allRuns.length && detailed < allRuns.length ? `<p class="callout"><b>${detailed} of ${allRuns.length} runs have detailed data.</b> Import the Strava zip again (or the files in its activities folder) to add second-by-second data to the rest. Nothing gets duplicated.</p>` : ""}
  <button type="button" class="btn primary" data-act="import">Choose files</button>
  <details class="howto"><summary>Where do I get these files?</summary>
    <ul>
      <li><b>Your whole Strava history:</b> on strava.com in a browser, open Settings → My Account → Download or Delete Your Account → Request your archive. Strava emails you a zip. Import the zip as it is; there's no need to unzip it.</li>
      <li><b>One Strava run:</b> open the activity on strava.com, tap the ⋯ menu and choose Export Original (the watch's FIT file) or Export GPX.</li>
      <li><b>COROS:</b> in COROS Training Hub on the web, open an activity and export it as FIT.</li>
    </ul>
    <p class="foot">Accepted: .zip (Strava archive), activities.csv, .fit, .gpx, .tcx, and .gz versions of these.</p>
  </details>
</section>
<section class="card">
  <div class="card-head"><h2 class="h2">Weekly running km</h2><span class="muted num">${fmtKm(wk.total)} km in 12 weeks</span></div>
  ${wk.html}
</section>
<div class="filters" role="group" aria-label="Show">
  <button type="button" class="chip${S.histFilter === "runs" ? " on" : ""}" data-act="filter" data-f="runs" aria-pressed="${S.histFilter === "runs"}">Runs (${allRuns.length})</button>
  <button type="button" class="chip${S.histFilter === "all" ? " on" : ""}" data-act="filter" data-f="all" aria-pressed="${S.histFilter === "all"}">All activities (${S.acts.length})</button>
</div>
${byMonth.length ? byMonth.map(g => {
  const [y, m] = g.key.split("-").map(Number);
  const mk = g.items.filter(a => a.isRun).reduce((x, a) => x + (a.distanceKm || 0), 0);
  return `<h2 class="group-h">${MONTH_LONG[m - 1]} ${y}<span class="muted num"> · ${fmtKm(mk)} km run</span></h2>
  <ul class="acts">${g.items.map(a => `<li><button type="button" class="act" data-act="act" data-id="${esc(a.id)}">
    <span class="a-date"><b>${parseISO(a.date).getDate()}</b><span>${DOW[parseISO(a.date).getDay()]}</span></span>
    <span class="a-main"><span class="a-name">${esc(a.name || a.sport)}</span><span class="a-meta">${a.isRun ? "" : esc(a.sport) + " · "}${a.movingSec ? fmtDur(a.movingSec) : ""}${a.isRun && a.movingSec ? " · " + fmtPace(a.movingSec, a.distanceKm) + " /km" : ""}${a.avgHr ? " · " + a.avgHr + " bpm" : ""}${linkedIds.has(a.id) ? ` · <span class="ok">in plan</span>` : ""}${isAltitude(a) ? ` · <span class="alt">altitude</span>` : ""}</span></span>
    <span class="a-km num">${fmtKm(a.distanceKm)}<small>km</small></span>
  </button></li>`).join("")}</ul>`;
}).join("") : `<p class="empty">${S.acts.length ? "No runs among the imported activities." : "Nothing imported yet. Your Strava archive is the quickest way to bring in your history."}</p>`}`;
}

function zoneBarHTML(z) {
  const tot = z.reduce((a, b) => a + b, 0);
  if (!tot || !S.P) return "";
  return `<div class="zbar" role="img" aria-label="Time in heart-rate zones">${z.map((s, i) => s ? `<i class="z${i + 1}" style="flex:${s}"></i>` : "").join("")}</div>
  <div class="zlegend">${S.P.hrZones.map((zn, i) => z[i] ? `<span><i class="key z${i + 1}"></i>Z${zn.n} ${esc(zn.name)} <b class="num">${Math.round(z[i] / tot * 100)}%</b></span>` : "").join("")}</div>`;
}

async function openActSheet(id) {
  const a = actById(id); if (!a) return;
  const P = S.P;
  const linked = S.sessions.find(s => s.activityId === a.id);
  const near = S.sessions.filter(s => s.date >= addDays(a.date, -3) && s.date <= addDays(a.date, 3) && s.id !== (linked && linked.id));
  const st = new Date(a.start);
  const stat = (label, val) => val ? `<div class="kv"><span>${label}</span><b class="num">${val}</b></div>` : "";
  const load = P && P.loadOf ? P.loadOf.get(a.id) : null;
  const check = linked && P ? P.checks.get(linked.id) : null;
  const m = a.m;
  const effPt = P && P.efficiency ? P.efficiency.points.find(p => p.a.id === a.id) : null;
  openSheet(`
<div class="eyebrow">${esc(a.sport)} · ${esc(a.source)}${isAltitude(a) ? ` · <span class="alt">altitude ${a.alt} m</span>` : ""}</div>
<h2 class="sheet-title">${esc(a.name || a.sport)}</h2>
<p class="muted">${esc(dayLabel(a.date))}, ${String(st.getHours()).padStart(2, "0")}:${String(st.getMinutes()).padStart(2, "0")}</p>
<div class="kvgrid">
  ${stat("Distance", fmtKm(a.distanceKm) + " km")}
  ${stat("Moving time", a.movingSec ? fmtDur(a.movingSec) : "")}
  ${stat("Pace", a.movingSec && a.distanceKm ? fmtPace(a.movingSec, a.distanceKm) + " /km" : "")}
  ${stat("Avg HR", a.avgHr ? a.avgHr + " bpm" : "")}
  ${stat("Max HR", m && m.maxHr15 ? m.maxHr15 + " bpm" : a.maxHr ? a.maxHr + " bpm" : "")}
  ${stat("Climb", a.elevGain ? a.elevGain + " m" : "")}
  ${stat("Load", load ? Math.round(load) : "")}
  ${stat("Elapsed", a.elapsedSec && a.elapsedSec !== a.movingSec ? fmtDur(a.elapsedSec) : "")}
  ${stat("Strava effort", a.relEffort || "")}
</div>
${check && check.verdict !== "na" ? `<p class="verdict v-${check.verdict} big">${esc(check.text)}</p>` : ""}
${m ? `
<h3 class="h3">Pace and heart rate</h3>
<div id="actCharts">${a.hasStream ? `<p class="muted small">Loading…</p>` : `<p class="muted small">Re-import this run's file to see the charts.</p>`}</div>
<h3 class="h3">Heart-rate zones</h3>
${zoneBarHTML(P ? P.zoneTime(a) : [0, 0, 0, 0, 0])}
${m.splits && m.splits.length ? `<h3 class="h3">Kilometre splits</h3>
<div class="splits">${m.splits.map(([sec, hr], i) => `<div class="split"><span class="sk num">${i + 1}</span><span class="sp num">${mmss(sec)}</span><span class="sbar"><i style="width:${Math.max(8, Math.min(100, (600 - sec) / 4.5))}%"></i></span><span class="sh num">${hr ? hr + " bpm" : ""}</span></div>`).join("")}</div>` : ""}
<div class="kvgrid">
  ${stat("Cardiac drift", m.decoup != null ? (m.decoup > 0 ? "+" : "") + m.decoup + "%" : "")}
  ${stat(`Pace at ${P ? P.refHr : ""} bpm`, effPt ? mmss(effPt.pace) + " /km" : "")}
  ${stat("Best 1 km", m.best && m.best[1000] ? mmss(m.best[1000]) : "")}
  ${stat("Best 5 km", m.best && m.best[5000] ? fmtDur(m.best[5000]) : "")}
  ${stat("Best 10 km", m.best && m.best[10000] ? fmtDur(m.best[10000]) : "")}
</div>
${m.decoup != null ? `<p class="foot">Cardiac drift compares speed per heartbeat in the first and second half (after a 10-minute warm-up). Under 5% on a steady run means good aerobic endurance.</p>` : ""}
` : (a.isRun ? `<p class="callout small">Only summary data for this run. Import its file (or the Strava zip) for splits, zones and charts.</p>` : "")}
<h3 class="h3">In your plan</h3>
${linked ? `<div class="linkedbox"><div><b>${esc(dayLabel(linked.date))}</b> · ${esc(tagOf(linked))}<br><span class="muted">${esc(linked.title)}</span></div>
  <div class="row-actions"><button type="button" class="btn small" data-act="goto-session" data-id="${esc(linked.id)}">Show</button><button type="button" class="btn small ghost" data-act="unlink" data-session="${esc(linked.id)}" data-act-id="${esc(a.id)}">Unlink</button></div></div>` :
  `<p class="muted">Not linked to a planned run.</p>`}
${near.length ? `<p class="small-h">${linked ? "Move it to another run" : "Link it to a planned run"}</p><div class="pick">${near.map(s => `<button type="button" class="pickrow" data-act="link" data-session="${esc(s.id)}" data-act-id="${esc(a.id)}"><span>${esc(dayLabel(s.date))} · ${esc(tagOf(s))}</span><span class="muted">${esc(s.title)} · ${esc(kmLabel(s))} km${s.activityId ? " · linked" : ""}</span></button>`).join("")}</div>` : ""}
<div class="sheet-actions"><button type="button" class="btn danger ghost" data-act="delete-act" data-id="${esc(a.id)}" data-confirm="Tap again to delete">Delete this activity</button></div>`);
  if (m && a.hasStream) {
    let st2 = null;
    try { st2 = await get("streams", a.id); } catch (e) { /* ignore */ }
    const box = document.getElementById("actCharts");
    if (!box) return;
    if (!st2 || !st2.d) { box.innerHTML = `<p class="muted small">No chart data stored for this run.</p>`; return; }
    box.innerHTML = streamCharts(st2);
    bindCharts(box);
  }
}

function streamCharts(st) {
  const { t, d, hr } = st;
  const pace = [], hrs = [];
  let j = 0, lastX = -1;
  for (let i = 0; i < t.length; i++) {
    while (j + 1 < i && t[i] - t[j + 1] >= 30) j++;
    const span = t[i] - t[j];
    const km = d[i] / 1000;
    if (km - lastX < 0.05 && i !== t.length - 1) continue;
    lastX = km;
    const v = span > 0 ? (d[i] - d[j]) / span : 0;
    const p = v > 1.67 ? 1000 / v : null;
    pace.push({ x: km, y: p != null && p < 600 && p > 150 ? p : null });
    if (hr) hrs.push({ x: km, y: hr[i] });
  }
  const maxKm = d[d.length - 1] / 1000;
  const step = maxKm > 30 ? 10 : maxKm > 14 ? 5 : maxKm > 6 ? 2 : 1;
  const ticks = []; for (let k = step; k < maxKm; k += step) ticks.push({ x: k, label: k + " km" });
  const pv = pace.map(p => p.y).filter(Boolean).sort((a, b) => a - b);
  const lo = pv.length ? pv[Math.floor(pv.length * 0.03)] : 200, hi = pv.length ? pv[Math.floor(pv.length * 0.97)] : 400;
  let html = lineChart({ title: "Pace", caption: "Pace", height: 140, xType: "num", xMin: 0, xMax: maxKm, xTicks: ticks, invert: true, yMin: Math.floor((lo - 10) / 15) * 15, yMax: Math.ceil((hi + 10) / 15) * 15, ySteps: [15, 30, 60, 120], yFormat: v => mmss(v), xFormat: x => fmtKm(x) + " km", series: [{ label: "Pace", cls: "s-pace", values: pace.map(p => ({ x: p.x, y: p.y != null ? Math.max(lo - 10, Math.min(hi + 10, p.y)) : null })) }], tip: v => [fmtKm(v.x) + " km", "Pace " + mmss(v.y) + " /km"] });
  if (hrs.length) html += lineChart({ title: "Heart rate", caption: "Heart rate", height: 120, xType: "num", xMin: 0, xMax: maxKm, xTicks: ticks, xFormat: x => fmtKm(x) + " km", yFormat: v => Math.round(v), series: [{ label: "Heart rate", cls: "s-hr", values: hrs }], tip: v => [fmtKm(v.x) + " km", Math.round(v.y) + " bpm"] });
  return html;
}

function applyLink(s, a) {
  const next = { ...s, activityId: a.id };
  if (!next.status) next.status = "done";
  if (!next.actualKm) next.actualKm = fmtKm(a.distanceKm);
  if (!next.pace && a.movingSec && a.distanceKm) next.pace = fmtPace(a.movingSec, a.distanceKm);
  return next;
}

async function linkActivity(sessionId, actId) {
  const a = actById(actId), s = sessionById(sessionId);
  if (!a || !s) return;
  for (const o of S.sessions.filter(x => x.activityId === actId && x.id !== sessionId)) { const c = { ...o }; delete c.activityId; await saveSession(c); }
  await saveSession(applyLink(s, a));
  runAnalysis();
  closeSheet();
  toast("Linked to " + dayLabel(s.date));
  if (S.view === "runs") route();
}

async function unlink(sessionId) {
  const s = sessionById(sessionId); if (!s) return;
  const c = { ...s }; delete c.activityId;
  await saveSession(c);
  runAnalysis();
  closeSheet();
  toast("Unlinked. The logged values stay; edit them in the plan if needed.");
  if (S.view === "runs") route(); else if (S.view === "plan") { refreshCard(sessionId); refreshPlanSummary(); }
}

async function deleteActivity(id) {
  for (const o of S.sessions.filter(x => x.activityId === id)) { const c = { ...o }; delete c.activityId; await saveSession(c); }
  S.acts = S.acts.filter(a => a.id !== id);
  await del("activities", id);
  try { await del("streams", id); } catch (e) { /* ignore */ }
  runAnalysis();
  closeSheet();
  if (S.view === "runs") route();
  toast("Activity deleted");
}

// Combines a newly read activity with one that is already stored.
function mergeActs(ex, inc) {
  const out = { ...ex };
  let changed = false, enriched = false;
  for (const k of ["avgHr", "maxHr", "elevGain", "alt", "relEffort", "srcFile"]) {
    if ((out[k] == null || out[k] === "") && inc[k] != null) { out[k] = inc[k]; changed = true; }
  }
  if (!out.name && inc.name) { out.name = inc.name; changed = true; }
  if (inc.source === "Strava" && ex.source !== "Strava") {
    if (inc.name) out.name = inc.name;
    if (inc.sport && inc.sport !== "Activity") { out.sport = inc.sport; out.isRun = inc.isRun; }
    changed = true;
  }
  if (inc.m && !ex.m) { out.m = inc.m; if (inc.m.altMed != null) out.alt = inc.m.altMed; changed = true; enriched = true; }
  if (inc.tz != null && ex.tz == null) { out.tz = inc.tz; out.date = inc.date; changed = true; }
  return { act: out, changed, enriched };
}

let importing = false;
async function handleImport(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || importing) return;
  importing = true;
  try {
    toast("Opening files…", 60000);
    const { entries, problems } = await expandFiles(files);
    const index = new Map(S.acts.map(a => [a.id, a]));
    const byKey = new Map();
    const byDay = {};
    const addIndex = a => { index.set(a.id, a); if (a.srcFile) byKey.set(a.srcFile, a); (byDay[a.date] = byDay[a.date] || []).push(a); };
    S.acts.forEach(a => { if (a.srcFile) byKey.set(a.srcFile, a); (byDay[a.date] = byDay[a.date] || []).push(a); });
    const findMatch = r => index.get(r.id) || (r.srcFile && byKey.get(r.srcFile)) || (byDay[r.date] || []).find(b =>
      Math.abs(Date.parse(b.start) - Date.parse(r.start)) < 180000 &&
      Math.abs((b.distanceKm || 0) - (r.distanceKm || 0)) <= Math.max(0.2, 0.03 * (r.distanceKm || 0)));
    let added = 0, enriched = 0, dupes = 0;
    const pendingActs = new Map(), pendingStreams = [];
    const flush = async () => {
      if (pendingActs.size) { await putMany("activities", [...pendingActs.values()]); pendingActs.clear(); }
      if (pendingStreams.length) { await putMany("streams", pendingStreams.splice(0)); }
    };
    for (let i = 0; i < entries.length; i++) {
      if (entries.length > 3 && (i % 5 === 0 || i === entries.length - 1)) toast(`Importing ${i + 1} of ${entries.length}…`, 60000);
      const { items, problems: pr } = await parseEntry(entries[i]);
      pr.forEach(p => problems.push(p));
      for (const { rec, small } of items) {
        const ex = findMatch(rec);
        if (ex) {
          const r = mergeActs(ex, rec);
          if (small && !ex.hasStream) { pendingStreams.push({ id: ex.id, ...small }); r.act.hasStream = true; r.changed = true; }
          if (r.changed) {
            const k = S.acts.findIndex(x => x.id === ex.id);
            if (k >= 0) S.acts[k] = r.act;
            index.set(ex.id, r.act);
            if (r.act.srcFile) byKey.set(r.act.srcFile, r.act);
            const day = byDay[ex.date] || []; const di = day.indexOf(ex); if (di >= 0) day[di] = r.act;
            pendingActs.set(ex.id, r.act);
            if (r.enriched) enriched++;
          } else dupes++;
        } else {
          if (small) { pendingStreams.push({ id: rec.id, ...small }); rec.hasStream = true; }
          S.acts.push(rec);
          addIndex(rec);
          pendingActs.set(rec.id, rec);
          added++;
        }
      }
      if (pendingActs.size >= 40 || pendingStreams.length >= 20) await flush();
    }
    await flush();
    S.acts.sort((a, b) => (a.start < b.start ? 1 : -1));

    // Log runs against planned sessions on the same day.
    let matched = 0;
    const linked = new Set(S.sessions.filter(s => s.activityId).map(s => s.activityId));
    for (const a of S.acts.filter(a => a.isRun && !linked.has(a.id)).sort((x, y) => (x.start < y.start ? -1 : 1))) {
      const cands = S.sessions.filter(s => s.date === a.date && !s.activityId && s.status !== "missed");
      if (!cands.length) continue;
      cands.sort((x, y) => (!!x.status - !!y.status) || Math.abs((x.km || 0) - a.distanceKm) - Math.abs((y.km || 0) - a.distanceKm));
      await saveSession(applyLink(cands[0], a));
      linked.add(a.id);
      matched++;
    }
    runAnalysis();
    const parts = [];
    parts.push(added ? `Imported ${added} new ${added === 1 ? "activity" : "activities"}` : "No new activities");
    if (enriched) parts.push(`detailed data added to ${enriched}`);
    if (matched) parts.push(`${matched} logged in your plan`);
    if (dupes && !enriched && !added) parts.push(`${dupes} already here`);
    toast(parts.join(" · "), 6000);
    if (S.view === "runs" || S.view === "stats") route();
    if (problems.length) openSheet(`<h2 class="sheet-title">Some files couldn't be read</h2><p class="muted">${problems.length} of them. Everything else was imported.</p><ul class="problems">${problems.slice(0, 40).map(p => `<li><b>${esc(p.name)}</b><br><span class="muted">${esc(p.reason)}</span></li>`).join("")}</ul>`);
  } catch (e) {
    toast("Import stopped: " + (e.message || e), 8000);
  } finally {
    importing = false;
  }
}

/* ---------------- stats ---------------- */
const pct = x => Math.round(x * 100) + "%";
const signed = (x, unit = "") => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x) + unit;

function statsHTML() {
  const P = S.P;
  if (!P || !P.runCount) {
    return `<header class="top"><div class="eyebrow">Worked out from your runs</div><h1>Stats</h1></header>
    <section class="card"><h2 class="h2">Nothing to analyse yet</h2><p>Import your Strava archive in the Runs tab. Krok then works out your zones, threshold, fitness, efficiency and race predictions from it.</p><button type="button" class="btn primary" data-act="goto-runs">Go to Runs</button></section>`;
  }
  const C = S.settings.coros || {};
  const st = P.status;
  const hist = P.series || [];
  const rangeDays = S.statsRange;
  const from = addDays(P.today, -rangeDays + 1);
  const ser = hist.filter(x => x.date >= from);
  const statusCard = st ? `
<section class="card status s-${st.key}">
  <div class="eyebrow">Training status</div>
  <div class="status-row"><h2 class="status-label">${esc(st.label)}</h2>${st.pct != null ? `<span class="ratio num">${Math.round(st.pct)}%</span>` : ""}</div>
  <p>${esc(st.text)}</p>
  <div class="tiles">
    <div class="tile"><b class="num">${Math.round(st.ctl)}</b><span>Fitness</span><small>42-day load</small></div>
    <div class="tile"><b class="num">${Math.round(st.atl)}</b><span>Fatigue</span><small>7-day load</small></div>
    <div class="tile"><b class="num">${signed(Math.round(st.form))}</b><span>Form</span><small>fitness − fatigue</small></div>
  </div>
  ${P.week ? `<div class="weekload"><div class="wl-head"><span>This week's load</span><b class="num">${Math.round(P.week.load)}</b></div>
    <div class="wl-bar"><i style="width:${Math.min(100, P.week.load / Math.max(1, P.week.build) * 100)}%"></i><span class="mark" style="left:${Math.min(100, P.week.maintain / Math.max(1, P.week.build) * 100)}%"></span></div>
    <div class="wl-foot"><span>maintain ≈ ${Math.round(P.week.maintain)}</span><span>build up to ≈ ${Math.round(P.week.build)}</span></div></div>` : ""}
</section>` : "";

  const ranges = [[42, "6 W"], [90, "3 M"], [182, "6 M"], [365, "1 Y"]];
  const fitChart = ser.length > 3 ? lineChart({
    title: "Fitness and fatigue", height: 180, yFormat: v => Math.round(v), includeZero: true,
    series: [
      { label: "Fitness", cls: "s-fit", area: true, values: ser.map(x => ({ x: x.date, y: x.ctl })) },
      { label: "Fatigue", cls: "s-fat", values: ser.map(x => ({ x: x.date, y: x.atl })) }
    ],
    tip: v => { const x = ser.find(r => r.date === v.x); return [dateLabel(v.x), `Fitness ${Math.round(x.ctl)}`, `Fatigue ${Math.round(x.atl)}`, x.ratio != null ? `Ratio ${Math.round(x.ratio * 100)}%` : "", x.load ? `Load that day ${Math.round(x.load)}` : "Rest day"].filter(Boolean); }
  }) : `<p class="empty">Not enough history in this range.</p>`;
  const ratioChart = ser.length > 3 ? lineChart({
    title: "Fatigue as a share of fitness", height: 140, yMin: 0, yMax: 180, ySteps: [50], yFormat: v => v + "%",
    bands: [{ y0: 0, y1: 50, cls: "b-drop" }, { y0: 50, y1: 80, cls: "b-fresh" }, { y0: 80, y1: 100, cls: "b-keep" }, { y0: 100, y1: 130, cls: "b-build" }, { y0: 130, y1: 150, cls: "b-fast" }, { y0: 150, y1: 180, cls: "b-over" }],
    series: [{ label: "Ratio", cls: "s-ratio", values: ser.filter(x => x.ratio != null).map(x => ({ x: x.date, y: Math.min(180, x.ratio * 100) })) }],
    tip: v => [dateLabel(v.x), `Ratio ${Math.round(v.y)}%`]
  }) : "";

  // Efficiency
  const E = P.efficiency;
  const effFrom = addDays(P.today, -364);
  const effPts = E.points.filter(p => p.date >= effFrom);
  const effTrend = E.trend.filter(p => p.date >= effFrom);
  const effChart = effPts.length >= 3 ? lineChart({
    title: "Pace at the same heart rate", height: 170, invert: true, ySteps: [5, 10, 15, 20, 30, 60], yFormat: v => mmss(v),
    series: [
      { label: "4-week median", cls: "s-eff", values: effTrend.map(p => ({ x: p.date, y: p.pace })) },
      { label: "Single runs", cls: "s-effdot", dots: true, values: effPts.map(p => ({ x: p.date, y: p.pace })) }
    ],
    cursorSeries: effTrend.length ? 0 : 1,
    tip: v => [dateLabel(v.x), `${mmss(v.y)} /km at ${E.refHr} bpm`]
  }) : `<p class="empty">Needs a few steady runs with heart rate between ${E.refHr - 18} and ${E.refHr + 18} bpm, at low altitude.</p>`;

  // Zones per week
  const zw = P.zoneWeeks;
  const zChart = barChart({
    title: "Time in heart-rate zones per week", height: 160, classes: ["z1", "z2", "z3", "z4", "z5"], labelEvery: 2, yFormat: v => Math.round(v / 60) + "h",
    legend: P.hrZones.map(z => `Z${z.n} ${z.name}`),
    bars: zw.map(w => ({ label: `${parseISO(w.mon).getDate()}.${parseISO(w.mon).getMonth() + 1}`, parts: w.z.map(s => s / 60), now: w.mon === mondayOf(P.today), tip: [`Week of ${dayLabel(w.mon)}`].concat(w.z.map((s, i) => s ? `Z${i + 1}: ${Math.round(s / 60)} min` : null).filter(Boolean)) }))
  });
  const sp = P.split28;

  // Discipline
  const D = P.discipline;
  const easyFast = D.easy.filter(x => x.c.verdict === "fast").length;
  const workBy = v => D.work.filter(x => x.c.verdict === v).length;

  // Predictions vs COROS
  const corosPred = { 5000: C.p5, 10000: C.p10, 21097.5: C.phm, 42195: C.pm };
  const predRows = (P.predictions || []).map(p => {
    const c = parseClock(corosPred[p.D]);
    return `<tr><td>${esc(p.label)}</td><td class="num"><b>${fmtDur(p.sec)}</b><small>${mmss(p.sec / (p.D / 1000))} /km</small></td><td class="num">${c ? fmtDur(c) : "—"}</td><td class="num diff">${c ? signed(Math.round(p.sec - c), " s") : ""}</td></tr>`;
  }).join("");

  const cmpRow = (label, ours, theirs, diff) => `<tr><td>${label}</td><td class="num"><b>${ours}</b></td><td class="num">${theirs || "—"}</td><td class="num diff">${diff || ""}</td></tr>`;
  const wu = (v, unit) => `${v}<span class="unit">${unit}</span>`;
  const corosT = parseClock(C.thresholdPace);
  const corosRatio = C.intensity != null && C.intensity !== "" ? +C.intensity : null;

  return `
<header class="top"><div class="eyebrow">Worked out from your runs</div><h1>Stats</h1>
${P.detailCount < P.runCount ? `<p class="callout small">${P.detailCount} of ${P.runCount} runs have second-by-second data. Zones, splits and drift use those; the rest count with their averages.</p>` : ""}</header>
${statusCard}
<section class="card">
  <div class="card-head"><h2 class="h2">Fitness and fatigue</h2>
    <div class="seg" role="group" aria-label="Range">${ranges.map(([d, l]) => `<button type="button" data-act="range" data-d="${d}" aria-pressed="${rangeDays === d}">${l}</button>`).join("")}</div></div>
  ${fitChart}
  <h3 class="h3">Fatigue as a share of fitness</h3>
  ${ratioChart}
  <div class="bandkey"><span class="b-drop">&lt;50 detraining</span><span class="b-fresh">50–79 fresh</span><span class="b-keep">80–99 maintaining</span><span class="b-build">100–129 building</span><span class="b-fast">130–149 fast</span><span class="b-over">150+ overload</span></div>
  <details class="howto"><summary>How this is worked out</summary><p>Each activity gets a load from your heart rate (Banister's TRIMP: time weighted more steeply the closer you are to max). Fitness is the 42-day average of daily load, fatigue the 7-day average. The ratio between them is the number to compare with COROS's Intensity Trend. The load units differ from COROS's, so compare trends and ratios rather than absolute values.</p></details>
</section>

<section class="card">
  <h2 class="h2">Aerobic efficiency</h2>
  ${E.now ? `<p class="headline"><b class="num">${mmss(E.now.pace)} /km</b> at ${E.refHr} bpm${E.change != null ? ` <span class="${E.change < 0 ? "good" : E.change > 0 ? "bad" : ""}">${E.change < 0 ? "▲ " + Math.round(-E.change) + " s faster" : E.change > 0 ? "▼ " + Math.round(E.change) + " s slower" : "unchanged"} than 8 weeks ago</span>` : ""}</p>` : ""}
  ${effChart}
  <details class="howto"><summary>How this is worked out</summary><p>Each steady run with an average heart rate near ${E.refHr} bpm is converted to the pace you'd have run at exactly ${E.refHr} bpm, using your heart-rate reserve and the oxygen cost of running. Interval sessions and runs above ${1200} m altitude are left out. Getting faster at the same heart rate means your aerobic engine is improving.</p></details>
</section>

<section class="card">
  <h2 class="h2">Pace discipline</h2>
  ${D.list.length ? `<p>Last 4 weeks: <b>${D.easy.length - easyFast} of ${D.easy.length}</b> easy runs were really easy${D.work.length ? `; workouts: <b>${workBy("ok")}</b> on target, <b>${workBy("fast")}</b> too fast, <b>${workBy("slow")}</b> too slow` : ""}.</p>
  <ul class="checks">${D.list.slice().reverse().map(({ s, c }) => `<li><button type="button" class="checkrow" data-act="goto-session" data-id="${esc(s.id)}"><span class="cr-date">${esc(dayLabel(s.date))} · ${esc(tagOf(s))}</span><span class="verdict v-${c.verdict}"><i aria-hidden="true">${c.verdict === "ok" ? "✓" : c.verdict === "fast" ? "▲" : c.verdict === "slow" ? "▼" : "·"}</i>${esc(c.text)}</span></button></li>`).join("")}</ul>`
  : `<p class="muted">Once planned runs are linked to imported activities, each one gets checked here: easy runs for drifting too fast, workouts for hitting their target pace.</p>`}
  ${sp ? `<h3 class="h3">Intensity mix, last 4 weeks</h3>
  <div class="mix"><i class="m-easy" style="flex:${sp.easy}"></i><i class="m-mod" style="flex:${sp.moderate}"></i><i class="m-hard" style="flex:${sp.hard}"></i></div>
  <div class="mixkey"><span><i class="key m-easy"></i>Easy (Z1–Z2) <b class="num">${pct(sp.easy)}</b></span><span><i class="key m-mod"></i>Moderate (Z3) <b class="num">${pct(sp.moderate)}</b></span><span><i class="key m-hard"></i>Hard (Z4–Z5) <b class="num">${pct(sp.hard)}</b></span></div>
  <p class="foot">${sp.moderate > 0.25 ? "A lot of running in the moderate zone: too hard to recover from, too easy to build speed. Most endurance runners do best with about 80% easy." : sp.easy >= 0.75 ? "Mostly easy, with some hard work on top: a healthy mix." : "Easy share is on the low side; aim for about 80% easy over a typical week."}</p>` : ""}
</section>

<section class="card">
  <h2 class="h2">Race predictions</h2>
  ${P.vdot ? `<p class="muted small">From your best recent effort: ${esc(P.vdot.effort.a.name || "run")} (${esc(dayLabel(P.vdot.effort.a.date))}), ${esc(BEST_LABELS[P.vdot.effort.D] || fmtKm(P.vdot.effort.D / 1000) + " km")} in ${fmtDur(P.vdot.effort.sec)}${P.vdot.effort.inRun ? " inside a longer run" : ""}${P.vdot.older ? ". That's more than 4 months ago, so treat these as optimistic." : "."}</p>
  <div class="tablewrap"><table class="tbl"><thead><tr><th>Distance</th><th>Krok</th><th>COROS</th><th>Diff</th></tr></thead><tbody>${predRows}</tbody></table></div>
  ${P.longest8w < 28 ? `<p class="foot">The marathon time assumes marathon-specific training. Your longest run in the last 8 weeks is ${fmtKm(P.longest8w)} km; without regular 28–35 km long runs, expect to be well slower.</p>` : ""}`
  : `<p class="muted">Needs at least one hard effort of 3 km or more at low altitude in the last year.</p>`}
</section>

<section class="card">
  <h2 class="h2">Your numbers</h2>
  <div class="tiles four">
    <div class="tile"><b class="num">${P.vdot ? P.vdot.value : "—"}</b><span>VDOT</span></div>
    <div class="tile"><b class="num">${P.paces ? mmss(P.paces.T) : "—"}</b><span>Threshold pace</span></div>
    <div class="tile"><b class="num">${P.lthr.value}</b><span>Threshold HR</span></div>
    <div class="tile"><b class="num">${P.maxHr.value}</b><span>Max HR</span></div>
  </div>
  <h3 class="h3">Heart-rate zones</h3>
  <div class="tablewrap"><table class="tbl zones"><tbody>${P.hrZones.map(z => `<tr><td><i class="key z${z.n}"></i>Z${z.n} ${esc(z.name)}</td><td class="num">${z.lo == null ? "below " + (z.hi + 1) : z.hi == null ? z.lo + "+" : z.lo + "–" + z.hi} bpm</td></tr>`).join("")}</tbody></table></div>
  ${P.paces ? `<h3 class="h3">Pace zones</h3>
  <div class="tablewrap"><table class="tbl"><tbody>
    <tr><td>Easy</td><td class="num">${range(P.paces.easy)} /km</td></tr>
    <tr><td>Steady</td><td class="num">${range(P.paces.steady)} /km</td></tr>
    <tr><td>Threshold</td><td class="num">${range(P.paces.threshold)} /km</td></tr>
    <tr><td>Interval</td><td class="num">${range(P.paces.interval)} /km</td></tr>
    <tr><td>Reps</td><td class="num">200 m ${Math.round(P.paces.R * 0.2)} s · 400 m ${Math.round(P.paces.R * 0.4)} s</td></tr>
  </tbody></table></div>` : ""}
  <details class="howto"><summary>How these are worked out</summary>
    <ul>
      <li><b>VDOT</b> is Jack Daniels' fitness score from your best recent performance (last 4 months, sea-level runs). It's not the same scale as COROS's VO2max: COROS estimates oxygen uptake, VDOT measures what you actually run.</li>
      <li><b>Pace zones</b> come from your VDOT, using Daniels' intensities.</li>
      <li><b>Max HR</b> is your highest 15-second average in the last 12 months${P.maxHr.source ? ` (${esc(P.maxHr.source.name || "run")}, ${esc(dayLabel(P.maxHr.source.date))})` : ""}${P.maxHr.overridden ? "; currently overridden in Settings" : ""}.</li>
      <li><b>Threshold HR</b> is the middle of: ${P.lthr.estimates.map(e => `${e.v} (${esc(e.how)})`).join("; ") || "no estimates yet"}${P.lthr.overridden ? ". Currently overridden in Settings" : ""}.</li>
      <li><b>Zones</b> are percentages of threshold HR: below 85%, 85–89, 90–94, 95–99, 100% and up.</li>
    </ul>
  </details>
</section>

<section class="card">
  <div class="card-head"><h2 class="h2">Compared with COROS</h2><button type="button" class="linkbtn" data-act="edit-coros">${Object.keys(C).length ? "Edit" : "Add COROS numbers"}</button></div>
  <div class="tablewrap"><table class="tbl cmpt"><thead><tr><th></th><th>Krok</th><th>COROS</th><th>Diff</th></tr></thead><tbody>
    ${cmpRow("Threshold pace", P.paces ? wu(mmss(P.paces.T), "/km") : "—", corosT ? wu(mmss(corosT), "/km") : "", P.paces && corosT ? signed(Math.round(P.paces.T - corosT), " s") : "")}
    ${cmpRow("Threshold HR", wu(P.lthr.value, "bpm"), C.lthr ? wu(esc(C.lthr), "bpm") : "", C.lthr ? signed(P.lthr.value - +C.lthr) : "")}
    ${cmpRow("Fitness score", P.vdot ? wu(P.vdot.value, "VDOT") : "—", C.vo2max ? wu(esc(C.vo2max), "VO2max") : "", "")}
    ${cmpRow("Load ratio", st && st.pct != null ? Math.round(st.pct) + "%" : "—", corosRatio != null ? corosRatio + "%" : "", st && st.pct != null && corosRatio != null ? signed(Math.round(st.pct - corosRatio), " pts") : "")}
  </tbody></table></div>
  ${C.date ? `<p class="foot">COROS numbers entered on ${esc(dayLabel(C.date))}. Update them now and then to keep the comparison fair.</p>` : `<p class="foot">Type in what COROS shows (Running Fitness and Training Status) to see both side by side.</p>`}
</section>

<section class="card">
  <h2 class="h2">Heart-rate zones per week</h2>
  ${zChart}
</section>

${P.records.length ? `<section class="card">
  <h2 class="h2">Personal bests</h2>
  <div class="tablewrap"><table class="tbl"><tbody>${P.records.map(r => `<tr><td>${esc(r.label)}</td><td class="num"><b>${fmtDur(r.sec)}</b></td><td class="muted small">${esc(r.a.name || "")}<br>${esc(dayLabel(r.a.date))} ${r.a.date.slice(0, 4)}</td></tr>`).join("")}</tbody></table></div>
  <p class="foot">Fastest stretch of each distance inside any run, so it can beat your official race result.</p>
</section>` : ""}`;
}

function openCorosSheet() {
  const C = S.settings.coros || {};
  const f = (id, label, val, ph, mode) => `<label>${label}<input id="${id}" type="text" ${mode ? `inputmode="${mode}"` : ""} autocomplete="off" placeholder="${ph}" value="${esc(val == null ? "" : val)}"></label>`;
  openSheet(`<h2 class="sheet-title">COROS numbers</h2>
  <p class="muted">From the COROS app: Running Fitness and Training Status.</p>
  <form class="form" id="corosForm">
    <div class="row3">${f("c-vo2", "VO2max", C.vo2max, "e.g. 55", "decimal")}${f("c-tp", "Threshold pace", C.thresholdPace, "m:ss")}${f("c-lthr", "Threshold HR", C.lthr, "bpm", "numeric")}</div>
    <div class="row2">${f("c-p5", "5 km", C.p5, "mm:ss")}${f("c-p10", "10 km", C.p10, "mm:ss")}</div>
    <div class="row2">${f("c-phm", "Half marathon", C.phm, "h:mm:ss")}${f("c-pm", "Marathon", C.pm, "h:mm:ss")}</div>
    <div class="row3">${f("c-bf", "Base Fitness", C.baseFitness, "e.g. 50", "numeric")}${f("c-li", "Load Impact", C.loadImpact, "e.g. 40", "numeric")}${f("c-it", "Intensity Trend %", C.intensity, "%", "numeric")}</div>
    <div class="sheet-actions"><button type="submit" class="btn primary">Save</button></div>
  </form>`);
  $("#corosForm").addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $(id).value.trim();
    S.settings.coros = { vo2max: v("#c-vo2"), thresholdPace: v("#c-tp"), lthr: v("#c-lthr"), p5: v("#c-p5"), p10: v("#c-p10"), phm: v("#c-phm"), pm: v("#c-pm"), baseFitness: v("#c-bf"), loadImpact: v("#c-li"), intensity: v("#c-it"), date: todayISO() };
    Object.keys(S.settings.coros).forEach(k => { if (S.settings.coros[k] === "") delete S.settings.coros[k]; });
    await saveSettings();
    closeSheet();
    toast("Saved");
    if (S.view === "stats") route();
  });
}

/* ---------------- settings ---------------- */
function localStorageGet(k) { try { return localStorage.getItem("laufbuch:" + k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem("laufbuch:" + k, v); } catch (e) { /* ignore */ } }

function settingsHTML() {
  const st = S.settings;
  const P = S.P;
  const th = st.theme || "system";
  return `
<header class="top"><div class="eyebrow">Preferences and data</div><h1>Settings</h1></header>
${!isStandalone() ? `<section class="card note"><h2 class="h2">Install on your iPhone</h2><p>Open this page in Safari, tap the Share button, then <b>Add to Home Screen</b>. The app then opens full-screen and works without a connection.</p></section>` : ""}
<section class="card">
  <h2 class="h2">Appearance</h2>
  <div class="seg wide" role="group" aria-label="Theme">${[["system", "Automatic"], ["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button type="button" data-act="theme" data-t="${k}" aria-pressed="${th === k}">${l}</button>`).join("")}</div>
</section>
<section class="card">
  <h2 class="h2">Heart rate</h2>
  <div class="form">
    <label>Resting heart rate<input data-set="restHr" type="text" inputmode="numeric" value="${esc(st.restHr)}"></label>
  </div>
  <p class="foot">The one number Krok can't see in your runs. Take it in bed right after waking. It's used for training load and efficiency.</p>
  <details class="howto"><summary>Override computed values</summary>
    <p class="foot">Leave empty to let Krok work them out${P ? ` (now: max ${P.maxHr.auto || "—"}, threshold ${P.lthr.auto || "—"})` : ""}. Only fill these in if a sensor glitch throws the numbers off.</p>
    <div class="row2">
      <label>Max HR<input data-set="maxHrOverride" type="text" inputmode="numeric" placeholder="auto" value="${esc(st.maxHrOverride || "")}"></label>
      <label>Threshold HR<input data-set="lthrOverride" type="text" inputmode="numeric" placeholder="auto" value="${esc(st.lthrOverride || "")}"></label>
    </div>
  </details>
</section>
<section class="card">
  <h2 class="h2">Plan</h2>
  <div class="form"><label>Block name<input data-set="blockName" type="text" value="${esc(S.block.name)}"></label></div>
  <div class="btnrow">
    <button type="button" class="btn" data-act="add-run">Add a run</button>
    <button type="button" class="btn ghost" data-act="restore-plan" data-confirm="Tap again to restore">Restore original plan</button>
  </div>
  <p class="foot">Restoring brings back the original sessions and undoes your edits to them. What you logged on those runs is kept, and runs you added yourself stay.</p>
</section>
<section class="card">
  <h2 class="h2">Backup</h2>
  <p>Everything lives on this phone only. Export a backup now and then and keep it in iCloud Drive.</p>
  <div class="btnrow">
    <button type="button" class="btn primary" data-act="export">Export backup</button>
    <button type="button" class="btn" data-act="import-backup">Restore a backup</button>
  </div>
  <p class="foot">Backups include all analysis data but not the per-run charts; re-import the Strava zip after restoring to get those back.</p>
  <p class="foot" id="storageStatus">Checking storage…</p>
</section>
<section class="card">
  <h2 class="h2">Clean up</h2>
  <div class="btnrow">
    <button type="button" class="btn danger ghost" data-act="delete-acts" data-confirm="Tap again to delete ${S.acts.length}">Delete imported activities (${S.acts.length})</button>
    <button type="button" class="btn danger ghost" data-act="erase" data-confirm="Tap again to erase everything">Erase everything</button>
  </div>
  <p class="foot">Erasing removes your log, imports and edits and starts again from the original plan.</p>
</section>
<p class="foot center">${APP_NAME} ${APP_VERSION} · крок за кроком</p>`;
}

async function refreshStorageStatus() {
  const el = $("#storageStatus"); if (!el) return;
  let persisted = null, est = null;
  try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (e) { /* ignore */ }
  try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) { /* ignore */ }
  const used = est && est.usage ? (est.usage / 1024 / 1024).toFixed(1) + " MB used." : "";
  el.textContent = [persisted === true ? "Storage is protected from automatic clean-up." : persisted === false ? "Opening the app regularly from the Home Screen keeps its storage safe." : "", used].filter(Boolean).join(" ");
}

async function saveSetting(key, value) {
  if (key === "blockName") { S.block.name = value || "Training"; await setKV("block", S.block); return; }
  if (["restHr", "maxHrOverride", "lthrOverride"].includes(key)) {
    const n = parseInt(value, 10);
    S.settings[key] = isFinite(n) && n > 25 && n < 240 ? n : (key === "restHr" ? DEFAULT_SETTINGS.restHr : "");
  } else S.settings[key] = value;
  await saveSettings();
  runAnalysis();
}

async function exportBackup() {
  const data = { app: "laufbuch", schema: 2, exportedAt: new Date().toISOString(), block: S.block, settings: S.settings, sessions: S.sessions, activities: S.acts };
  const name = `krok-backup-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  try {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Krok backup" }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function restoreBackup(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("That file isn't a Krok backup."); return; }
  if (!data || data.app !== "laufbuch" || !Array.isArray(data.sessions)) { toast("That file isn't a Krok backup."); return; }
  await clearStore("sessions"); await clearStore("activities"); await clearStore("streams");
  await putMany("sessions", data.sessions);
  await putMany("activities", (data.activities || []).map(a => { const c = { ...a }; delete c.hasStream; return c; }));
  await setKV("block", data.block || DEFAULT_BLOCK);
  await setKV("settings", data.settings || DEFAULT_SETTINGS);
  await setKV("seeded", true);
  await load();
  applyTheme();
  route();
  toast(`Backup restored: ${data.sessions.length} runs in the plan, ${(data.activities || []).length} imported activities`);
}

async function restorePlan() {
  const keep = {};
  S.sessions.forEach(s => { keep[s.id] = s; });
  const logFields = ["status", "actualKm", "pace", "effort", "note", "activityId"];
  const restored = DEFAULT_SESSIONS.map(d => {
    const old = keep[d.id];
    const s = { ...d };
    if (old) logFields.forEach(k => { if (old[k] != null && old[k] !== "") s[k] = old[k]; });
    return s;
  });
  const userAdded = S.sessions.filter(s => s.id.startsWith("u-"));
  await clearStore("sessions");
  await putMany("sessions", restored.concat(userAdded));
  S.block = { ...structuredClone(DEFAULT_BLOCK), name: S.block.name };
  await setKV("block", S.block);
  S.sessions = restored.concat(userAdded).sort(byDate);
  runAnalysis();
  toast("Original plan restored");
  route();
}

/* ---------------- sheet ---------------- */
let lastFocus = null;
function openSheet(html) {
  lastFocus = document.activeElement;
  $("#sheetBody").innerHTML = html;
  const sh = $("#sheet");
  sh.hidden = false;
  $(".sheet").style.transform = "";
  $(".sheet").scrollTop = 0;
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => { sh.classList.add("in"); $(".sheet").focus({ preventScroll: true }); });
  bindCharts($("#sheetBody"));
}
function closeSheet() {
  const sh = $("#sheet");
  if (sh.hidden) return;
  sh.classList.remove("in");
  document.body.classList.remove("sheet-open");
  setTimeout(() => { sh.hidden = true; $("#sheetBody").innerHTML = ""; $(".sheet").style.transform = ""; }, reduced() ? 0 : 200);
  if (lastFocus && lastFocus.isConnected) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}
// Swipe the sheet down to close it.
function bindSheetSwipe() {
  const sheet = $(".sheet");
  let y0 = null, dy = 0;
  sheet.addEventListener("touchstart", e => { if (sheet.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } else y0 = null; }, { passive: true });
  sheet.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0 && sheet.scrollTop <= 0) { sheet.style.transition = "none"; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener("touchend", () => {
    if (y0 == null) return;
    sheet.style.transition = "";
    if (dy > 90) closeSheet(); else sheet.style.transform = "";
    y0 = null;
  });
}

/* ---------------- events ---------------- */
async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const card = btn.closest("article.run");
  const id = card ? card.dataset.id : null;
  switch (act) {
    case "status": await setStatus(id, btn.dataset.s); break;
    case "details": {
      const open = !card.classList.contains("open");
      card.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Close" : "Details";
      break;
    }
    case "guide-sheet": openGuideSheet(btn.dataset.type); break;
    case "open-guide": closeSheet(); location.hash = "#guide/" + btn.dataset.type; break;
    case "edit": openEditSheet(id); break;
    case "add-run": {
      const t = todayISO();
      const f = S.block.weeks[0];
      openEditSheet(null, f && t < f.start ? f.start : t);
      break;
    }
    case "delete-session": if (armed(btn)) await deleteSession(btn.dataset.id); break;
    case "week": {
      const el = document.getElementById("week-" + btn.dataset.n);
      if (el) el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
      break;
    }
    case "next-go": goRun(btn.dataset.id); break;
    case "close-sheet": closeSheet(); break;
    case "dismiss-install": localStorageSet("installDismissed", "1"); btn.closest(".hint").remove(); break;
    case "import": $("#importInput").click(); break;
    case "filter": S.histFilter = btn.dataset.f; route(); break;
    case "range": S.statsRange = +btn.dataset.d; { const y = window.scrollY; route(); window.scrollTo(0, y); } break;
    case "act": openActSheet(btn.dataset.id); break;
    case "link": await linkActivity(btn.dataset.session, btn.dataset.actId); break;
    case "unlink": await unlink(btn.dataset.session); break;
    case "delete-act": if (armed(btn)) await deleteActivity(btn.dataset.id); break;
    case "goto-session": closeSheet(); S.pendingScroll = btn.dataset.id; if (S.view === "plan") route(); else location.hash = "#plan"; break;
    case "goto-runs": location.hash = "#runs"; break;
    case "edit-coros": openCorosSheet(); break;
    case "theme": S.settings.theme = btn.dataset.t; await saveSettings(); applyTheme(); document.querySelectorAll('[data-act="theme"]').forEach(b => b.setAttribute("aria-pressed", String(b === btn))); break;
    case "export": await exportBackup(); break;
    case "import-backup": $("#backupInput").click(); break;
    case "restore-plan": if (armed(btn)) await restorePlan(); break;
    case "delete-acts": if (armed(btn)) {
      const ids = S.acts.map(a => a.id);
      await delMany("activities", ids);
      try { await clearStore("streams"); } catch (err) { /* ignore */ }
      for (const s of S.sessions.filter(s => s.activityId)) { const c = { ...s }; delete c.activityId; await saveSession(c); }
      S.acts = [];
      runAnalysis();
      toast(`Deleted ${ids.length} imported activities`);
      route();
    } break;
    case "erase": if (armed(btn)) {
      await clearStore("activities"); await clearStore("kv");
      try { await clearStore("streams"); } catch (err) { /* ignore */ }
      await seed(); await load();
      applyTheme();
      toast("Everything erased. You're back to the original plan.");
      location.hash = "#plan"; route();
    } break;
    case "update-app": if (window.__waitingSW) window.__waitingSW.postMessage({ type: "SKIP_WAITING" }); break;
  }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.field) {
    const card = t.closest("article.run"); if (!card) return;
    const id = card.dataset.id;
    clearTimeout(logTimers[id]);
    logTimers[id] = setTimeout(() => commitLog(id), 800);
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.dataset.field) {
    const card = t.closest("article.run"); if (!card) return;
    clearTimeout(logTimers[card.dataset.id]);
    await commitLog(card.dataset.id);
  } else if (t.dataset.set) {
    await saveSetting(t.dataset.set, t.value.trim());
    toast("Saved", 1200);
  } else if (t.id === "importInput") {
    await handleImport(t.files); t.value = "";
  } else if (t.id === "backupInput") {
    await restoreBackup(t.files && t.files[0]); t.value = "";
  }
}

/* ---------------- service worker ---------------- */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").then(reg => {
    const show = w => { window.__waitingSW = w; $("#updateBar").hidden = false; };
    if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) show(nw); });
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloading || !window.__waitingSW) return; reloading = true; location.reload(); });
}

/* ---------------- start ---------------- */
async function start() {
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
  window.addEventListener("hashchange", () => { closeSheet(); route(); });
  window.addEventListener("pagehide", () => { Object.keys(logTimers).forEach(id => { clearTimeout(logTimers[id]); commitLog(id); }); });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  bindSheetSwipe();
  registerSW();
  try {
    await load();
  } catch (e) {
    $("#view").innerHTML = `<div class="card"><h2 class="h2">The app couldn't open its storage</h2><p>${esc(e.message || e)}</p><p>Private browsing blocks storage. Open the app normally or from the Home Screen.</p></div>`;
    return;
  }
  applyTheme();
  route();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
  let lastDay = todayISO();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && todayISO() !== lastDay) { lastDay = todayISO(); runAnalysis(); if (S.view === "plan" || S.view === "stats") route(); }
  });
}

start();
