import { openDB, getAll, put, putMany, del, delMany, clearStore, getKV, setKV } from "./db.js";
import { DEFAULT_BLOCK, DEFAULT_SESSIONS, DEFAULT_SETTINGS } from "./plan.js";
import { TYPES, TYPE_ORDER, COMPARE } from "./guide.js";
import { parseFiles, localISO } from "./importers.js";

const APP_VERSION = "1.0.0";
const S = { sessions: [], acts: [], settings: null, block: null, view: "plan", histFilter: "runs", ready: false };

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

function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function fmtPace(sec, km) {
  if (!sec || !km) return "";
  const p = Math.round(sec / km);
  return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, "0")}`;
}
function dayLabel(iso) { const d = parseISO(iso); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; }
function mondayISO(iso) { const d = parseISO(iso); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return localISO(d); }
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return localISO(d); }
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

// Two-tap confirmation for destructive buttons (iOS web apps can't rely on confirm()).
function armed(btn) {
  if (btn.dataset.armed === "1") return true;
  btn.dataset.armed = "1";
  btn.dataset.label = btn.textContent;
  btn.textContent = btn.dataset.confirm || "Tap again to confirm";
  btn.classList.add("armed");
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed === "1") { btn.dataset.armed = ""; btn.textContent = btn.dataset.label; btn.classList.remove("armed"); } }, 4000);
  return false;
}

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
  if (!Array.isArray(S.settings.zones) || !S.settings.zones.length) S.settings.zones = structuredClone(DEFAULT_SETTINGS.zones);
}

// Updates memory at once (so the screen can update immediately), then writes to storage.
function saveSession(s) {
  const i = S.sessions.findIndex(x => x.id === s.id);
  if (i >= 0) S.sessions[i] = s; else S.sessions.push(s);
  S.sessions.sort(byDate);
  return put("sessions", s).catch(e => toast("Couldn't save. " + (e.message || "")));
}

/* ---------------- routing ---------------- */
function route() {
  const h = (location.hash || "#plan").slice(1);
  const [view, arg] = h.split("/");
  S.view = ["plan", "runs", "guide", "settings"].includes(view) ? view : "plan";
  document.querySelectorAll(".tabbar a").forEach(a => a.setAttribute("aria-current", a.dataset.view === S.view ? "page" : "false"));
  const v = $("#view");
  if (S.view === "plan") { v.innerHTML = planHTML(); refreshPlan(); }
  else if (S.view === "runs") v.innerHTML = runsHTML();
  else if (S.view === "guide") v.innerHTML = guideHTML(arg);
  else v.innerHTML = settingsHTML();
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
    </div>
    <div class="km"><b>${esc(kmLabel(s))}</b><span>km</span></div>
  </div>
  <div class="controls" role="group" aria-label="Status for ${esc(dayLabel(s.date))}">
    <button type="button" class="st" data-act="status" data-s="done" aria-pressed="false" aria-label="Done"><span class="g">✓</span><span class="t">Done</span></button>
    <button type="button" class="st" data-act="status" data-s="changed" aria-pressed="false" aria-label="Changed"><span class="g">≈</span><span class="t">Changed</span></button>
    <button type="button" class="st" data-act="status" data-s="missed" aria-pressed="false" aria-label="Missed"><span class="g">✕</span><span class="t">Missed</span></button>
    <button type="button" class="more" data-act="details" aria-expanded="false">Details</button>
  </div>
  <div class="log" hidden>
    <label>Actual km<input id="f-km-${esc(s.id)}" data-field="actualKm" type="text" inputmode="decimal" autocomplete="off" placeholder="Planned ${esc(kmLabel(s))}" value="${esc(s.actualKm || "")}"></label>
    <label>${s.type === "tt" ? "Time or avg pace" : "Avg pace"}<input id="f-pace-${esc(s.id)}" data-field="pace" type="text" autocomplete="off" placeholder="${s.type === "tt" ? "e.g. 37:52" : "e.g. 4:32"}" value="${esc(s.pace || "")}"></label>
    <label>Effort<select id="f-eff-${esc(s.id)}" data-field="effort"><option value="">–</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}" ${String(s.effort) === String(n) ? "selected" : ""}>${n}/10${n === 2 ? " easy" : n === 5 ? " steady" : n === 7 ? " hard" : n === 10 ? " max" : ""}</option>`).join("")}</select></label>
    <label class="full">Notes<textarea id="f-note-${esc(s.id)}" data-field="note" placeholder="How it felt, splits, heart rate, anything off">${esc(s.note || "")}</textarea></label>
    <div class="full log-actions"><button type="button" class="linkbtn" data-act="edit">Edit or move this run</button></div>
  </div>
