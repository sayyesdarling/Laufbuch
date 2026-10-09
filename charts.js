// Small SVG charts with a tap/drag crosshair. One y-axis per chart; colours come from CSS tokens.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const registry = new Map();
let uid = 0;

const dayNum = iso => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const isoOf = n => new Date(n * 86400000).toISOString().slice(0, 10);
export const dateLabel = iso => { const d = new Date(dayNum(iso) * 86400000); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

function niceStep(span, count, steps) {
  const raw = span / count;
  if (steps) return steps.find(s => s >= raw) || steps[steps.length - 1];
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const e = raw / mag;
  return (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
}

function yScale(values, o) {
  let min = o.yMin != null ? o.yMin : Math.min(...values);
  let max = o.yMax != null ? o.yMax : Math.max(...values);
  if (o.includeZero) min = Math.min(0, min);
  if (min === max) { min -= 1; max += 1; }
  const step = niceStep(max - min, o.yTicks || 3, o.ySteps);
  const lo = o.yMin != null ? o.yMin : Math.floor(min / step) * step;
  const hi = o.yMax != null ? o.yMax : Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

function dateTicks(x0, x1) {
  const span = x1 - x0;
  const out = [];
  const d0 = new Date(x0 * 86400000);
  if (span > 120) {
    const stepM = span > 500 ? 3 : span > 240 ? 2 : 1;
    let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
    while (d.getTime() / 86400000 <= x1) {
      const n = d.getTime() / 86400000;
      if (d.getUTCMonth() % stepM === 0) out.push({ x: n, label: d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MON[d.getUTCMonth()] });
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
  } else {
    const step = span > 60 ? 14 : 7;
    let n = x0 + ((8 - new Date(x0 * 86400000).getUTCDay()) % 7);   // first Monday
    while (n <= x1) { const d = new Date(n * 86400000); out.push({ x: n, label: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }); n += step; }
  }
  return out;
}

/*
  lineChart({
    title, height, series: [{ label, cls, values: [{ x: "YYYY-MM-DD" | number, y }], area, dots, dashed }],
    xType: "date" | "num", xFormat, yFormat, invert, yMin, yMax, ySteps, bands: [{ y0, y1, cls }],
    tip: (index, x) => lines[]   // optional custom tooltip
  })
*/
export function lineChart(o) {
  const id = "c" + (++uid);
  const W = 360, H = o.height || 170, L = 38, R = 10, T = 12, B = 22;
  const all = o.series.flatMap(s => s.values.filter(v => v.y != null));
  if (!all.length) return `<p class="empty">Not enough data yet.</p>`;
  const xv = v => (o.xType === "num" ? v.x : dayNum(v.x));
  const xs = all.map(xv);
  const x0 = o.xMin != null ? o.xMin : Math.min(...xs), x1 = o.xMax != null ? o.xMax : Math.max(...xs);
  const ys = yScale(all.map(v => v.y), o);
  const px = x => L + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - L - R);
  const py = y => { const f = (y - ys.lo) / (ys.hi - ys.lo); return o.invert ? T + f * (H - T - B) : H - B - f * (H - T - B); };
  const clampY = y => Math.max(T, Math.min(H - B, py(y)));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || "Chart")}" class="chart-svg">`;
  for (const b of o.bands || []) {
    const ya = clampY(b.y0), yb = clampY(b.y1);
    svg += `<rect x="${L}" y="${Math.min(ya, yb)}" width="${W - L - R}" height="${Math.abs(yb - ya)}" class="band ${b.cls || ""}"/>`;
  }
  for (const t of ys.ticks) {
    const y = py(t);
    svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 3.5}" class="axis" text-anchor="end">${esc(o.yFormat ? o.yFormat(t) : t)}</text>`;
  }
  const xt = o.xType === "num" ? (o.xTicks || []) : dateTicks(x0, x1);
  for (const t of xt) svg += `<text x="${px(t.x)}" y="${H - 6}" class="axis" text-anchor="middle">${esc(t.label)}</text>`;
  svg += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="baseline"/>`;
  const defs = [];
  o.series.forEach((s, si) => {
    const pts = s.values.filter(v => v.y != null).map(v => [px(xv(v)), py(v.y)]);
    if (!pts.length) return;
    if (s.area) {
      const gid = id + "g" + si;
      defs.push(`<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a ${s.cls}"/><stop offset="1" class="stop-b ${s.cls}"/></linearGradient>`);
      svg += `<path d="M${pts[0][0]},${H - B} L${pts.map(p => p.join(",")).join(" L")} L${pts[pts.length - 1][0]},${H - B} Z" fill="url(#${gid})" class="area"/>`;
    }
    if (s.dots) {
      svg += pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" class="dot ${s.cls}"/>`).join("");
    } else {
      svg += `<path d="M${pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" L")}" class="line ${s.cls}${s.dashed ? " dashed" : ""}"/>`;
    }
  });
  if (defs.length) svg = svg.replace("class=\"chart-svg\">", `class="chart-svg"><defs>${defs.join("")}</defs>`);
  svg += `<g class="cursor" style="display:none"><line class="cursor-line" y1="${T}" y2="${H - B}"/></g>`;
  svg += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" class="hit"/></svg>`;

  // Cursor positions follow the first series (or `cursorSeries`).
  const cs = o.series[o.cursorSeries || 0];
  const cvals = cs.values.filter(v => v.y != null);
  registry.set(id, {
    W, L, R,
    xs: cvals.map(v => px(xv(v))),
    tip: i => {
      const v = cvals[i];
      if (o.tip) return o.tip(v, i);
      const head = o.xType === "num" ? (o.xFormat ? o.xFormat(v.x) : v.x) : dateLabel(v.x);
      return [head].concat(o.series.map(s => {
        const m = s.values.find(u => xv(u) === xv(v));
        return m && m.y != null ? `${s.label}: ${o.yFormat ? o.yFormat(m.y, true) : Math.round(m.y)}` : null;
      }).filter(Boolean));
    }
  });
  const legend = o.series.length > 1 ? `<div class="legend">${o.series.filter(s => !s.noLegend).map(s => `<span><i class="key ${s.cls}${s.dots ? " dotkey" : ""}"></i>${esc(s.label)}</span>`).join("")}</div>` : "";
  const cap = o.caption ? `<figcaption class="chart-cap">${esc(o.caption)}</figcaption>` : "";
  return `<figure class="chart" data-chart="${id}">${cap}${legend}${svg}<div class="tip" hidden></div></figure>`;
}

