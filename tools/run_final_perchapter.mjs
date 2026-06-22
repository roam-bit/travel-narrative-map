// 逐章 latDev / 角速度对比：identity vs 推荐(lowpass+pace)，验证"地板"论与单章是否退化
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';
const { normalizePoint, hav, angDiff } = helpers;

function resampleByArc(pts, ds) {
  const P = [];
  for (const raw of pts) { const p = normalizePoint(raw); if (p && (!P.length || hav(P[P.length - 1], p) > 0.5)) P.push(p); }
  if (P.length < 2) return P;
  const out = [P[0]]; let acc = 0;
  for (let i = 1; i < P.length; i++) {
    let a = P[i - 1], b = P[i]; let segLen = hav(a, b);
    while (acc + segLen >= ds) { const t = (ds - acc) / segLen; const np = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(np); a = np; segLen = hav(a, b); acc = 0; }
    acc += segLen;
  }
  const last = P[P.length - 1];
  if (hav(out[out.length - 1], last) > ds * 0.25) out.push(last); else out[out.length - 1] = last;
  return out;
}
function gaussLowpass(pts, window) {
  const n = pts.length; if (n < 3 || window < 3) return pts;
  const radius = Math.floor(window / 2); const sigma = radius / 2 || 1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) { out[i] = pts[i]; continue; }
    const r = Math.min(radius, i, n - 1 - i); if (r < 1) { out[i] = pts[i]; continue; }
    let sx = 0, sy = 0, sw = 0;
    for (let k = -r; k <= r; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); sx += pts[i + k][0] * w; sy += pts[i + k][1] * w; sw += w; }
    out[i] = [sx / sw, sy / sw];
  }
  return out;
}
const identity = s => s.map(normalizePoint).filter(Boolean);
function makeLowpass(ds, window, outDs) {
  return s => { let p = resampleByArc(s, ds); if (p.length < 3) return p; p = gaussLowpass(p, window); if (outDs > 0) p = resampleByArc(p, outDs); return p; };
}
function makePace(k) {
  return (legs) => {
    const w = new Array(legs.length).fill(1);
    for (let i = 0; i < legs.length; i++) {
      if (legs[i].bridge) { w[i] = 1; continue; }
      let j = i + 1; while (j < legs.length && legs[j].bridge) j++;
      let turn = 0; if (j < legs.length) turn = angDiff(legs[i].heading, legs[j].heading);
      w[i] = legs[i].d * (1 + k * Math.min(1, turn / 90));
    }
    return w;
  };
}

const id = evaluate(identity, { name: 'identity' });
const rec = evaluate(makeLowpass(60, 25, 18), { name: 'rec', pace: makePace(0.5) });

console.log('章节'.padEnd(22), 'idLatDev  recLatDev   Δ       | idAngV  recAngV    Δ');
for (let i = 0; i < id.rows.length; i++) {
  const a = id.rows[i], b = rec.rows[i];
  const dLat = b.maxLatDevM - a.maxLatDevM, dAng = +(b.p95AngVel - a.p95AngVel).toFixed(2);
  console.log(
    a.name.padEnd(20),
    String(a.maxLatDevM).padStart(7),
    String(b.maxLatDevM).padStart(9),
    String(dLat).padStart(7),
    '   |',
    String(a.p95AngVel).padStart(6),
    String(b.p95AngVel).padStart(8),
    String(dAng).padStart(7)
  );
}
console.log('\nidentity  worst_maxLatDevM=', id.summary.worst_maxLatDevM, ' avg_p95AngVel=', id.summary.avg_p95AngVel);
console.log('rec       worst_maxLatDevM=', rec.summary.worst_maxLatDevM, ' avg_p95AngVel=', rec.summary.avg_p95AngVel, ' avg_p95AngAcc=', rec.summary.avg_p95AngAcc);