</article>`;
}

function planHTML() {
  const { groups, other } = planGroups();
  const cw = currentWeekN();
  const first = S.block.weeks[0], last = S.block.weeks[S.block.weeks.length - 1];
  const range = first && last ? `${dayLabel(first.start).slice(4)} – ${dayLabel(last.end).slice(4)} · ${S.block.weeks.length} weeks` : "";
  const showInstall = !isStandalone() && !localStorageGet("installDismissed");
  return `
<header class="top">
  <div class="eyebrow">${esc(range)}</div>
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
  linked.innerHTML = a ? `<button type="button" class="linkchip" data-act="act" data-id="${esc(a.id)}">↳ ${esc(a.source)} · ${fmtKm(a.distanceKm)} km${a.movingSec ? " · " + fmtPace(a.movingSec, a.distanceKm) + " /km" : ""}${a.avgHr ? " · " + a.avgHr + " bpm" : ""}</button>` : "";
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
  // Typing a distance or pace on an unmarked run counts as doing it.
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
  const s = {
    ...base,
    date, type,
    title: $("#e-title").value.trim() || TYPES[type].name,
    detail: $("#e-detail").value.trim(),
    km,
    label: $("#e-label").value.trim() || undefined
  };
  if (!s.label) delete s.label;
  if (id && base.km !== km) delete s.kmLabel;
  await saveSession(s);
  closeSheet();
  S.pendingScroll = s.id;
  if (S.view === "plan") route(); else location.hash = "#plan";
  toast(id ? "Run updated" : "Run added");
}

async function deleteSession(id) {
  S.sessions = S.sessions.filter(s => s.id !== id);
  await del("sessions", id);
  closeSheet();
  if (S.view === "plan") { const y = window.scrollY; route(); window.scrollTo(0, y); }
  toast("Run deleted");
}

/* ---------------- guide ---------------- */
function zoneFor(key) { return key ? (S.settings.zones || []).find(z => z.key === key) : null; }

