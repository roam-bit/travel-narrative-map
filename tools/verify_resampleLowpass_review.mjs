// 独立审查 runner for strategy = "resampleLowpass"
// 不复用上报方的 run_resampleLowpass.mjs；直接把上报 JSON 里 transformCode 的
// smoothSegment + 所有 _rs* 辅助函数【逐字粘贴】，独立跑评测台，得到 reproducedSummary。
import { evaluate, helpers } from './smooth_eval.mjs';

const { hav: evalHav, normalizePoint } = helpers;

// ============================================================
// ===== 以下为上报 transformCode 逐字粘贴（仅去掉前缀注释块）=====
// ============================================================
const RS_DS = 60;          // 重采样步长（米）
const RS_WINDOW = 25;      // 低通窗口（点数，必须奇数）
const RS_KERNEL = 'gauss'; // 'gauss' 高斯 | 'box' 滑动平均

// 两点间球面距离（米），与主流程口径一致
function _rsHav(a, b) {
  const R = 6371008.8, r = x => x * Math.PI / 180;
  const la1 = r(a[1]), la2 = r(b[1]), dla = la2 - la1, dln = r(b[0] - a[0]);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// 规范化 + 去重（相邻 <1m 视为同点）
function _rsClean(points) {
  const P = [];
  for (const raw of points) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const x = +raw[0], y = +raw[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const p = [x, y];
    if (!P.length || _rsHav(P[P.length - 1], p) > 1) P.push(p);
  }
  return P;
}
// 按弧长等距重采样：沿折线每隔 ds 米线性插值放一个点，首尾保留以保真
function _rsResampleByArc(P, ds) {
  if (P.length < 2) return P.slice();
  const out = [P[0]];
  let carry = 0; // 距上一个输出点已累计弧长
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    const segLen = _rsHav(a, b);
    if (segLen < 1e-9) continue;
    let used = 0;
    while (carry + (segLen - used) >= ds) {
      const need = ds - carry;
      const t = (used + need) / segLen;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      used += need; carry = 0;
    }
    carry += segLen - used;
  }
  const last = P[P.length - 1];
  if (_rsHav(out[out.length - 1], last) > ds * 0.25) out.push(last);
  else out[out.length - 1] = last; // 末点对齐
  return out;
}
// 高斯权重（半径 radius，sigma=radius/2）
function _rsGaussWeights(radius) {
  const sigma = Math.max(0.5, radius / 2), w = [];
  for (let k = -radius; k <= radius; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return w;
}
// 对称卷积低通；端点收缩窗口（可用半径=min(i,n-1-i,radius)），保证首尾点不被往里拽
function _rsLowpass(P, window, kernel) {
  const n = P.length;
  if (n < 3 || window < 3) return P.slice();
  const radius = (window - 1) >> 1;
  const gw = kernel === 'gauss' ? _rsGaussWeights(radius) : null;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.min(i, n - 1 - i, radius);
    if (r === 0) { out[i] = P[i].slice(); continue; }
    let sx = 0, sy = 0, sw = 0;
    for (let k = -r; k <= r; k++) {
      const wk = kernel === 'gauss' ? gw[k + radius] : 1;
      sx += P[i + k][0] * wk; sy += P[i + k][1] * wk; sw += wk;
    }
    out[i] = [sx / sw, sy / sw];
  }
  return out;
}

// 入口：对一段原始 GPS 点做"重采样 + 低通"，返回密集平滑点
function smoothSegment(rawPts) {
  const P = _rsClean(rawPts);
  if (P.length < 3) return P;                 // 点太少，原样返回
  const rs = _rsResampleByArc(P, RS_DS);      // 1) 弧长等距重采样
  if (rs.length < 3) return rs;
  return _rsLowpass(rs, RS_WINDOW, RS_KERNEL); // 2) 高斯低通
}
// ============================================================
// ===== 粘贴结束 =====
// ============================================================

