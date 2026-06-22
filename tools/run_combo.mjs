// 组合策略 runner（key=combo）：曲率限幅(几何) + 进弯减速(配速)
// 关键事实：原始点很稀疏（中位间距 ~3km），所以"切圆角"必须按【绝对米】回退，
// 否则在几公里长的边上会把弧顶甩出去，导致长度暴涨+巨大偏离。
// 跑法：node tools/run_combo.mjs
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';
const { normalizePoint, hav, bearingDeg, angDiff, localProjector } = helpers;

function clean(points) {
  const P = [];
  for (const raw of points) {
    const p = normalizePoint(raw);
    if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p);
  }
  return P;
}

// 在折点 B 上做"切圆角"：沿两边各回退 cutM 米（绝对值，受边长上限约束），
// 用二次贝塞尔(控制点=B)把两切点连成圆角弧。只在转角>minTurn 时动手。
// cutM 控制圆角大小（越大越圆滑、偏离越大）；arcN 圆角插值密度。
function cornerCut(points, cutM, minTurnDeg, arcN, devCapM = Infinity) {
  const P = clean(points);
  if (P.length < 3) return P;
  const refLat = P.reduce((s, p) => s + p[1], 0) / P.length;
  const proj = localProjector(refLat);
  const kx = 111320 * Math.cos(refLat * Math.PI / 180), ky = 110540;
  const unproj = m => [m[0] / kx, m[1] / ky];
  const XY = P.map(proj);
  const minTurn = minTurnDeg * Math.PI / 180;

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
    // 回退距离 = cutM，但不超过两边的 35%（避免吃掉整条边）
    let t = Math.min(cutM, lu * 0.35, lv * 0.35);
    // devCap：二次贝塞尔弧顶(u=0.5)到原折点 B 的偏离 ≈ 0.5*t*sin(turn/2)。
    // 若超过 devCapM，则按比例缩小 t，保证个别急弯不会被切得太离谱。
    const bulge = 0.5 * t * Math.sin(turn / 2);
    if (bulge > devCapM && bulge > 1e-6) t *= devCapM / bulge;
    if (t < 1) { out.push(B.slice()); continue; }
    const p1 = [B[0] - ux / lu * t, B[1] - uy / lu * t];
    const p2 = [B[0] + vx / lv * t, B[1] + vy / lv * t];
    out.push(p1.slice());
    for (let s = 1; s < arcN; s++) {
      const u = s / arcN, iu = 1 - u;
      out.push([
        iu * iu * p1[0] + 2 * iu * u * B[0] + u * u * p2[0],
        iu * iu * p1[1] + 2 * iu * u * B[1] + u * u * p2[1],
      ]);
    }
    out.push(p2.slice());
  }
  out.push(XY[XY.length - 1].slice());
  return out.map(unproj);
}

// 进弯减速：转得越急的腿，时间权重越大（停留越久），把航向变化摊到更多帧。
function makeAdaptiveSpeed(k, win) {
  return legs => {
    const n = legs.length;
    const w = new Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      if (legs[i].bridge) { w[i] = 1; continue; }
      let maxTurn = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
        if (legs[j].bridge) continue;
        const d = angDiff(legs[i].heading, legs[j].heading);
        if (d > maxTurn) maxTurn = d;
      }
      w[i] = 1 + k * (maxTurn / 90);
    }
    return w;
  };
}

// 给 cornerCut 的弧再补点：让相邻处理后点最大间距 <= maxGapM，
// 保证输出"密集、覆盖整段"，不靠抽稀作弊（评测 angVel 也更稳）。
function densify(lngLat, maxGapM) {
  if (lngLat.length < 2) return lngLat;
  const out = [lngLat[0]];
  for (let i = 1; i < lngLat.length; i++) {
    const a = lngLat[i - 1], b = lngLat[i], d = hav(a, b);
    const n = Math.max(1, Math.ceil(d / maxGapM));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// ---------- baseline 参照 ----------
const base = evaluate(p => catmullRom(p, 6), { name: 'baseline_catmull6' });
const idn = evaluate(p => clean(p), { name: 'identity' });
console.log('BASELINE catmull6:', JSON.stringify(base.summary));
console.log('IDENTITY       :', JSON.stringify(idn.summary));

// ---------- combo 扫参（聚焦：几何为主，配速很轻或不用）----------
// 关键发现：identity(原始轨迹本身)的 worst_maxLatDevM 已是 1888m，p95LatDev=0，
// 说明这个 worst 来自评测台在段/桥接边界上的少数几帧（不可避免的地板），
// 不是 transform 造成的真实偏离。所以"丝滑优先 + 保住 lenPct 与 avg_p95LatDev 小"，
// worst_maxLatDevM 尽量压低但以接近 identity 地板为现实目标。
const cutGrid = [80, 120, 180, 250, 350];
const minTurnDeg = 18;
const arcN = 6;        // 圆角弧插值点数
const maxGapM = 200;   // 输出最大点间距（密集化，不抽稀作弊）
// devCapM：限制圆角弧顶相对原折点的最大偏离米数（防个别急弯被切太狠）
const devCapM = 350;
const speedGrid = [
  { k: 0, win: 0, label: 'noSpeed' },
  { k: 0.5, win: 3 },
  { k: 1.0, win: 3 },
];

const transformFor = cutM => seg => densify(cornerCut(seg, cutM, minTurnDeg, arcN, devCapM), maxGapM);

const sweep = [];
sweep.push({ params: 'baseline_catmull6', ...base.summary });
sweep.push({ params: 'identity', ...idn.summary });

console.log('\n=== COMBO SWEEP ===');
for (const cutM of cutGrid) {
  const transform = transformFor(cutM);
  for (const sp of speedGrid) {
    const pace = sp.k > 0 ? makeAdaptiveSpeed(sp.k, sp.win) : undefined;
    const name = `cut${cutM}_${sp.label || `k${sp.k}w${sp.win}`}`;
    const { summary } = evaluate(transform, { name, pace });
    const row = {
      params: name, cutM, k: sp.k, win: sp.win,
      avg_p95AngVel: summary.avg_p95AngVel,
      avg_p95AngAcc: summary.avg_p95AngAcc,
      worst_maxAngVel: summary.worst_maxAngVel,
      worst_maxAngAcc: summary.worst_maxAngAcc,
      worst_maxLatDevM: summary.worst_maxLatDevM,
      avg_p95LatDevM: summary.avg_p95LatDevM,
      avg_lenPct: summary.avg_lenPct,
    };
    sweep.push(row);
    console.log(JSON.stringify(row));
  }
}

// ---------- 选膝点 ----------
// 现实约束：avg_lenPct∈[-4,3]（硬性，已全部满足）；avg_p95LatDevM 要小（真实保真）；
// worst_maxLatDevM 越接近 identity 地板(1888)越好。丝滑(angVel/angAcc)主目标。
const score = r => r.avg_p95AngVel + 0.6 * r.avg_p95AngAcc + 0.1 * r.worst_maxAngVel;
const feasible = sweep.filter(r => r.cutM !== undefined
  && r.avg_lenPct >= -4 && r.avg_lenPct <= 3 && r.avg_p95LatDevM <= 60);
feasible.sort((a, b) => score(a) - score(b));
console.log('\n=== FEASIBLE (sorted by smoothness score, lower=better) ===');
feasible.slice(0, 12).forEach(r => console.log(score(r).toFixed(2), 'wDev', r.worst_maxLatDevM, JSON.stringify(r)));
console.log('\nBEST(smoothness):', feasible.length ? JSON.stringify(feasible[0]) : 'NONE');