/* barChart({ title, height, bars: [{ label, parts: [n…], tip: [lines] }], classes: [cls…], yFormat }) */
export function barChart(o) {
  const id = "c" + (++uid);
  const W = 360, H = o.height || 170, L = 34, R = 8, T = 12, B = 22;
  const totals = o.bars.map(b => b.parts.reduce((x, y) => x + y, 0));
  const ys = yScale(totals.concat([0]), { ...o, includeZero: true });
  const n = o.bars.length;
  const band = (W - L - R) / n, bw = Math.min(22, band * 0.62);
  const py = y => H - B - (y - ys.lo) / (ys.hi - ys.lo) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || "Chart")}" class="chart-svg">`;
  for (const t of ys.ticks) {
    const y = py(t);
    svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 3.5}" class="axis" text-anchor="end">${esc(o.yFormat ? o.yFormat(t) : t)}</text>`;
  }
  o.bars.forEach((b, i) => {
    const cx = L + band * i + band / 2;
    let acc = 0;
    b.parts.forEach((v, k) => {
      if (!v) return;
      const y0 = py(acc), y1 = py(acc + v);
      const h = Math.max(0, y0 - y1 - (acc > 0 ? 1.5 : 0));
      svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${k === b.parts.length - 1 || b.parts.slice(k + 1).every(x => !x) ? 3 : 0}" class="bar ${(o.classes || [])[k] || ""}${b.now ? " now" : ""}"/>`;
      acc += v;
    });
    if (b.label && (o.labelEvery ? (n - 1 - i) % o.labelEvery === 0 : true)) svg += `<text x="${cx}" y="${H - 6}" class="axis" text-anchor="middle">${esc(b.label)}</text>`;
  });
  svg += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="baseline"/>`;
  svg += `<g class="cursor" style="display:none"><line class="cursor-line" y1="${T}" y2="${H - B}"/></g><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" class="hit"/></svg>`;
  registry.set(id, { W, L, R, xs: o.bars.map((b, i) => L + band * i + band / 2), tip: i => o.bars[i].tip || [o.bars[i].label] });
  const legend = o.legend ? `<div class="legend">${o.legend.map((t, k) => `<span><i class="key ${(o.classes || [])[k]}"></i>${esc(t)}</span>`).join("")}</div>` : "";
  return `<figure class="chart" data-chart="${id}">${legend}${svg}<div class="tip" hidden></div></figure>`;
}

/* Attach crosshair + tooltip behaviour to every chart inside root. */
export function bindCharts(root) {
  root.querySelectorAll("figure.chart[data-chart]").forEach(fig => {
    const meta = registry.get(fig.dataset.chart);
    if (!meta || fig.dataset.bound) return;
    fig.dataset.bound = "1";
    const svg = fig.querySelector("svg"), tip = fig.querySelector(".tip"), cur = fig.querySelector(".cursor"), line = fig.querySelector(".cursor-line");
    const show = ev => {
      const r = svg.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width * meta.W;
      let best = 0, bd = Infinity;
      meta.xs.forEach((v, i) => { const d = Math.abs(v - x); if (d < bd) { bd = d; best = i; } });
      const cx = meta.xs[best];
      if (cx == null) return;
      line.setAttribute("x1", cx); line.setAttribute("x2", cx);
      cur.style.display = "";
      tip.innerHTML = meta.tip(best).map((t, i) => i ? `<span>${esc(t)}</span>` : `<b>${esc(t)}</b>`).join("");
      tip.hidden = false;
      const left = cx / meta.W * r.width;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(r.width - tw, left - tw / 2)) + "px";
    };
    const hide = () => { cur.style.display = "none"; tip.hidden = true; };
    svg.addEventListener("pointerdown", e => { show(e); });
    svg.addEventListener("pointermove", e => { if (e.pointerType === "mouse" || e.buttons) show(e); });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("pointercancel", hide);
  });
}

export { dayNum, isoOf };
