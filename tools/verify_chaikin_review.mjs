// 独立审查 runner —— 直接粘贴 chaikin 上报的 transformCode 原文，独立复跑评测台。
// 目的：验证 bestSummary 是否可复现 + 查保真/作弊。
import { evaluate, catmullRom, helpers, CH } from './smooth_eval.mjs';
const { normalizePoint, hav } = helpers;

// ============ 以下为上报 transformCode 的【原文粘贴】（未改一字逻辑）============
const CHAIKIN_DS_IN  = 30;   // 入口重采样弧长（米）
const CHAIKIN_ITERS  = 5;    // 切角迭代次数
const CHAIKIN_DS_OUT = 18;   // 出口回抽弧长（米），约等于播放帧距量级

function _chHav(a, b) {
  const R = 6371008.8, r = x => x * Math.PI / 180;
  const la1 = r(a[1]), la2 = r(b[1]), dla = la2 - la1, dln = r(b[0] - a[0]);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function _chClean(points) {
  const P = [];
  for (const raw of points) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const x = +raw[0], y = +raw[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const p = [x, y];
    if (!P.length || _chHav(P[P.length - 1], p) > 1) P.push(p);
  }
  return P;
}

function _chResample(P, ds) {
  if (P.length < 2 || ds <= 0) return P.slice();
  const out = [P[0]];
  let carry = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    const L = _chHav(a, b);
    if (L <= 1e-9) continue;
    let pos = 0;
    while (carry + (L - pos) >= ds) {
      pos += (ds - carry);
      const t = pos / L;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      carry = 0;
    }
    carry += L - pos;
  }
  const last = P[P.length - 1];
  if (_chHav(out[out.length - 1], last) > ds * 0.25) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

function _chCutOnce(P) {
  if (P.length < 3) return P.slice();
  const out = [P[0]];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    out.push(
      [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
      [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]
    );
  }
  out.push(P[P.length - 1]);
  return out;
}

function chaikinSmooth(rawSeg) {
  let P = _chClean(rawSeg);
  if (P.length < 2) return P;
  P = _chResample(P, CHAIKIN_DS_IN);
  for (let k = 0; k < CHAIKIN_ITERS; k++) P = _chCutOnce(P);
  P = _chResample(P, CHAIKIN_DS_OUT);
  return P;
}
// ============ transformCode 原文结束 ============

// ---- baseline（独立复跑，确认与上报一致）----
const idClean = points => { // 与评测台 identity 口径一致的去重清洗
  const P = [];
  for (const raw of points) { const p = normalizePoint(raw); if (p && (!P.length || hav(P[P.length-1], p) > 1)) P.push(p); }
  return P;
};
const baselineId = evaluate(s => idClean(s), { name: 'identity' }).summary;
const baselineCR = evaluate(s => catmullRom(s, 6), { name: 'catmull6' }).summary;

// ---- 核心：用上报 transformCode 原文跑评测台 ----
const res = evaluate(chaikinSmooth, { name: 'chaikin_VERIFY' });

// ---- 反作弊：统计每段输入/输出点数，确认未抽稀 ----
let totIn = 0, totOut = 0, nSeg = 0, minOut = Infinity, maxOut = 0;
for (const ch of CH) {
  if (ch.transition) continue;
  for (const s of (ch.segments || [])) {
    const pts = (s || []).map(normalizePoint).filter(Boolean);
    if (pts.length < 2) continue;
    const out = chaikinSmooth(pts);
    totIn += pts.length; totOut += out.length; nSeg++;
    minOut = Math.min(minOut, out.length); maxOut = Math.max(maxOut, out.length);
  }
}

console.log('=== BASELINES (independent) ===');
console.log('identity :', JSON.stringify(baselineId));
console.log('catmull6 :', JSON.stringify(baselineCR));
console.log('\n=== CHAIKIN reproduced summary (transformCode 原文) ===');
console.log(JSON.stringify(res.summary, null, 2));
console.log('\n=== PER-CHAPTER rows ===');
for (const r of res.rows) console.log(JSON.stringify(r));
console.log('\n=== density / anti-cheat ===');
console.log('avg in/seg :', (totIn/nSeg).toFixed(1), ' avg out/seg :', (totOut/nSeg).toFixed(1), ' ratio out/in :', (totOut/totIn).toFixed(2));
console.log('min out/seg:', minOut, ' max out/seg:', maxOut, ' nSeg:', nSeg);
