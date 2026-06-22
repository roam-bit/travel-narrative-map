// 独立审查 runner（combo）：直接粘贴上报的 transformCode（原封不动），
// 用统一评测台跑，核对其声称的 bestSummary 是否可复现，并查保真/作弊。
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';
const { normalizePoint, hav } = helpers;

// =============== 以下为上报 transformCode 原文（逐字粘贴） ===============
function _hav(a, b) { // 两经纬点球面距离(米)
  const R = 6371008.8, r = x => x * Math.PI / 180;
  const la1 = r(a[1]), la2 = r(b[1]), dla = la2 - la1, dln = r(b[0] - a[0]);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function _normPt(p) { // 容错：取出合法 [lng,lat]
  return (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) ? [+p[0], +p[1]] : null;
}

const CC_CUT_M   = 250;
const CC_MIN_DEG = 18;
const CC_ARC_N   = 6;
const CC_DEVCAP_M = 350;
const CC_MAXGAP_M = 200;

function cornerCutSmooth(rawPts) {
  const P = [];
  for (const raw of rawPts) {
    const p = _normPt(raw);
    if (p && (!P.length || _hav(P[P.length - 1], p) > 1)) P.push(p);
  }
  if (P.length < 3) return P;

  const refLat = P.reduce((s, p) => s + p[1], 0) / P.length;
  const kx = 111320 * Math.cos(refLat * Math.PI / 180), ky = 110540;
  const XY = P.map(p => [p[0] * kx, p[1] * ky]);
  const minTurn = CC_MIN_DEG * Math.PI / 180;

  const out = [XY[0].slice()];
  for (let i = 1; i < XY.length - 1; i++) {
    const A = XY[i - 1], B = XY[i], C = XY[i + 1];
    const ux = B[0] - A[0], uy = B[1] - A[1];
    const vx = C[0] - B[0], vy = C[1] - B[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) { out.push(B.slice()); continue; }
    let cos = (ux * vx + uy * vy) / (lu * lv);
    cos = Math.max(-1, Math.min(1, cos));
    const turn = Math.acos(cos);
    if (turn < minTurn) { out.push(B.slice()); continue; }

    let t = Math.min(CC_CUT_M, lu * 0.35, lv * 0.35);
    const bulge = 0.5 * t * Math.sin(turn / 2);
    if (bulge > CC_DEVCAP_M && bulge > 1e-6) t *= CC_DEVCAP_M / bulge;
    if (t < 1) { out.push(B.slice()); continue; }

    const p1 = [B[0] - ux / lu * t, B[1] - uy / lu * t];
    const p2 = [B[0] + vx / lv * t, B[1] + vy / lv * t];
    out.push(p1.slice());
    for (let s = 1; s < CC_ARC_N; s++) {
      const u = s / CC_ARC_N, iu = 1 - u;
      out.push([
        iu * iu * p1[0] + 2 * iu * u * B[0] + u * u * p2[0],
        iu * iu * p1[1] + 2 * iu * u * B[1] + u * u * p2[1],
      ]);
    }
    out.push(p2.slice());
  }
  out.push(XY[XY.length - 1].slice());

  let lngLat = out.map(m => [m[0] / kx, m[1] / ky]);

  const dense = [lngLat[0]];
  for (let i = 1; i < lngLat.length; i++) {
    const a = lngLat[i - 1], b = lngLat[i], d = _hav(a, b);
    const n = Math.max(1, Math.ceil(d / CC_MAXGAP_M));
    for (let s = 1; s <= n; s++) {
      const tt = s / n;
      dense.push([a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]);
    }
  }
  return dense;
}

const CC_PACE_K   = 0;
const CC_PACE_WIN = 3;
function _angDiff(a, b) { return Math.abs(((b - a + 540) % 360) - 180); }
function comboPace(legs) {
  const n = legs.length, w = new Array(n).fill(1);
  if (CC_PACE_K <= 0) return w;
  for (let i = 0; i < n; i++) {
    if (legs[i].bridge) { w[i] = 1; continue; }
    let maxTurn = 0;
    for (let j = Math.max(0, i - CC_PACE_WIN); j <= Math.min(n - 1, i + CC_PACE_WIN); j++) {
      if (legs[j].bridge) continue;
      const d = _angDiff(legs[i].heading, legs[j].heading);
      if (d > maxTurn) maxTurn = d;
    }
    w[i] = 1 + CC_PACE_K * (maxTurn / 90);
  }
  return w;
}
// =============== transformCode 原文结束 ===============

function clean(points) {
  const P = [];
  for (const raw of points) {
    const p = normalizePoint(raw);
    if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p);
  }
  return P;
}