function guideEntryHTML(key, full) {
  const t = TYPES[key]; if (!t) return "";
  const z = zoneFor(t.zone);
  return `
  <p class="g-short">${esc(t.short)}</p>
  <dl class="g-dl">
    <dt>What it is</dt><dd>${esc(t.what)}</dd>
    <dt>Why you do it</dt><dd>${esc(t.why)}</dd>
    <dt>How it should feel</dt><dd>${esc(t.feel)}</dd>
    ${z ? `<dt>Your pace</dt><dd><b>${esc(z.pace)}</b>${z.hr && z.hr !== "ignore" ? ` · HR ${esc(z.hr)}` : ""} <span class="muted">(${esc(z.name)} zone)</span></dd>` : ""}
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
<p class="lede">What each kind of run is for and how it should feel. Paces come from your zones in Settings.</p></header>
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

/* ---------------- runs (imported activities) ---------------- */
function runsHTML() {
  const runs = S.acts.filter(a => S.histFilter === "all" || a.isRun);
  const allRuns = S.acts.filter(a => a.isRun);
  // Weekly km, last 12 weeks, runs only.
  const thisMon = mondayISO(todayISO());
  const weeks = [];
  for (let i = 11; i >= 0; i--) weeks.push({ mon: addDays(thisMon, -7 * i), km: 0 });
  for (const a of allRuns) {
    const m = mondayISO(a.date);
    const w = weeks.find(w => w.mon === m);
    if (w) w.km += a.distanceKm || 0;
  }
  const maxKm = Math.max(10, ...weeks.map(w => w.km));
  const total12 = weeks.reduce((x, w) => x + w.km, 0);
  const linkedIds = new Set(S.sessions.filter(s => s.activityId).map(s => s.activityId));
  const byMonth = [];
  for (const a of runs) {
    const key = a.date.slice(0, 7);
    let g = byMonth[byMonth.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; byMonth.push(g); }
    g.items.push(a);
  }
  return `
<header class="top"><div class="eyebrow">Imported from Strava and COROS</div><h1>Runs</h1></header>
<section class="card">
  <h2 class="h2">Import runs</h2>
  <p>Add files exported from Strava or COROS. A run on a day with a planned session is logged against it automatically.</p>
  <button type="button" class="btn primary" data-act="import">Choose files</button>
  <details class="howto"><summary>Where do I get these files?</summary>
    <ul>
      <li><b>Your whole Strava history:</b> on strava.com in a browser, open Settings → My Account → Download or Delete Your Account → Request your archive. Strava emails you a zip. Open it in the Files app, then import <i>activities.csv</i> from it. Menu names can differ slightly.</li>
      <li><b>One Strava run:</b> open the activity on strava.com, tap the ⋯ menu and choose Export GPX, or Export Original for the watch's FIT file.</li>
      <li><b>COROS:</b> in COROS Training Hub on the web, open an activity and export it as FIT, TCX or GPX.</li>
    </ul>
    <p class="foot">Accepted: .csv (Strava archive), .fit, .gpx, .tcx, and .gz versions of these.</p>
  </details>
</section>
<section class="card">
  <div class="card-head"><h2 class="h2">Weekly running km</h2><span class="muted num">${fmtKm(total12)} km in 12 weeks</span></div>
  <div class="wchart" role="img" aria-label="Running kilometres per week for the last 12 weeks">
    ${weeks.map((w, i) => `<div class="wcol${w.mon === thisMon ? " now" : ""}"><span class="wv num">${w.km ? Math.round(w.km) : ""}</span><span class="wbar"><i style="height:${(w.km / maxKm * 100).toFixed(1)}%"></i></span><span class="wl">${(weeks.length - 1 - i) % 2 === 0 ? `${parseISO(w.mon).getDate()}.${parseISO(w.mon).getMonth() + 1}` : ""}</span></div>`).join("")}
  </div>
  <p class="foot">Weeks start on Monday; the label is that Monday's date.</p>
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
    <span class="a-main"><span class="a-name">${esc(a.name || a.sport)}</span><span class="a-meta">${a.isRun ? "" : esc(a.sport) + " · "}${a.movingSec ? fmtDur(a.movingSec) : ""}${a.isRun && a.movingSec ? " · " + fmtPace(a.movingSec, a.distanceKm) + " /km" : ""}${a.avgHr ? " · " + a.avgHr + " bpm" : ""}${linkedIds.has(a.id) ? ` · <span class="ok">in plan</span>` : ""}</span></span>
    <span class="a-km num">${fmtKm(a.distanceKm)}<small>km</small></span>
  </button></li>`).join("")}</ul>`;
}).join("") : `<p class="empty">${S.acts.length ? "No runs among the imported activities." : "Nothing imported yet. Your Strava archive is the quickest way to bring in your history."}</p>`}`;
}

function openActSheet(id) {
  const a = actById(id); if (!a) return;
  const linked = S.sessions.find(s => s.activityId === a.id);
  const near = S.sessions.filter(s => s.date >= addDays(a.date, -3) && s.date <= addDays(a.date, 3) && s.id !== (linked && linked.id));
  const st = new Date(a.start);
  const stat = (label, val) => val ? `<div class="kv"><span>${label}</span><b class="num">${val}</b></div>` : "";
  openSheet(`
<div class="eyebrow">${esc(a.sport)} · ${esc(a.source)}</div>
<h2 class="sheet-title">${esc(a.name || a.sport)}</h2>
<p class="muted">${esc(dayLabel(a.date))}, ${String(st.getHours()).padStart(2, "0")}:${String(st.getMinutes()).padStart(2, "0")}</p>
<div class="kvgrid">
  ${stat("Distance", fmtKm(a.distanceKm) + " km")}
  ${stat("Moving time", a.movingSec ? fmtDur(a.movingSec) : "")}
  ${stat("Pace", a.movingSec && a.distanceKm ? fmtPace(a.movingSec, a.distanceKm) + " /km" : "")}
  ${stat("Elapsed", a.elapsedSec && a.elapsedSec !== a.movingSec ? fmtDur(a.elapsedSec) : "")}
  ${stat("Avg HR", a.avgHr ? a.avgHr + " bpm" : "")}
  ${stat("Max HR", a.maxHr ? a.maxHr + " bpm" : "")}
  ${stat("Climb", a.elevGain ? a.elevGain + " m" : "")}
