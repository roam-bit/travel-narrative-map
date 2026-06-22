// 独立审查 runner for strategy = "curvatureClamp"
// 关键：直接使用上报 JSON 里的 transformCode（=要粘进 story.html 的那段），
// 不复用 run_curvatureClamp.mjs 的内部实现，以验证「上报代码」本身能否复现声称数字。
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';

// ====== 以下函数为上报 transformCode 原文逐字粘贴 ======
function curvatureClampSeg(rawPts, opt) {
  const ds = (opt && opt.ds) || 45;       // 固定步长（米），可取 30~60
  const Rmin = (opt && opt.Rmin) || 150;  // 最小转弯半径（米）；越大越平滑但越偏离真实轨迹

  // 经纬度球面距离（米），用于去重
  const hav = (a, b) => {
    const R = 6371008.8, r = x => x * Math.PI / 180;
    const la1 = r(a[1]), la2 = r(b[1]), dla = la2 - la1, dln = r(b[0] - a[0]);
    const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dln / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  // 1) 清洗 + 去重（与原 catmullRom 口径一致：相邻 >1m 才保留）
  const P = [];
  for (const raw of rawPts) {
    const p = (Array.isArray(raw) && Number.isFinite(+raw[0]) && Number.isFinite(+raw[1])) ? [+raw[0], +raw[1]] : null;
    if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p);
  }
  if (P.length < 3) return P;

  // 2) 局部等距投影到平面 XY（米），半径运算在平面内做
  const refLat = P.reduce((s, p) => s + p[1], 0) / P.length;
  const kx = 111320 * Math.cos(refLat * Math.PI / 180), ky = 110540;
  const toXY = p => [p[0] * kx, p[1] * ky];
  const toLngLat = q => [q[0] / kx, q[1] / ky];
  const xy = P.map(toXY);

  // 3) 沿折线按固定弧长 ds 重采样（密度合理，覆盖整段）
  const rs = [xy[0].slice()];
  let remain = ds, dist = 0, a = xy[0];
  for (let k = 1; k < xy.length; k++) {
    const b = xy[k], segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (dist + segLen >= remain) {
      const t = (remain - dist) / segLen;
      rs.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      remain += ds;
    }
    dist += segLen; a = b;
  }
  const last = xy[xy.length - 1], lr = rs[rs.length - 1];
  if (Math.hypot(last[0] - lr[0], last[1] - lr[1]) > ds * 0.25) rs.push(last.slice());
  if (rs.length < 3) return P;

  // 4) 航向角速率限制：每步航向变化不超过 dθmax，等价于最小转弯半径 Rmin
  const dThetaMax = ds / Rmin; // 弧度/步
  const out = [rs[0].slice()];
  let heading = Math.atan2(rs[1][1] - rs[0][1], rs[1][0] - rs[0][0]);
  let pos = rs[0].slice();
  for (let i = 1; i < rs.length; i++) {
    const tgt = rs[i];
    let desired = Math.atan2(tgt[1] - pos[1], tgt[0] - pos[0]);
    let d = desired - heading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (d > dThetaMax) d = dThetaMax;        // 急弯：按 Rmin 圆弧转
    else if (d < -dThetaMax) d = -dThetaMax;
    heading += d;
    pos = [pos[0] + Math.cos(heading) * ds, pos[1] + Math.sin(heading) * ds];
    out.push(pos.slice());
  }

  // 5) 转回经纬度返回密集点
  return out.map(toLngLat);
}
// ====== 上报 transformCode 原文结束 ======

const { hav } = helpers;

// baseline
const identity = seg => seg.map(p => [p[0], p[1]]);
const baseId = evaluate(identity, { name: 'identity' }).summary;
const baseCM = evaluate(seg => catmullRom(seg, 6), { name: 'catmull6' }).summary;

// 上报 best 参数：ds=45, Rmin=150
const t = seg => curvatureClampSeg(seg, { ds: 45, Rmin: 150 });
const res = evaluate(t, { name: 'cc_ds45_R150' });

// 密度/覆盖审计：对每章统计 transform 前后点数，确认没有抽稀作弊
import { CH } from './smooth_eval.mjs';
const normalizePoint = helpers.normalizePoint;
const densAudit = [];
for (const ch of CH) {
  if (ch.transition) continue;
  const rawSegs = (ch.segments || []).map(s => (s || []).map(normalizePoint).filter(Boolean)).filter(s => s.length >= 2);
  let rawN = 0, procN = 0, rawLen = 0, procLen = 0;
  for (const s of rawSegs) {
    rawN += s.length;
    for (let i = 1; i < s.length; i++) rawLen += hav(s[i - 1], s[i]);
    const p = t(s);
    procN += p.length;
    for (let i = 1; i < p.length; i++) procLen += hav(p[i - 1], p[i]);
  }
  densAudit.push({
    name: ch.name,
    rawN, procN,
    rawLenKm: +(rawLen / 1000).toFixed(2),
    procSpacingM: procN > 1 ? +(procLen / (procN - rawSegs.length)).toFixed(1) : null,
  });
}

console.log('=== BASELINES ===');
console.log('identity :', JSON.stringify(baseId));
console.log('catmull6 :', JSON.stringify(baseCM));
console.log('\n=== REPRODUCED cc_ds45_R150 SUMMARY ===');
console.log(JSON.stringify(res.summary, null, 2));
console.log('\n=== PER-CHAPTER ROWS ===');
for (const r of res.rows) console.log(JSON.stringify(r));
console.log('\n=== DENSITY / COVERAGE AUDIT (rawN -> procN, avg spacing m) ===');
for (const d of densAudit) console.log(JSON.stringify(d));
