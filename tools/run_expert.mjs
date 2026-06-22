// ===== expert 策略 runner (v3 — 最终) =====
// 关键事实（已用 node 验证）：本数据集 worst_maxLatDevM 存在「结构性地板」≈1888m(纯线性) / 2186m(identity)。
//   原因：某些章节(第一章/第二章/终章)含「往返重叠腿」(A→B→A，两趟相隔 1~2km)，
//   评测台把某趟上的帧点拿去和另一趟的原始边比距离，于是即便「啥都不改」也有 ~2km 偏离。
//   => 800m 在 worst 口径下物理不可达；真实可控目标 = 把 worst_maxLatDevM 压到「不超过地板(~2200m)」，
//      同时把每章真实保真 avg_p95LatDevM 压到极小、len% ≈ 0，并把丝滑度做到最好。
// 算法：RDP 去噪 -> 长弦走直线(不鼓包) -> 短弦 Catmull 上采样 -> 约束拉普拉斯平滑(位移对原始 GPS 折线 clamp)。
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';
const { hav } = helpers;

function projectorFor(pts) {
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return { to: p => [p[0] * kx, p[1] * ky], back: q => [q[0] / kx, q[1] / ky] };
}
function perpDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
  const c2 = vx * vx + vy * vy; if (c2 < 1e-12) return Math.hypot(wx, wy);
  let t = (vx * wx + vy * wy) / c2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}
function distToPolyline(p, edges) {
  let best = Infinity;
  for (const e of edges) { const d = perpDist(p, e[0], e[1]); if (d < best) best = d; if (best < 1) break; }
  return best;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) { const [i0, i1] = st.pop(); let m = -1, idx = -1;
    for (let i = i0 + 1; i < i1; i++) { const d = perpDist(pts[i], pts[i0], pts[i1]); if (d > m) { m = d; idx = i; } }
    if (m > eps && idx > 0) { keep[idx] = 1; st.push([i0, idx], [idx, i1]); } }
  const o = []; for (let i = 0; i < pts.length; i++) if (keep[i]) o.push(pts[i]); return o;
}
function catmullDense(P, stepM, longChordM) {
  if (P.length < 3) return P.slice();
  const at = i => P[Math.max(0, Math.min(P.length - 1, i))];
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = at(i), p2 = at(i + 1);
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const seg = Math.max(1, Math.min(60, Math.round(chord / stepM)));
    if (chord > longChordM) { for (let s = 0; s < seg; s++) { const t = s / seg; out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]); } }
    else { const p0 = at(i - 1), p3 = at(i + 2);
      for (let s = 0; s < seg; s++) { const t = s / seg, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]); } }
  }
  out.push(P[P.length - 1]); return out;
}
// 约束拉普拉斯平滑：位移对「原始 GPS 折线」做 clamp（不让平滑把点推离真实轨迹超过 clampM）
function constrainedSmooth(dense, rawEdges, iters, lambda, clampM) {
  const n = dense.length; if (n < 3) return dense;
  let cur = dense.map(p => [p[0], p[1]]);
  for (let it = 0; it < iters; it++) {
    const next = cur.map(p => [p[0], p[1]]);
    for (let i = 1; i < n - 1; i++) {
      const mx = (cur[i - 1][0] + cur[i + 1][0]) / 2, my = (cur[i - 1][1] + cur[i + 1][1]) / 2;
      let nx = cur[i][0] + lambda * (mx - cur[i][0]);
      let ny = cur[i][1] + lambda * (my - cur[i][1]);
      if (distToPolyline([nx, ny], rawEdges) > clampM) {
        const ox = dense[i][0], oy = dense[i][1], vx = nx - ox, vy = ny - oy;
        let lo = 0, hi = 1;
        for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (distToPolyline([ox + vx * mid, oy + vy * mid], rawEdges) <= clampM) lo = mid; else hi = mid; }
        nx = ox + vx * lo; ny = oy + vy * lo;
      }
      next[i][0] = nx; next[i][1] = ny;
    }
    cur = next;
  }
  return cur;
}
function makeTransform({ rdpEps, stepM, iters, lambda, clampM, longChordM }) {
  return function transformSeg(rawPts) {
    const P = [];
    for (const raw of rawPts) { const p = (Array.isArray(raw) && Number.isFinite(+raw[0]) && Number.isFinite(+raw[1])) ? [+raw[0], +raw[1]] : null; if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p); }
    if (P.length < 2) return P;
    const prj = projectorFor(P);
    const mp = P.map(prj.to);
    const rawEdges = []; for (let i = 1; i < mp.length; i++) rawEdges.push([mp[i - 1], mp[i]]);
    const simp = rdpEps > 0 ? rdp(mp, rdpEps) : mp;
    if (simp.length < 2) return P;
    const dense = catmullDense(simp, stepM, longChordM);
    const sm = (iters > 0 && lambda > 0) ? constrainedSmooth(dense, rawEdges, iters, lambda, clampM) : dense;
    return sm.map(prj.back);
  };
}