</div>
<h3 class="h3">In your plan</h3>
${linked ? `<div class="linkedbox"><div><b>${esc(dayLabel(linked.date))}</b> · ${esc(tagOf(linked))}<br><span class="muted">${esc(linked.title)}</span></div>
  <div class="row-actions"><button type="button" class="btn small" data-act="goto-session" data-id="${esc(linked.id)}">Show</button><button type="button" class="btn small ghost" data-act="unlink" data-session="${esc(linked.id)}" data-act-id="${esc(a.id)}">Unlink</button></div></div>` :
  `<p class="muted">Not linked to a planned run.</p>`}
${near.length ? `<p class="small-h">${linked ? "Move it to another run" : "Link it to a planned run"}</p><div class="pick">${near.map(s => `<button type="button" class="pickrow" data-act="link" data-session="${esc(s.id)}" data-act-id="${esc(a.id)}"><span>${esc(dayLabel(s.date))} · ${esc(tagOf(s))}</span><span class="muted">${esc(s.title)} · ${esc(kmLabel(s))} km${s.activityId ? " · linked" : ""}</span></button>`).join("")}</div>` : ""}
<div class="sheet-actions"><button type="button" class="btn danger ghost" data-act="delete-act" data-id="${esc(a.id)}" data-confirm="Tap again to delete">Delete this activity</button></div>`);
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
  for (const o of S.sessions.filter(x => x.activityId === actId && x.id !== sessionId)) {
    const c = { ...o }; delete c.activityId; await saveSession(c);
  }
  await saveSession(applyLink(s, a));
  closeSheet();
  toast("Linked to " + dayLabel(s.date));
  if (S.view === "runs") route();
}

async function unlink(sessionId) {
  const s = sessionById(sessionId); if (!s) return;
  const c = { ...s }; delete c.activityId;
  await saveSession(c);
  closeSheet();
  toast("Unlinked. The logged values stay; edit them in the plan if needed.");
  if (S.view === "runs") route(); else if (S.view === "plan") { refreshCard(sessionId); refreshPlanSummary(); }
}

async function deleteActivity(id) {
  for (const o of S.sessions.filter(x => x.activityId === id)) { const c = { ...o }; delete c.activityId; await saveSession(c); }
  S.acts = S.acts.filter(a => a.id !== id);
  await del("activities", id);
  closeSheet();
  if (S.view === "runs") route();
  toast("Activity deleted");
}

async function handleImport(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  toast("Reading " + files.length + (files.length === 1 ? " file…" : " files…"), 60000);
  const loaded = [];
  for (const f of files) {
    try { loaded.push({ name: f.name, buffer: await f.arrayBuffer() }); }
    catch (e) { loaded.push({ name: f.name, buffer: new ArrayBuffer(0) }); }
  }
  const { activities, problems } = await parseFiles(loaded);

  // Skip anything already imported, including the same run from a different source.
  const existingIds = new Set(S.acts.map(a => a.id));
  const byDay = {};
  S.acts.forEach(a => { (byDay[a.date] = byDay[a.date] || []).push(a); });
  const fresh = [];
  let dupes = 0;
  for (const a of activities) {
    const same = existingIds.has(a.id) || (byDay[a.date] || []).some(b =>
      Math.abs(Date.parse(b.start) - Date.parse(a.start)) < 180000 &&
      Math.abs((b.distanceKm || 0) - (a.distanceKm || 0)) <= Math.max(0.2, 0.03 * (a.distanceKm || 0)));
    if (same) { dupes++; continue; }
    existingIds.add(a.id);
    (byDay[a.date] = byDay[a.date] || []).push(a);
    fresh.push(a);
  }
  if (fresh.length) {
    try { await putMany("activities", fresh); }
    catch (e) { toast("Couldn't save the imported runs: " + (e.message || e)); return; }
    S.acts = S.acts.concat(fresh).sort((a, b) => (a.start < b.start ? 1 : -1));
  }

  // Log new runs against planned sessions on the same day.
  let matched = 0;
  for (const a of fresh.filter(a => a.isRun).sort((x, y) => (x.start < y.start ? -1 : 1))) {
    const cands = S.sessions.filter(s => s.date === a.date && !s.activityId && s.status !== "missed");
    if (!cands.length) continue;
    cands.sort((x, y) => (!!x.status - !!y.status) || Math.abs((x.km || 0) - a.distanceKm) - Math.abs((y.km || 0) - a.distanceKm));
    await saveSession(applyLink(cands[0], a));
    matched++;
  }

  const parts = [];
  parts.push(fresh.length ? `Imported ${fresh.length} ${fresh.length === 1 ? "activity" : "activities"}` : "Nothing new to import");
  if (matched) parts.push(`${matched} logged in your plan`);
  if (dupes) parts.push(`${dupes} already here`);
  toast(parts.join(" · "), 5000);
  if (S.view === "runs") route();
  if (problems.length) {
    openSheet(`<h2 class="sheet-title">Some files couldn't be read</h2><ul class="problems">${problems.map(p => `<li><b>${esc(p.name)}</b><br><span class="muted">${esc(p.reason)}</span></li>`).join("")}</ul>`);
  }
}