// baseline 参照
const base = evaluate(p => catmullRom(p, 6), { name: 'baseline_catmull6' });
const idn = evaluate(p => clean(p), { name: 'identity' });
console.log('BASELINE catmull6:', JSON.stringify(base.summary));
console.log('IDENTITY       :', JSON.stringify(idn.summary));

// 用上报 transformCode（pace_k=0，默认）跑
const usePace = CC_PACE_K > 0 ? comboPace : undefined;
const res = evaluate(cornerCutSmooth, { name: 'combo_reported', pace: usePace });
console.log('\nCOMBO REPORTED :', JSON.stringify(res.summary));

// 声称值
const claimed = {"avg_p95AngVel":19.844,"avg_p95AngAcc":12.026,"worst_maxAngVel":32.37,"worst_maxAngAcc":32.14,"worst_maxLatDevM":2156,"avg_p95LatDevM":6,"avg_lenPct":-0.675};
console.log('\nCLAIMED        :', JSON.stringify(claimed));

// ====== 密度/覆盖检查：是否抽稀作弊？逐章对比 raw 点数 vs 处理后点数 ======
console.log('\n=== 密度检查（前若干章）：rawPts -> procPts，处理后点数应 >= raw，密集 ===');
const CH = (await import('./smooth_eval.mjs')).CH;
let totalRaw = 0, totalProc = 0, suspicious = [];
for (const ch of CH) {
  if (ch.transition) continue;
  const rawSegs = (ch.segments || []).map(s => (s || []).map(normalizePoint).filter(Boolean)).filter(s => s.length >= 2);
  if (!rawSegs.length) continue;
  let rawN = 0, procN = 0;
  for (const s of rawSegs) {
    rawN += s.length;
    const out = cornerCutSmooth(s);
    procN += out.length;
  }
  totalRaw += rawN; totalProc += procN;
  if (procN < rawN) suspicious.push(`${ch.name}: raw ${rawN} -> proc ${procN} (抽稀!)`);
}
console.log(`总计 rawPts=${totalRaw}  procPts=${totalProc}  比值=${(totalProc/totalRaw).toFixed(2)}x`);
if (suspicious.length) { console.log('!!! 抽稀章节:'); suspicious.forEach(s => console.log('  ', s)); }
else console.log('未发现抽稀（每章处理后点数 >= 原始点数）');

// ====== 找出 worst_maxLatDevM 来自哪一章；并看该章在 identity 下是否也偏高 ======
console.log('\n=== worst_maxLatDevM 来源定位 ===');
const comboRows = res.rows.slice().sort((a, b) => b.maxLatDevM - a.maxLatDevM);
const idnByName = Object.fromEntries(idn.rows.map(r => [r.name, r]));
console.log('combo 偏离 top5 章（看 identity 同章对比，判断是否地板）:');
for (const r of comboRows.slice(0, 5)) {
  const ir = idnByName[r.name];
  console.log(`  ${r.name}: combo maxLat=${r.maxLatDevM}m p95Lat=${r.p95LatDevM}m | identity maxLat=${ir ? ir.maxLatDevM : '?'}m p95Lat=${ir ? ir.p95LatDevM : '?'}m | lenPct=${r.lenPct}`);
}

// ====== 角度退化检查：哪章 angVel/angAcc 最差，combo vs baseline vs identity ======
console.log('\n=== 角度 top5 章 (maxAngVel) combo vs identity ===');
const byAng = res.rows.slice().sort((a, b) => b.maxAngVel - a.maxAngVel);
for (const r of byAng.slice(0, 5)) {
  const ir = idnByName[r.name];
  console.log(`  ${r.name}: combo maxAngVel=${r.maxAngVel} p95=${r.p95AngVel} maxAngAcc=${r.maxAngAcc} | identity maxAngVel=${ir ? ir.maxAngVel : '?'} p95=${ir ? ir.p95AngVel : '?'}`);
}

// ====== 是否有章节 combo 比 identity 还差（退化）======
console.log('\n=== 退化检查：combo p95AngVel > identity p95AngVel 的章 ===');
let worse = 0;
for (const r of res.rows) {
  const ir = idnByName[r.name];
  if (ir && r.p95AngVel > ir.p95AngVel + 0.01) { worse++; if (worse <= 10) console.log(`  ${r.name}: combo ${r.p95AngVel} > identity ${ir.p95AngVel}`); }
}
console.log(`共有 ${worse}/${res.rows.length} 章 combo 丝滑不如 identity`);
