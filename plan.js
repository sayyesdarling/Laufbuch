// Default training block: Oct 10 – Dec 13, 2026.
// Session `type` keys match the entries in guide.js.

export const DEFAULT_BLOCK = {
  name: "Autumn Block",
  weeks: [
    { n: 0, phase: "Transition", start: "2026-10-10", end: "2026-10-18", note: "Mexico runs are optional. Run by feel there, roughly 5:15–5:50 /km." },
    { n: 1, phase: "Rebuild", start: "2026-10-19", end: "2026-10-25", note: "One light quality session. Lectures start Wednesday." },
    { n: 2, phase: "Benchmark", start: "2026-10-26", end: "2026-11-01", note: "Tuesday is the fitness check: 4:05–4:10 should feel controlled at about 182–188 bpm." },
    { n: 3, phase: "Build", start: "2026-11-02", end: "2026-11-08", note: "" },
    { n: 4, phase: "Lighter week", start: "2026-11-09", end: "2026-11-15", note: "Recovery week: one hard session only." },
    { n: 5, phase: "Build", start: "2026-11-16", end: "2026-11-22", note: "" },
    { n: 6, phase: "Build", start: "2026-11-23", end: "2026-11-29", note: "" },
    { n: 7, phase: "Peak week", start: "2026-11-30", end: "2026-12-06", note: "" },
    { n: 8, phase: "Taper and test", start: "2026-12-07", end: "2026-12-13", note: "Time trial: start around 3:50 /km for the first 3 km, then build. A realistic range is about 37:30–38:15." }
  ]
};

const S = (id, date, type, title, km, detail = "", extra = {}) => ({ id, date, type, title, km, detail, ...extra });

export const DEFAULT_SESSIONS = [
  S("w0-sat", "2026-10-10", "easy", "Easy run by feel", 6, "Mexico City"),
  S("w0-mon", "2026-10-12", "strides", "Easy + 4 strides", 7, "Mexico City"),
  S("w0-thu", "2026-10-15", "shakeout", "Optional 25–30 min shakeout", 4.5, "In daylight, to reset your body clock after the flight", { kmLabel: "4–5" }),
  S("w0-sat2", "2026-10-17", "strides", "Easy + 4 strides", 8),
  S("w0-sun", "2026-10-18", "long", "Easy long run", 11, "No pace target"),

  S("w1-tue", "2026-10-20", "strides", "Easy + 6 strides", 7),
  S("w1-wed", "2026-10-21", "easy", "Easy run", 6, "First day of lectures"),
  S("w1-thu", "2026-10-22", "fartlek", "8 × 1 min at 3:45–3:55", 9, "1 min easy jog between · WU 2 km, CD 2 km"),
  S("w1-sat", "2026-10-24", "strides", "Easy + 6 strides", 6),
  S("w1-sun", "2026-10-25", "long", "Long run, easy", 13),

  S("w2-tue", "2026-10-27", "threshold", "2 × 3 km at 4:05–4:10", 10, "2 min jog between · WU + CD", { label: "Benchmark" }),
  S("w2-wed", "2026-10-28", "easy", "Easy run", 8),
  S("w2-thu", "2026-10-29", "reps", "Easy with 6 × 200 m in 40–42 s", 8, "200 m jog between"),
  S("w2-sat", "2026-10-31", "strides", "Easy + 6 strides", 6),
  S("w2-sun", "2026-11-01", "long", "Long run, easy", 15),

  S("w3-tue", "2026-11-03", "intervals", "5 × 1000 m at 3:42–3:45", 11, "2:30 jog between · WU + CD"),
  S("w3-wed", "2026-11-04", "easy", "Easy run", 8),
  S("w3-thu", "2026-11-05", "tempo", "20 min continuous at 4:02–4:06", 9, "WU + CD"),
  S("w3-sat", "2026-11-07", "strides", "Easy + 6 strides", 7),
  S("w3-sun", "2026-11-08", "long-steady", "Long run, last 3 km steady", 17, "Steady = 4:30–4:40 /km"),

  S("w4-tue", "2026-11-10", "intervals", "6 × 800 m at 3:40–3:44", 10, "2 min jog between · WU + CD"),
  S("w4-wed", "2026-11-11", "easy", "Easy run", 7),
  S("w4-thu", "2026-11-12", "strides", "Easy + 6 strides", 7),
  S("w4-sat", "2026-11-14", "easy", "Easy run", 6),
  S("w4-sun", "2026-11-15", "long", "Long run, easy", 13),

  S("w5-tue", "2026-11-17", "intervals", "6 × 1000 m at 3:40–3:43", 12, "2:30 jog between · WU + CD"),
  S("w5-wed", "2026-11-18", "easy", "Easy run", 8),
  S("w5-thu", "2026-11-19", "tempo", "25 min continuous at 4:00–4:05", 10, "WU + CD"),
  S("w5-sat", "2026-11-21", "strides", "Easy + 6 strides", 7),
  S("w5-sun", "2026-11-22", "long", "Long run, easy", 17),

  S("w6-tue", "2026-11-24", "intervals", "4 × 1600 m at 3:42–3:47", 12, "3 min jog between · WU + CD"),
  S("w6-wed", "2026-11-25", "easy", "Easy run", 8),
  S("w6-thu", "2026-11-26", "reps", "Easy with 8 × 200 m in 40–42 s", 8, "200 m jog between"),
  S("w6-sat", "2026-11-28", "strides", "Easy + 6 strides", 8),
  S("w6-sun", "2026-11-29", "long-steady", "Long run, last 4 km steady", 19, "Steady = 4:25–4:35 /km"),

  S("w7-tue", "2026-12-01", "reps", "10 × 400 m in 82–86 s", 12, "400 m jog between · WU + CD"),
  S("w7-wed", "2026-12-02", "easy", "Easy run", 8),
  S("w7-thu", "2026-12-03", "threshold", "3 × 3 km at 3:58–4:02", 13, "90 s jog between · WU + CD"),
  S("w7-sat", "2026-12-05", "easy", "Easy run", 6),
  S("w7-sun", "2026-12-06", "long", "Long run, easy", 20),

  S("w8-tue", "2026-12-08", "intervals", "4 × 800 m at 3:38–3:42", 9, "2:30 jog between · WU + CD", { label: "Sharpening" }),
  S("w8-wed", "2026-12-09", "easy", "Easy run", 7),
  S("w8-thu", "2026-12-10", "strides", "Easy + 4 strides", 6),
  S("w8-sat", "2026-12-12", "tt", "10 km all-out", 15, "WU 3 km with 4 strides · CD 2 km · PB to beat: 39:18"),
  S("w8-sun", "2026-12-13", "recovery", "Easy recovery run", 8)
];

export const DEFAULT_SETTINGS = {
  maxHr: 210,
  thresholdHr: 190,
  thresholdPace: "4:00",
  zones: [
    { key: "easy", name: "Easy", pace: "5:00–5:35 /km", hr: "below ~165", feel: "Full sentences" },
    { key: "steady", name: "Steady", pace: "4:25–4:40 /km", hr: "165–178", feel: "Short sentences" },
    { key: "threshold", name: "Threshold", pace: "3:58–4:08 /km", hr: "182–190", feel: "Comfortably hard; a few words" },
    { key: "interval", name: "Interval", pace: "3:38–3:45 /km", hr: "195+ late in each rep", feel: "Hard; 3–5 km race effort" },
    { key: "reps", name: "Reps", pace: "200 m 40–42 s · 400 m 82–86 s", hr: "ignore", feel: "Fast but relaxed; full recovery" }
  ]
};
