// Runner for strategy key = "adaptiveSpeed"
// 思路：【零额外偏离方案】几何完全不动（transform 用现状 catmullRom6 baseline，latDev 与 baseline 同口径），
// 只通过 pace(legs) 实现"进弯减速"：给转角大的 road 腿更多"时间权重"。
// 评测台每帧用 HEAD_LERP=0.18 平滑车头；在急弯多停留几帧 → 同样的转角被摊到更多帧 → 单帧角变化(AngVel)下降。
//
// road 腿时间权重 w = d * (1 + k * turnNorm)
//   turn = 本腿 heading 与"下一条 road 腿" heading 的夹角(度, 0..180)
//   turnNorm = turn / 90  (90°夹角即视为强弯，封顶 1)
// 扫 k ∈ {0.5,1,2,4,8}
//
// 注意：pace 只改"在每条腿上花多少时间"，不改任何点坐标 → 几何不变 → latDev / lenPct 与几何基线完全一致。

import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';

const { bearingDeg, angDiff } = helpers;

// 几何：沿用 story.html 现状的 Catmull-Rom（perSeg=6），保证 latDev 口径与现状一致
const transformSeg = (rawPts) => catmullRom(rawPts, 6);

// 给定 k，构造 pace 函数
function makePace(k) {
  return (legs) => {
    const n = legs.length;
    // 预取每条腿的"下一条 road 腿"索引，跳过 bridge
    const weights = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const l = legs[i];
      if (l.bridge) { weights[i] = 0; continue; } // bridge 腿评测台忽略
      // 找下一条 road 腿
      let j = i + 1;
      while (j < n && legs[j].bridge) j++;
      let turn = 0;
      if (j < n) turn = angDiff(l.heading, legs[j].heading); // 0..180
      const turnNorm = Math.min(1, turn / 90); // 90°封顶为 1
      weights[i] = l.d * (1 + k * turnNorm);
    }
    return weights;
  };
}

const KS = [0.5, 1, 2, 4, 8];

// baseline 对照：纯几何 catmull6 + 默认配速（pace=null）
const base = evaluate(transformSeg, { name: 'catmull6_baseline' });
console.log('=== BASELINE (catmull6, default pace) ===');
console.log(JSON.stringify(base.summary, null, 0));

const sweep = [];
for (const k of KS) {
  const res = evaluate(transformSeg, { name: `adaptiveSpeed_k${k}`, pace: makePace(k) });
  const s = res.summary;
  sweep.push({ k, ...s });
  console.log(`\n=== adaptiveSpeed k=${k} ===`);
  console.log(JSON.stringify(s, null, 0));
}

console.log('\n=== SWEEP TABLE (k | avgP95AngVel | avgP95AngAcc | worstMaxAngVel | worstMaxAngAcc | worstLatDevM | avgP95LatDevM | avgLenPct) ===');
console.log(`base  | ${base.summary.avg_p95AngVel} | ${base.summary.avg_p95AngAcc} | ${base.summary.worst_maxAngVel} | ${base.summary.worst_maxAngAcc} | ${base.summary.worst_maxLatDevM} | ${base.summary.avg_p95LatDevM} | ${base.summary.avg_lenPct}`);
for (const r of sweep) {
  console.log(`k=${r.k} | ${r.avg_p95AngVel} | ${r.avg_p95AngAcc} | ${r.worst_maxAngVel} | ${r.worst_maxAngAcc} | ${r.worst_maxLatDevM} | ${r.avg_p95LatDevM} | ${r.avg_lenPct}`);
}

// JSON for machine parsing
console.log('\n__SWEEP_JSON__' + JSON.stringify({ baseline: base.summary, sweep }));
