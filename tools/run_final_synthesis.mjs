// 最终综合验证 runner —— 独立复跑基线 + 候选 + 新组合，拿真实数字
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';
const { normalizePoint, hav, bearingDeg, angDiff } = helpers;

// ---------- 工具：本地等距重采样（按弧长） ----------
function resampleByArc(pts, ds) {
  const P = [];
  for (const raw of pts) { const p = normalizePoint(raw); if (p && (!P.length || hav(P[P.length - 1], p) > 0.5)) P.push(p); }
  if (P.length < 2) return P;
  const out = [P[0]]; let acc = 0;
  for (let i = 1; i < P.length; i++) {
    let a = P[i - 1], b = P[i]; let segLen = hav(a, b);
    while (acc + segLen >= ds) {
      const t = (ds - acc) / segLen;
      const np = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(np); a = np; segLen = hav(a, b); acc = 0;
    }
    acc += segLen;
  }
  const last = P[P.length - 1];
  if (hav(out[out.length - 1], last) > ds * 0.25) out.push(last); else out[out.length - 1] = last;
  return out;
}

// ---------- 高斯低通（端点收缩窗口，保首尾不动） ----------
function gaussLowpass(pts, window) {
  const n = pts.length; if (n < 3 || window < 3) return pts;
  const radius = Math.floor(window / 2); const sigma = radius / 2 || 1;
  const ker = []; let ks = 0;
  for (let k = -radius; k <= radius; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); ker.push(w); ks += w; }
  for (let i = 0; i < ker.length; i++) ker[i] /= ks;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) { out[i] = pts[i]; continue; }
    const r = Math.min(radius, i, n - 1 - i); // 端点收缩，保首尾
    if (r < 1) { out[i] = pts[i]; continue; }
    let sx = 0, sy = 0, sw = 0;
    for (let k = -r; k <= r; k++) { const w = Math.exp(-(k * k) / (2 * sigma * sigma)); sx += pts[i + k][0] * w; sy += pts[i + k][1] * w; sw += w; }
    out[i] = [sx / sw, sy / sw];
  }
  return out;
}

// ===== 候选 transform 定义 =====
const identity = s => s.map(normalizePoint).filter(Boolean);
const catmull6 = s => catmullRom(s, 6);

// resampleLowpass（上报最优：ds=60, window=25）
function makeLowpass(ds, window, outDs) {
  return s => {
    let p = resampleByArc(s, ds);
    if (p.length < 3) return p;
    p = gaussLowpass(p, window);
    if (outDs && outDs > 0) p = resampleByArc(p, outDs);
    return p;
  };
}

// chaikin（上报最优：ds=30, iters=5, outDs=18）
function chaikin(pts, iters) {
  let P = pts;
  for (let it = 0; it < iters; it++) {
    if (P.length < 3) break;
    const out = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(P[P.length - 1]); P = out;
  }
  return P;
}
function makeChaikin(ds, iters, outDs) {
  return s => {
    let p = resampleByArc(s, ds);
    if (p.length < 3) return p;
    p = chaikin(p, iters);
    p = resampleByArc(p, outDs);
    return p;
  };
}

// 新组合：低通 + 进弯减速 pace（验证"曲率/进弯减速"叠加是否更优）
function makePace(geomFn, k) {
  // pace 基于每条腿 heading 与下一条 road 腿 heading 的夹角
  return (legs) => {
    const w = new Array(legs.length).fill(1);
    // 找每条 road 腿的下一条 road 腿
    for (let i = 0; i < legs.length; i++) {
      if (legs[i].bridge) { w[i] = 1; continue; }
      let j = i + 1; while (j < legs.length && legs[j].bridge) j++;
      let turn = 0;
      if (j < legs.length) turn = angDiff(legs[i].heading, legs[j].heading);
      const turnNorm = Math.min(1, turn / 90);
      w[i] = legs[i].d * (1 + k * turnNorm);
    }
    return w;
  };
}

// ===== 跑分 =====
function row(name, sum) {
  return `${name.padEnd(26)} p95AngVel=${String(sum.avg_p95AngVel).padStart(7)}  p95AngAcc=${String(sum.avg_p95AngAcc).padStart(7)}  wMaxAngVel=${String(sum.worst_maxAngVel).padStart(6)}  wMaxAngAcc=${String(sum.worst_maxAngAcc).padStart(6)}  wMaxLatDev=${String(sum.worst_maxLatDevM).padStart(5)}  p95LatDev=${String(sum.avg_p95LatDevM).padStart(7)}  len%=${sum.avg_lenPct}`;
}

const results = [];
function go(name, tf, opts) { const { summary } = evaluate(tf, { name, ...(opts || {}) }); results.push([name, summary]); console.log(row(name, summary)); return summary; }

console.log('=== 基线 ===');
go('identity', identity);
go('catmull6 (现状baseline)', catmull6);

console.log('\n=== 候选最优配置复跑 ===');
const lp = go('resampleLowpass d60w25o18', makeLowpass(60, 25, 18));
go('chaikin d30i5o18', makeChaikin(30, 5, 18));

console.log('\n=== 低通参数扫（找膝点，关注保真不爆） ===');
go('lowpass d60w15o18', makeLowpass(60, 15, 18));
go('lowpass d60w21o18', makeLowpass(60, 21, 18));
go('lowpass d45w15o15', makeLowpass(45, 15, 15));
go('lowpass d45w21o15', makeLowpass(45, 21, 15));
go('lowpass d80w25o20', makeLowpass(80, 25, 20));
go('lowpass d50w19o16', makeLowpass(50, 19, 16));

console.log('\n=== 低通 + 进弯减速 pace（验证叠加） ===');
go('lowpass+pace k0.5', makeLowpass(60, 25, 18), { pace: makePace(null, 0.5) });
go('lowpass+pace k1.0', makeLowpass(60, 25, 18), { pace: makePace(null, 1.0) });
go('lowpass+pace k0.25', makeLowpass(60, 25, 18), { pace: makePace(null, 0.25) });

console.log('\n=== 排名（按 avg_p95AngVel 升序） ===');
results.sort((a, b) => a[1].avg_p95AngVel - b[1].avg_p95AngVel);
for (const [n, s] of results) console.log(row(n, s));