/* ---------------- settings ---------------- */
function localStorageGet(k) { try { return localStorage.getItem("laufbuch:" + k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem("laufbuch:" + k, v); } catch (e) { /* ignore */ } }

function settingsHTML() {
  const st = S.settings;
  return `
<header class="top"><div class="eyebrow">Your numbers and your data</div><h1>Settings</h1></header>
${!isStandalone() ? `<section class="card note"><h2 class="h2">Install on your iPhone</h2><p>Open this page in Safari, tap the Share button, then <b>Add to Home Screen</b>. The app then opens full-screen and works without a connection.</p></section>` : ""}
<section class="card">
  <h2 class="h2">Heart rate and threshold</h2>
  <div class="form">
    <div class="row3">
      <label>Max HR<input data-set="maxHr" type="text" inputmode="numeric" value="${esc(st.maxHr)}"></label>
      <label>Threshold HR<input data-set="thresholdHr" type="text" inputmode="numeric" value="${esc(st.thresholdHr)}"></label>
      <label>Threshold pace<input data-set="thresholdPace" type="text" value="${esc(st.thresholdPace)}"></label>
    </div>
  </div>
  <p class="foot">Used for reference only. The zone paces below are what the guide shows.</p>
</section>
<section class="card">
  <h2 class="h2">Pace zones</h2>
  <div class="zones-edit">
    ${st.zones.map((z, i) => `<fieldset class="zone"><legend>${esc(z.name)}</legend>
      <label class="wide">Pace<input data-zone="${i}" data-zf="pace" type="text" value="${esc(z.pace)}"></label>
      <label>Heart rate<input data-zone="${i}" data-zf="hr" type="text" value="${esc(z.hr)}"></label>
      <label>Feel<input data-zone="${i}" data-zf="feel" type="text" value="${esc(z.feel)}"></label>
    </fieldset>`).join("")}
  </div>
  <p class="foot">After the time trial on Dec 12, update these with your new numbers.</p>
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
  <p>Everything lives on this phone only. Export a backup now and then, and keep it in iCloud Drive or send it to yourself.</p>
  <div class="btnrow">
    <button type="button" class="btn primary" data-act="export">Export backup</button>
    <button type="button" class="btn" data-act="import-backup">Restore a backup</button>
  </div>
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
<p class="foot center">Laufbuch ${APP_VERSION}</p>`;
}

async function refreshStorageStatus() {
  const el = $("#storageStatus"); if (!el) return;
  let persisted = null, est = null;
  try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (e) { /* ignore */ }
  try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) { /* ignore */ }
  const used = est && est.usage ? (est.usage / 1024 / 1024).toFixed(1) + " MB used" : "";
  el.textContent = [persisted === true ? "Storage is protected from automatic clean-up." : persisted === false ? "Opening the app regularly from the Home Screen keeps its storage safe." : "", used].filter(Boolean).join(" ");
}

