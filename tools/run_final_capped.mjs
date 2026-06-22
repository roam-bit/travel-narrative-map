// 带"偏离上限(devCap)"的低通 + 进弯减速：用最小转弯半径思路约束保真，扫参找膝点
import { evaluate, helpers } from './smooth_eval.mjs';
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
function gaussLowpassCapped(pts, window, devCapM) {
  const n = pts.length; if (n < 3 || window < 3) return pts;
  const radius = Math.floor(window / 2); const sigma = radius / 2 || 1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) { out[i] = pts[i]; continue; }
    const r = Math.min(radius, i, n - 1 - i); if (r < 1) { out[i] = pts[i]; continue; }
    let sx = 0, sy = 0, sw = 0;
    for (let k = -r; k <= r; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); sx += pts[i + k][0] * w; sy += pts[i + k][1] * w; sw += w; }
    let np = [sx / sw, sy / sw];
    // 偏离上限：若平滑点离原点 > devCap，则按比例拉回（保真闸）
    if (devCapM > 0) {
      const dev = hav(pts[i], np);
      if (dev > devCapM) { const t = devCapM / dev; np = [pts[i][0] + (np[0] - pts[i][0]) * t, pts[i][1] + (np[1] - pts[i][1]) * t]; }
    }
    out[i] = np;
  }
  return out;
}
function makeCapped(ds, window, outDs, devCapM) {
  return s => { let p = resampleByArc(s, ds); if (p.length < 3) return p; p = gaussLowpassCapped(p, window, devCapM); if (outDs > 0) p = resampleByArc(p, outDs); return p; };
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
function row(name, s) {
  return `${name.padEnd(30)} p95AngVel=${String(s.avg_p95AngVel).padStart(7)}  p95AngAcc=${String(s.avg_p95AngAcc).padStart(7)}  wMaxAngVel=${String(s.worst_maxAngVel).padStart(6)}  wMaxLatDev=${String(s.worst_maxLatDevM).padStart(5)}  p95LatDev=${String(s.avg_p95LatDevM).padStart(6)}  len%=${s.avg_lenPct}`;
}
const out = [];
function go(name, ds, w, o, cap, k) { const { summary } = evaluate(makeCapped(ds, w, o, cap), { name, pace: k != null ? makePace(k) : undefined }); out.push([name, summary]); console.log(row(name, summary)); }

console.log('=== devCap 扫参（带 pace k=0.5）===');
for (const cap of [0, 600, 400, 300, 250, 200]) go(`d60w25o18 cap${cap} k0.5`, 60, 25, 18, cap, 0.5);
console.log('\n=== 不带 pace 对照 ===');
for (const cap of [0, 400, 300, 250]) go(`d60w25o18 cap${cap} nopace`, 60, 25, 18, cap, null);
console.log('\n=== 排名(p95AngVel) ===');
out.sort((a, b) => a[1].avg_p95AngVel - b[1].avg_p95AngVel);
for (const [n, s] of out) console.log(row(n, s));
