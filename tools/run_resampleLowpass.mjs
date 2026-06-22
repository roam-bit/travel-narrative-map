// Runner for strategy key = "resampleLowpass"
// 思路：按弧长等距重采样(ds≈40~60m)→ 把 GPS 噪点的"采样密度不均"抹平，再对坐标序列做
//      滑动平均(box) 或 高斯低通(gauss)，把急弯/噪点处的高频抖动滤掉。
// 扫参：ds ∈ {40,50,60}，window(点数) ∈ {5,9,15,25,41}，kernel ∈ {box, gauss}
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';

const { hav, normalizePoint } = helpers;

// ---- 工具：去重 + 规范化 ----
function clean(points) {
  const P = [];
  for (const raw of points) {
    const p = normalizePoint(raw);
    if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p);
  }
  return P;
}

// ---- 按弧长等距重采样：沿折线每隔 ds 米放一个点（线性插值），保留首尾 ----
function resampleByArc(P, ds) {
  if (P.length < 2) return P.slice();
  const out = [P[0]];
  let carry = 0; // 距离上一个输出点已累计的弧长
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    let segLen = hav(a, b);
    if (segLen < 1e-9) continue;
    let used = 0; // 本条边已消费的长度
    while (carry + (segLen - used) >= ds) {
      const need = ds - carry;          // 还差多少米到下一个采样点
      const t = (used + need) / segLen;  // 在本边上的比例
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      used += need;
      carry = 0;
    }
    carry += segLen - used;
  }
  const last = P[P.length - 1];
  if (hav(out[out.length - 1], last) > ds * 0.25) out.push(last);
  else out[out.length - 1] = last; // 末点对齐，保真
  return out;
}

// ---- 高斯核（半径 = (window-1)/2，sigma = radius/2） ----
function gaussWeights(radius) {
  const sigma = Math.max(0.5, radius / 2);
  const w = [];
  for (let k = -radius; k <= radius; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return w;
}

// ---- 低通：对等距点序列做对称卷积；端点收缩窗口避免把首尾往里拽（保真） ----
function lowpass(P, window, kernel) {
  const n = P.length;
  if (n < 3 || window < 3) return P.slice();
  const radius = (window - 1) >> 1;
  const gw = kernel === 'gauss' ? gaussWeights(radius) : null;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    // 端点收缩：可用半径 = min(i, n-1-i, radius)，保证首尾点不动
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

// transformSeg 工厂
function makeTransform(ds, window, kernel) {
  return (rawPts) => {
    const P = clean(rawPts);
    if (P.length < 3) return P;
    const rs = resampleByArc(P, ds);
    if (rs.length < 3) return rs;
    return lowpass(rs, window, kernel);
  };
}

// ---- baselines ----
const baselines = [
  { name: 'identity', fn: (s) => clean(s) },
  { name: 'catmull6', fn: (s) => catmullRom(s, 6) },
];

// ---- sweep grid ----
const dsList = [40, 50, 60];
const windows = [5, 9, 15, 25, 41];
const kernels = ['box', 'gauss'];

const results = [];
console.log('=== baselines ===');
for (const b of baselines) {
  const { summary } = evaluate(b.fn, { name: b.name });
  console.log(JSON.stringify(summary));
}

console.log('\n=== resampleLowpass sweep ===');
for (const ds of dsList) {
  for (const kernel of kernels) {
    for (const window of windows) {
      const name = `rsLP_ds${ds}_w${window}_${kernel}`;
      const { summary } = evaluate(makeTransform(ds, window, kernel), { name });
      const row = { ds, window, kernel, ...summary };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
}

// 输出 JSON 便于程序读取
console.log('\n=== JSON ===');
console.log(JSON.stringify(results));