// ---------- 扫参：聚焦丝滑，同时保证 worst_maxLat 不超过地板(~2200m)、len%∈[-4,3] ----------
const presets = [
  { key:'A', rdpEps: 8,  stepM: 12, iters: 0,  lambda: 0,    clampM: 0,   longChordM: 600 },
  { key:'B', rdpEps: 15, stepM: 12, iters: 4,  lambda: 0.30, clampM: 120, longChordM: 600 },
  { key:'C', rdpEps: 20, stepM: 13, iters: 8,  lambda: 0.40, clampM: 200, longChordM: 600 },
  { key:'D', rdpEps: 22, stepM: 14, iters: 14, lambda: 0.45, clampM: 300, longChordM: 600 },
  { key:'E', rdpEps: 25, stepM: 14, iters: 20, lambda: 0.50, clampM: 400, longChordM: 700 },
  { key:'F', rdpEps: 28, stepM: 15, iters: 28, lambda: 0.50, clampM: 500, longChordM: 700 },
  { key:'G', rdpEps: 30, stepM: 15, iters: 36, lambda: 0.55, clampM: 600, longChordM: 800 },
  { key:'H', rdpEps: 32, stepM: 16, iters: 46, lambda: 0.55, clampM: 700, longChordM: 800 },
  { key:'I', rdpEps: 35, stepM: 16, iters: 60, lambda: 0.55, clampM: 800, longChordM: 900 },
  { key:'J', rdpEps: 38, stepM: 18, iters: 80, lambda: 0.55, clampM: 900, longChordM: 1000 },
];

function fmt(s) { return `p95Vel=${s.avg_p95AngVel.toFixed(2)} maxVel=${s.worst_maxAngVel.toFixed(1)} p95Acc=${s.avg_p95AngAcc.toFixed(2)} maxAcc=${s.worst_maxAngAcc.toFixed(1)} | maxLat=${s.worst_maxLatDevM} p95Lat=${s.avg_p95LatDevM.toFixed(0)} len%=${s.avg_lenPct.toFixed(2)}`; }

// 地板参照
const idS = evaluate(p => p.map(q => [+q[0], +q[1]]), { name: 'identity' }).summary;
console.log('FLOOR identity:', fmt(idS));
console.log('FLOOR catmull6:', fmt(evaluate(p => catmullRom(p, 6), { name: 'catmull6' }).summary));
console.log('');

const LAT_BUDGET = 2200; // 结构性地板上限（identity≈2186）
const sweep = [];
for (const cfg of presets) {
  const { summary } = evaluate(makeTransform(cfg), { name: 'expert_' + cfg.key });
  const ok = summary.worst_maxLatDevM <= LAT_BUDGET && summary.avg_lenPct >= -4 && summary.avg_lenPct <= 3;
  sweep.push({ ...cfg, ...summary, ok });
  console.log(`[${ok ? 'OK ' : 'XX '}] ${cfg.key} rdp=${cfg.rdpEps} step=${cfg.stepM} it=${cfg.iters} lam=${cfg.lambda} clamp=${cfg.clampM} lc=${cfg.longChordM}  ::  ${fmt(summary)}`);
}
const valid = sweep.filter(r => r.ok);
// 选膝点：丝滑得分 = p95Vel + p95Acc（都越低越好），并轻惩罚 maxVel
valid.sort((a, b) => (a.avg_p95AngVel + a.avg_p95AngAcc) - (b.avg_p95AngVel + b.avg_p95AngAcc));
console.log('\n=== valid (maxLat≤2200, len%∈[-4,3]) sorted by p95Vel+p95Acc ===');
for (const r of valid) console.log(`${r.key} rdp=${r.rdpEps} step=${r.stepM} it=${r.iters} lam=${r.lambda} clamp=${r.clampM} lc=${r.longChordM} :: ${fmt(r)}`);
const best = valid[0];
console.log('\n=== BEST ===\n', JSON.stringify(best, null, 2));
