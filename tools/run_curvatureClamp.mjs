// Runner for strategy key = "curvatureClamp"
// 思路：固定步长 ds 沿原始路径重采样 -> 逐步「航向角速率限制」。
// 每步航向变化不超过 dθmax = (ds / Rmin)·(180/π)，等价于强制最小转弯半径 Rmin。
// 急弯被圆成半径 Rmin 的圆弧；缓弯（曲率 < 1/Rmin）几乎不动。
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';

const { hav, bearingDeg, localProjector } = helpers;

// ---------- 经纬 <-> 本地平面（米）工具 ----------
// 用每段中心纬度做等距投影，转弯半径计算在平面内进行（更接近真实几何）。
function makeXY(refLat) {
  const kx = 111320 * Math.cos(refLat * Math.PI / 180), ky = 110540;
  return {
    toXY: p => [p[0] * kx, p[1] * ky],
    toLngLat: q => [q[0] / kx, q[1] / ky],
  };
}

// 沿折线按固定弧长 ds 重采样（在平面 XY 内做线性插值）
function resampleByArc(xy, ds) {
  if (xy.length < 2) return xy.slice();
  const out = [xy[0]];
  let prev = xy[0], acc = 0, segIdx = 1;
  // 用游走指针沿原折线推进
  let cur = xy[0];
  let i = 1;
  let remain = ds;
  let from = xy[0];
  let toIdx = 1;
  // 简洁实现：累计法
  let result = [xy[0].slice()];
  let dist = 0;
  let a = xy[0];
  for (let k = 1; k < xy.length; k++) {
    let b = xy[k];
    let segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (dist + segLen >= remain) {
      const t = (remain - dist) / segLen;
      const np = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      result.push(np);
      remain += ds;
    }
    dist += segLen;
    a = b;
  }
  // 保证终点
  const last = xy[xy.length - 1];
  const lr = result[result.length - 1];
  if (Math.hypot(last[0] - lr[0], last[1] - lr[1]) > ds * 0.25) result.push(last.slice());
  return result;
}

// 核心：航向角速率限制（=最小转弯半径 Rmin）
// 在平面 XY 内：固定步长 ds 行进，逐步限制航向变化幅度。
function curvatureClampXY(xyResampled, ds, Rmin) {
  if (xyResampled.length < 3) return xyResampled.slice();
  const dThetaMax = ds / Rmin; // 弧度/步，最小转弯半径对应的最大转角
  const out = [xyResampled[0].slice()];
  // 初始航向
  let heading = Math.atan2(
    xyResampled[1][1] - xyResampled[0][1],
    xyResampled[1][0] - xyResampled[0][0]
  );
  let pos = xyResampled[0].slice();
  out[0] = pos.slice();
  for (let i = 1; i < xyResampled.length; i++) {
    // 期望航向：指向下一个重采样点（用当前实际位置为起点，避免误差漂移累积过快）
    const target = xyResampled[i];
    const desired = Math.atan2(target[1] - pos[1], target[0] - pos[0]);
    // 角差归一化到 [-pi, pi]
    let d = desired - heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    // 限制单步转角
    if (d > dThetaMax) d = dThetaMax;
    else if (d < -dThetaMax) d = -dThetaMax;
    heading += d;
    // 前进 ds
    pos = [pos[0] + Math.cos(heading) * ds, pos[1] + Math.sin(heading) * ds];
    out.push(pos.slice());
  }
  return out;
}

// 组装 transformSeg 工厂
function makeTransform(ds, Rmin) {
  return function transformSeg(rawPts) {
    // 去重（与 catmullRom 一致，>1m 才保留）
    const P = [];
    for (const raw of rawPts) {
      const p = (Array.isArray(raw) && Number.isFinite(+raw[0]) && Number.isFinite(+raw[1])) ? [+raw[0], +raw[1]] : null;
      if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p);
    }
    if (P.length < 3) return P;
    const refLat = P.reduce((s, p) => s + p[1], 0) / P.length;
    const { toXY, toLngLat } = makeXY(refLat);
    const xy = P.map(toXY);
    const rs = resampleByArc(xy, ds);
    if (rs.length < 3) return P;
    const clamped = curvatureClampXY(rs, ds, Rmin);
    return clamped.map(toLngLat);
  };
}

// ---------- baseline 参照 ----------
const identity = seg => seg.map(p => [p[0], p[1]]);
const baseId = evaluate(identity, { name: 'identity' }).summary;
const baseCM = evaluate(seg => catmullRom(seg, 6), { name: 'catmull6' }).summary;
console.log('=== BASELINES ===');
console.log('identity :', JSON.stringify(baseId));
console.log('catmull6 :', JSON.stringify(baseCM));

// ---------- 扫参 ----------
const Rmins = [150, 300, 600, 1200, 2500];
const dsList = [30, 45, 60];
const sweep = [];
console.log('\n=== curvatureClamp SWEEP ===');
for (const ds of dsList) {
  for (const Rmin of Rmins) {
    const t = makeTransform(ds, Rmin);
    const { summary } = evaluate(t, { name: `cc_ds${ds}_R${Rmin}` });
    const row = { ds, Rmin, ...summary };
    sweep.push(row);
    console.log(
      `ds=${ds} Rmin=${Rmin}\t` +
      `p95AngVel=${summary.avg_p95AngVel}\tp95AngAcc=${summary.avg_p95AngAcc}\t` +
      `wMaxAngVel=${summary.worst_maxAngVel}\twMaxAngAcc=${summary.worst_maxAngAcc}\t` +
      `wMaxLatDev=${summary.worst_maxLatDevM}\tavgP95LatDev=${summary.avg_p95LatDevM}\tlenPct=${summary.avg_lenPct}`
    );
  }
}

// 输出 JSON 方便程序读取
console.log('\n=== JSON_SWEEP_START ===');
console.log(JSON.stringify({ baseId, baseCM, sweep }, null, 2));
console.log('=== JSON_SWEEP_END ===');