// ---- 1) 复现：用粘贴版 smoothSegment 跑评测台 ----
const repro = evaluate(smoothSegment, { name: 'resampleLowpass_repro' });

// ---- 2) identity 基线（验证 worst_maxLatDevM 地板的说法）----
const ident = evaluate((pts) => pts.map(p => [+p[0], +p[1]]), { name: 'identity' });

// ---- 3) 密度 / 抽稀 / 覆盖检查 ----
//   统计：原始清洗点总数 vs 输出点总数；并逐段核对输出首尾是否贴合原始首尾。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..');
const CH = JSON.parse(fs.readFileSync(path.join(PROJ, 'chapters_built.json'), 'utf8')).chapters;

let rawCleanTotal = 0, outTotal = 0, segCount = 0;
let maxFirstGap = 0, maxLastGap = 0;      // 输出首/尾点 vs 原始首/尾点的距离(米)
let minOutPerSeg = Infinity;
for (const ch of CH) {
  if (ch.transition) continue;
  for (const s of (ch.segments || [])) {
    const raw = (s || []).map(normalizePoint).filter(Boolean);
    if (raw.length < 2) continue;
    const cleaned = _rsClean(raw);
    const out = smoothSegment(raw);
    if (!out || out.length < 2) continue;
    segCount++;
    rawCleanTotal += cleaned.length;
    outTotal += out.length;
    minOutPerSeg = Math.min(minOutPerSeg, out.length);
    maxFirstGap = Math.max(maxFirstGap, evalHav(cleaned[0], out[0]));
    maxLastGap = Math.max(maxLastGap, evalHav(cleaned[cleaned.length - 1], out[out.length - 1]));
  }
}

// ---- 4) 逐章退化 / 过冲检查：找最差章 + 看 lenPct 是否有正负异常 ----
const worstLatRow = repro.rows.reduce((m, r) => r.maxLatDevM > m.maxLatDevM ? r : m, repro.rows[0]);
const worstAngVelRow = repro.rows.reduce((m, r) => r.maxAngVel > m.maxAngVel ? r : m, repro.rows[0]);
const identWorstLatRow = ident.rows.reduce((m, r) => r.maxLatDevM > m.maxLatDevM ? r : m, ident.rows[0]);

console.log('=== REPRODUCED SUMMARY (paste-version smoothSegment) ===');
console.log(JSON.stringify(repro.summary));
console.log('\n=== IDENTITY SUMMARY (latDev floor check) ===');
console.log(JSON.stringify(ident.summary));
console.log('\n=== DENSITY / DECIMATION CHECK ===');
console.log(JSON.stringify({
  segCount, rawCleanTotal, outTotal,
  ratio: +(outTotal / rawCleanTotal).toFixed(2),
  minOutPerSeg,
  maxFirstGapM: +maxFirstGap.toFixed(2),
  maxLastGapM: +maxLastGap.toFixed(2),
}));
console.log('\n=== PER-CHAPTER ROWS (repro) ===');
for (const r of repro.rows) console.log(JSON.stringify(r));
console.log('\n=== WORST ROWS ===');
console.log('repro worst latDev: ' + JSON.stringify(worstLatRow));
console.log('repro worst angVel: ' + JSON.stringify(worstAngVelRow));
console.log('identity worst latDev: ' + JSON.stringify(identWorstLatRow));
console.log('\n=== IDENTITY PER-CHAPTER latDev (verify "floor" claim 1888/1407/1075/902/770) ===');
for (const r of ident.rows) console.log(JSON.stringify({ name: r.name, maxLatDevM: r.maxLatDevM }));

console.log('\n__OUT__' + JSON.stringify({
  reproduced: repro.summary,
  identity: ident.summary,
  density: { segCount, rawCleanTotal, outTotal, ratio: +(outTotal / rawCleanTotal).toFixed(2), minOutPerSeg, maxFirstGapM: +maxFirstGap.toFixed(2), maxLastGapM: +maxLastGap.toFixed(2) },
}));
