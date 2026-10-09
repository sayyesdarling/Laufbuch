// Minimal FIT decoder: reads the session summary (message 18) and the per-second
// records (message 20): time, distance, heart rate, altitude. Handles compressed
// timestamps and developer fields.

const FIT_EPOCH = 631065600; // seconds between 1970-01-01 and 1989-12-31 UTC

const SPORTS = { 0: "Other", 1: "Run", 2: "Ride", 4: "Fitness", 5: "Swim", 10: "Training", 11: "Walk", 13: "Alpine ski", 15: "Rowing", 16: "Mountaineering", 17: "Hike" };

function readVal(dv, off, size, little, baseType) {
  const bt = baseType & 0x1f;
  let v;
  if (size === 1) v = dv.getUint8(off);
  else if (size === 2) v = dv.getUint16(off, little);
  else if (size === 4) v = (bt === 0x08) ? dv.getFloat32(off, little) : dv.getUint32(off, little);
  else return null;
  const invalid = size === 1 ? (bt === 0x0a ? 0 : 0xff) : size === 2 ? (bt === 0x0b ? 0 : 0xffff) : (bt === 0x0c ? 0 : 0xffffffff);
  if (v === invalid || (bt === 0x01 && v === 0x7f) || (bt === 0x03 && v === 0x7fff) || (bt === 0x05 && v === 0x7fffffff)) return null;
  return v;
}

export function parseFIT(buffer) {
  const dv = new DataView(buffer);
  if (dv.byteLength < 14) throw new Error("File is too short to be a FIT file");
  const headerSize = dv.getUint8(0);
  const dataSize = dv.getUint32(4, true);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== ".FIT") throw new Error("Not a FIT file");
  const end = Math.min(headerSize + dataSize, dv.byteLength);
  let off = headerSize;
  const defs = {};
  let lastTs = 0;
  const sessions = [];
  const recT = [], recD = [], recHr = [], recAlt = [];
  let sportFromSport = null, tzOffsetSec = null;

  while (off < end) {
    const hdr = dv.getUint8(off); off += 1;
    let local, isDef = false, hasDev = false, compressedTs = null;
    if (hdr & 0x80) {
      local = (hdr >> 5) & 0x03;
      const offset = hdr & 0x1f;
      let ts = (lastTs & ~0x1f) + offset;
      if (offset < (lastTs & 0x1f)) ts += 0x20;
      compressedTs = ts; lastTs = ts;
    } else {
      local = hdr & 0x0f;
      isDef = !!(hdr & 0x40);
      hasDev = !!(hdr & 0x20);
    }

    if (isDef) {
      off += 1;
      const little = dv.getUint8(off) === 0; off += 1;
      const global = dv.getUint16(off, little); off += 2;
      const n = dv.getUint8(off); off += 1;
      const fields = [];
      for (let i = 0; i < n; i++) { fields.push({ num: dv.getUint8(off), size: dv.getUint8(off + 1), type: dv.getUint8(off + 2) }); off += 3; }
      let devSize = 0;
      if (hasDev) {
        const nd = dv.getUint8(off); off += 1;
        for (let i = 0; i < nd; i++) { devSize += dv.getUint8(off + 1); off += 3; }
      }
      defs[local] = { little, global, fields, devSize };
      continue;
    }

    const def = defs[local];
    if (!def) throw new Error("Unexpected data in FIT file");
    const g = def.global;
    const want = g === 18 || g === 20 || g === 12 || g === 34;
    const msg = want ? {} : null;
    for (const f of def.fields) {
      if (off + f.size > dv.byteLength) break;
      if (want || f.num === 253) {
        const v = readVal(dv, off, f.size, def.little, f.type);
        if (want) msg[f.num] = v;
        if (f.num === 253 && v != null) lastTs = v;
      }
      off += f.size;
    }
    off += def.devSize;
    if (!want) continue;
    if (compressedTs != null && msg[253] == null) msg[253] = compressedTs;

    if (g === 18) sessions.push(msg);
    else if (g === 12 && msg[0] != null) sportFromSport = msg[0];
    else if (g === 34 && msg[5] != null && msg[253] != null && Math.abs(msg[5] - msg[253]) <= 14 * 3600) tzOffsetSec = msg[5] - msg[253];
    else if (g === 20 && msg[253] != null) {
      recT.push(msg[253]);
      recD.push(msg[5] != null ? msg[5] / 100 : null);
      recHr.push(msg[3] != null && msg[3] > 0 ? msg[3] : null);
      const alt = msg[78] != null ? msg[78] / 5 - 500 : msg[2] != null ? msg[2] / 5 - 500 : null;
      recAlt.push(alt);
    }
  }

  const t0 = recT.length ? recT[0] : null;
  const stream = recT.length > 10 ? {
    t: recT.map(x => x - t0),
    d: recD,
    hr: recHr.some(x => x != null) ? recHr : null,
    alt: recAlt.some(x => x != null) ? recAlt : null
  } : null;

  if (sessions.length) {
    const first = sessions[0];
    const sum = (k, scale) => sessions.reduce((a, s) => a + (s[k] != null ? s[k] / scale : 0), 0);
    const hrs = sessions.filter(s => s[16] != null);
    const avgHr = hrs.length ? Math.round(hrs.reduce((a, s) => a + s[16] * (s[8] || 1), 0) / hrs.reduce((a, s) => a + (s[8] || 1), 0)) : null;
    const maxHr = sessions.reduce((m, s) => s[17] != null ? Math.max(m || 0, s[17]) : m, null);
    const startSec = first[2] != null ? first[2] : t0;
    const sport = first[5] != null ? first[5] : sportFromSport;
    return {
      start: startSec != null ? new Date((startSec + FIT_EPOCH) * 1000) : null,
      sport: SPORTS[sport] || "Other",
      isRun: sport === 1,
      distanceM: sum(9, 100),
      elapsedSec: sum(7, 1000),
      movingSec: sum(8, 1000) || sum(7, 1000),
      avgHr, maxHr,
      elevGain: sessions.some(s => s[22] != null) ? Math.round(sum(22, 1)) : null,
      tzOffsetSec,
      stream
    };
  }

  if (!recT.length) throw new Error("No activity data found in this FIT file");
  const dists = recD.filter(v => v != null);
  const hrs = recHr.filter(v => v != null);
  return {
    start: new Date((t0 + FIT_EPOCH) * 1000),
    sport: SPORTS[sportFromSport] || "Other",
    isRun: sportFromSport === 1,
    distanceM: dists.length ? dists[dists.length - 1] : 0,
    elapsedSec: recT[recT.length - 1] - t0,
    movingSec: recT[recT.length - 1] - t0,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    elevGain: null,
    tzOffsetSec,
    stream
  };
}
