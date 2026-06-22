// 独立审查 runner for strategy = "adaptiveSpeed"
// 不复用上报方的 run_adaptiveSpeed.mjs，而是直接把上报 JSON 里 transformCode 的两个函数
// (catmullRom + paceWeight) 原样实现，独立跑评测台，得到 reproducedSummary。
//
// transformCode 声明：几何沿用 catmullRom(perSeg=6)，pace 用 d*(1+k*turnNorm)，
//   turn = 本腿 heading 与下一条 road 腿 heading 的夹角(0..180)，turnNorm = min(1, turn/90)，膝点 k=0.5。

import { evaluate, catmullRom as evalCatmull, helpers } from './smooth_eval.mjs';

const { hav, angDiff } = helpers;

// ===== 下面两个函数逐字取自上报 transformCode =====

// --- 1) 几何：catmullRom（用评测台同名 hav）---
function catmullRom(points, perSeg = 6) {
  const P = [];
  for (const raw of points) {
    const p = (Array.isArray(raw) && raw.length >= 2 && isFinite(+raw[0]) && isFinite(+raw[1])) ? [+raw[0], +raw[1]] : null;
    if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p);
  }
  if (P.length < 3) return P;
  const at = i => P[Math.max(0, Math.min(P.length - 1, i))];
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

// --- 2) pace：进弯减速时间权重（k 可调以扫参）---
function makePaceWeight(ADAPTIVE_K) {
  return function paceWeight(legs) {
    const n = legs.length;
    const w = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const l = legs[i];
      if (l.bridge) { w[i] = 0; continue; }
      let j = i + 1;
      while (j < n && legs[j].bridge) j++;
      let turn = 0;
      if (j < n) turn = angDiff(l.heading, legs[j].heading);
      const turnNorm = Math.min(1, turn / 90);
      w[i] = l.d * (1 + ADAPTIVE_K * turnNorm);
    }
    return w;
  };
}

const transformSeg = (rawPts) => catmullRom(rawPts, 6);

// sanity: 我的 transformCode catmull 与评测台 catmullRom 应数值一致（仅 isFinite vs Number.isFinite 差异）
function maxDiffVsEval(rawSegSample) {
  const a = catmullRom(rawSegSample, 6);
  const b = evalCatmull(rawSegSample, 6);
  if (a.length !== b.length) return { lenA: a.length, lenB: b.length, lenMismatch: true };
  let md = 0;
  for (let i = 0; i < a.length; i++) md = Math.max(md, Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1]));
  return { lenA: a.length, lenB: b.length, maxCoordDiff: md };
}

// baseline：纯 catmull6 默认配速
const base = evaluate(transformSeg, { name: 'catmull6_baseline' });

// 上报声称膝点 k=0.5；我多扫几个点核对趋势
const KS = [0.25, 0.5, 0.75, 1, 2, 4, 8];
const sweep = [];
for (const k of KS) {
  const res = evaluate(transformSeg, { name: `adaptiveSpeed_k${k}`, pace: makePaceWeight(k) });
  sweep.push({ k, ...res.summary });
}

// 取 k=0.5 的逐章 rows 做退化检查
const k05 = evaluate(transformSeg, { name: 'adaptiveSpeed_k0.5', pace: makePaceWeight(0.5) });

console.log('=== BASELINE (catmull6, default pace) ===');
console.log(JSON.stringify(base.summary));
console.log('\n=== SWEEP ===');
for (const r of sweep) console.log(JSON.stringify(r));
console.log('\n=== k=0.5 PER-CHAPTER ROWS ===');
for (const r of k05.rows) console.log(JSON.stringify(r));
console.log('\n=== identity baseline (no smoothing) for latDev origin check ===');
const ident = evaluate((pts) => pts.map(p => [+p[0], +p[1]]), { name: 'identity' });
console.log(JSON.stringify(ident.summary));
console.log('\n=== which chapter drives worst_maxLatDevM under k=0.5 ===');
const worstRow = k05.rows.reduce((m, r) => r.maxLatDevM > m.maxLatDevM ? r : m, k05.rows[0]);
console.log(JSON.stringify({ name: worstRow.name, maxLatDevM: worstRow.maxLatDevM, p95LatDevM: worstRow.p95LatDevM, lenPct: worstRow.lenPct }));

console.log('\n__OUT__' + JSON.stringify({ baseline: base.summary, sweep, k05_summary: k05.summary, identity: ident.summary }));
