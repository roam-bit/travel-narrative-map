// 独立审查 runner（审查者写）：直接粘贴 expert 上报的 transformCode（生产串）跑评测台。
// 不复用 expert 自己的 run_expert_lock.mjs，避免被其 runner 内联实现"美化"。
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';

// ===== 以下整段为 expert 上报 JSON 里 transformCode 的逐字粘贴（生产串）=====
// ===== expert 平滑策略：自适应 RDP 去噪 + 长弦直线 + 短弦 Catmull-Rom 上采样 =====
const RDP_EPS_M = 12;      // RDP 去噪阈值（米）：<12m 的 GPS 抖动会被抹掉
const STEP_M = 12;         // 上采样步长（米）：样条采样密度，越小越密
const LONG_CHORD_M = 600;  // 长弦阈值（米）：超过此长度的弦改走直线，防止样条鼓包偏离真实轨迹

function _projectorFor(pts) {
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return { to: p => [p[0] * kx, p[1] * ky], back: q => [q[0] / kx, q[1] / ky] };
}
function _perpDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
  const c2 = vx * vx + vy * vy; if (c2 < 1e-12) return Math.hypot(wx, wy);
  let t = (vx * wx + vy * wy) / c2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}
function _rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i0, i1] = st.pop(); let m = -1, idx = -1;
    for (let i = i0 + 1; i < i1; i++) { const d = _perpDist(pts[i], pts[i0], pts[i1]); if (d > m) { m = d; idx = i; } }
    if (m > eps && idx > 0) { keep[idx] = 1; st.push([i0, idx], [idx, i1]); }
  }
  const o = []; for (let i = 0; i < pts.length; i++) if (keep[i]) o.push(pts[i]); return o;
}
function _catmullDense(P, stepM, longChordM) {
  if (P.length < 3) return P.slice();
  const at = i => P[Math.max(0, Math.min(P.length - 1, i))];
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = at(i), p2 = at(i + 1);
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const seg = Math.max(1, Math.min(60, Math.round(chord / stepM)));
    if (chord > longChordM) {
      for (let s = 0; s < seg; s++) { const t = s / seg; out.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]); }
    } else {
      const p0 = at(i - 1), p3 = at(i + 2);
      for (let s = 0; s < seg; s++) {
        const t = s / seg, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
function _hav(a, b) { const R = 6371008.8, r = x => x * Math.PI / 180; const la1 = r(a[1]), la2 = r(b[1]), dla = la2 - la1, dln = r(b[0] - a[0]); const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dln / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }

function smoothTrackSeg(rawPts) {
  const P = [];
  for (const raw of rawPts) {
    const p = (Array.isArray(raw) && Number.isFinite(+raw[0]) && Number.isFinite(+raw[1])) ? [+raw[0], +raw[1]] : null;
    if (p && (!P.length || _hav(P[P.length - 1], p) > 1)) P.push(p);
  }
  if (P.length < 2) return P;
  const prj = _projectorFor(P);
  const mp = P.map(prj.to);
  const simp = _rdp(mp, RDP_EPS_M);
  if (simp.length < 2) return P;
  const dense = _catmullDense(simp, STEP_M, LONG_CHORD_M);
  return dense.map(prj.back);
}
// ===== transformCode 粘贴结束 =====

// ---- 跑评测台 ----
const res = evaluate(smoothTrackSeg, { name: 'expert(audit)' });

console.log('=== expert(audit) per-chapter rows ===');
for (const row of res.rows) {
  console.log(
    row.name.padEnd(24),
    'p95Vel', String(row.p95AngVel).padStart(6),
    'maxVel', String(row.maxAngVel).padStart(6),
    'p95Acc', String(row.p95AngAcc).padStart(6),
    'maxAcc', String(row.maxAngAcc).padStart(6),
    'maxLat', String(row.maxLatDevM).padStart(6),
    'p95Lat', String(row.p95LatDevM).padStart(5),
    'len%', String(row.lenPct).padStart(5),
  );
}
console.log('\n=== expert(audit) SUMMARY ===');
console.log(JSON.stringify(res.summary, null, 2));

// ---- 旁证 baselines（同口径）----
const idRes = evaluate(s => s.map(p => p.slice()), { name: 'identity' });
const cmRes = evaluate(s => catmullRom(s, 6), { name: 'catmull6' });
console.log('\n=== baselines SUMMARY ===');
console.log('identity:', JSON.stringify(idRes.summary));
console.log('catmull6:', JSON.stringify(cmRes.summary));

// ---- 防作弊量化：点密度统计（每章 transform 后总点数 + 平均相邻间距）----
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..');
const CH = JSON.parse(fs.readFileSync(path.join(PROJ, 'chapters_built.json'), 'utf8')).chapters;
const { hav, normalizePoint } = helpers;
console.log('\n=== 点密度审查（防抽稀作弊）===');
for (const ch of CH) {
  if (ch.transition) continue;
  const rawSegs = (ch.segments || []).map(s => (s || []).map(normalizePoint).filter(Boolean)).filter(s => s.length >= 2);
  let rawN = 0, procN = 0, procLen = 0;
  for (const s of rawSegs) {
    rawN += s.length;
    const out = smoothTrackSeg(s);
    procN += out.length;
    for (let i = 1; i < out.length; i++) procLen += hav(out[i - 1], out[i]);
  }
  const avgSpacing = procN > 1 ? (procLen / (procN - 1)) : 0;
  console.log(ch.name.padEnd(24), 'rawPts', String(rawN).padStart(5), '-> procPts', String(procN).padStart(6),
    'avgSpacing(m)', avgSpacing.toFixed(1));
}