async function saveSetting(key, value) {
  if (key === "blockName") { S.block.name = value || "Training"; await setKV("block", S.block); return; }
  S.settings[key] = /Hr$/.test(key) ? (parseInt(value, 10) || value) : value;
  await setKV("settings", S.settings);
}

async function saveZone(i, field, value) {
  if (!S.settings.zones[i]) return;
  S.settings.zones[i][field] = value;
  await setKV("settings", S.settings);
}

async function exportBackup() {
  const data = { app: "laufbuch", schema: 1, exportedAt: new Date().toISOString(), block: S.block, settings: S.settings, sessions: S.sessions, activities: S.acts };
  const name = `laufbuch-backup-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  try {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Laufbuch backup" });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function restoreBackup(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("That file isn't a Laufbuch backup."); return; }
  if (!data || data.app !== "laufbuch" || !Array.isArray(data.sessions)) { toast("That file isn't a Laufbuch backup."); return; }
  await clearStore("sessions"); await clearStore("activities");
  await putMany("sessions", data.sessions);
  await putMany("activities", data.activities || []);
  await setKV("block", data.block || DEFAULT_BLOCK);
  await setKV("settings", data.settings || DEFAULT_SETTINGS);
  await setKV("seeded", true);
  await load();
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
  toast("Original plan restored");
  route();
}

/* ---------------- sheet ---------------- */
let lastFocus = null;
function openSheet(html) {
  lastFocus = document.activeElement;
  $("#sheetBody").innerHTML = html;
  $("#sheet").hidden = false;
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => { $("#sheet").classList.add("in"); $(".sheet").focus(); });
}
function closeSheet() {
  const sh = $("#sheet");
  if (sh.hidden) return;
  sh.classList.remove("in");
  document.body.classList.remove("sheet-open");
  setTimeout(() => { sh.hidden = true; $("#sheetBody").innerHTML = ""; }, reduced() ? 0 : 180);
  if (lastFocus && lastFocus.isConnected) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
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
      const log = card.querySelector(".log");
      const open = log.hidden;
      log.hidden = !open;
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
    case "act": openActSheet(btn.dataset.id); break;
    case "link": await linkActivity(btn.dataset.session, btn.dataset.actId); break;
    case "unlink": await unlink(btn.dataset.session); break;
    case "delete-act": if (armed(btn)) await deleteActivity(btn.dataset.id); break;
    case "goto-session": closeSheet(); S.pendingScroll = btn.dataset.id; if (S.view === "plan") route(); else location.hash = "#plan"; break;
    case "export": await exportBackup(); break;
    case "import-backup": $("#backupInput").click(); break;
    case "restore-plan": if (armed(btn)) await restorePlan(); break;
    case "delete-acts": if (armed(btn)) {
      const ids = S.acts.map(a => a.id);
      await delMany("activities", ids);
      for (const s of S.sessions.filter(s => s.activityId)) { const c = { ...s }; delete c.activityId; await saveSession(c); }
      S.acts = [];
      toast(`Deleted ${ids.length} imported activities`);
      route();
    } break;
    case "erase": if (armed(btn)) {
      await clearStore("activities"); await clearStore("kv");
      await seed(); await load();
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
  } else if (t.dataset.zone != null && t.dataset.zf) {
    await saveZone(+t.dataset.zone, t.dataset.zf, t.value.trim());
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
  }).catch(() => { /* offline support unavailable; the app still works online */ });
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
  registerSW();
  try {
    await load();
  } catch (e) {
    $("#view").innerHTML = `<div class="card"><h2 class="h2">The app couldn't open its storage</h2><p>${esc(e.message || e)}</p><p>Private browsing blocks storage. Open the app normally or from the Home Screen.</p></div>`;
    return;
  }
  S.ready = true;
  route();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
  // Refresh "today" markers when the app is reopened on a later day.
  let lastDay = todayISO();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && todayISO() !== lastDay) { lastDay = todayISO(); if (S.view === "plan") route(); }
  });
}

start();
