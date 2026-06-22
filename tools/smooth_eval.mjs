// 统一平滑评测台：在真实轨迹上量化「丝滑度」与「轨迹保真度」，保证各策略口径一致可比。
// 用法：import { CH, evaluate, helpers } from './smooth_eval.mjs'
//   evaluate(transformSeg, { name, pace })  →  返回逐章 + 汇总指标
// transformSeg(rawPts) : 输入一段原始 GPS 点 [[lng,lat]...]，输出处理后的密集点 [[lng,lat]...]
// pace(legs)          : 可选，返回每条腿的「时间权重」数组（用于进弯减速等变速策略）；默认按里程
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..');
export const CH = JSON.parse(fs.readFileSync(path.join(PROJ, 'chapters_built.json'), 'utf8')).chapters;

// ---- 与 story.html 完全一致的常量 ----
const MIN_BRIDGE_M = 8000, PLAYBACK = 7000, BRIDGE_GLIDE_MS = 450, HEAD_LERP = 0.18, LOOKAHEAD_M = 60, SPEED = 4, FPS_MS = 1000 / 60;

const normalizePoint = p => (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) ? [+p[0], +p[1]] : null;
function hav(a, b) { const R = 6371008.8, r = x => x * Math.PI / 180; const la1 = r(a[1]), la2 = r(b[1]), dla = la2 - la1, dln = r(b[0] - a[0]); const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dln / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
function bearingDeg(a, b) { const r = x => x * Math.PI / 180, g = x => x * 180 / Math.PI; const la1 = r(a[1]), la2 = r(b[1]), dln = r(b[0] - a[0]); const y = Math.sin(dln) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dln); return (g(Math.atan2(y, x)) + 360) % 360; }
function lerpAngle(a, b, t) { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; }
function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
function angDiff(a, b) { return Math.abs(((b - a + 540) % 360) - 180); }

// 本地平面投影（米），用于点到折线距离 / 曲率
function localProjector(refLat) { const kx = 111320 * Math.cos(refLat * Math.PI / 180), ky = 110540; return p => [p[0] * kx, p[1] * ky]; }
function distPointToSeg(p, a, b) { const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1]; const c1 = vx * wx + vy * wy; if (c1 <= 0) return Math.hypot(wx, wy); const c2 = vx * vx + vy * vy; if (c2 <= c1) return Math.hypot(p[0] - b[0], p[1] - b[1]); const t = c1 / c2; return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy)); }

export const helpers = { normalizePoint, hav, bearingDeg, lerpAngle, easeInOutSine, angDiff, localProjector };

// 参考：story.html 现用的 Catmull-Rom（作为 baseline）
export function catmullRom(points, perSeg = 6) {
  const P = []; for (const raw of points) { const p = normalizePoint(raw); if (p && (!P.length || hav(P[P.length - 1], p) > 1)) P.push(p); }
  if (P.length < 3) return P;
  const at = i => P[Math.max(0, Math.min(P.length - 1, i))]; const out = [];
  for (let i = 0; i < P.length - 1; i++) { const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < perSeg; s++) { const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); } }
  out.push(P[P.length - 1]); return out;
}

function buildLegs(segsProcessed) {
  const legs = []; let total = 0, last = null;
  for (const seg of segsProcessed) {
    seg.forEach((cur, idx) => {
      if (last) { const d = hav(last, cur); if (d > 0.5) { const bridge = idx === 0 && d > MIN_BRIDGE_M; legs.push({ a: last, b: cur, d, start: total, end: total + d, heading: bearingDeg(last, cur), bridge }); total += d; } }
      last = cur;
    });
  }
  return { legs, total };
}
function sampleAt(pathObj, m) {
  const { legs, total } = pathObj; if (!legs.length) return null;
  if (m <= 0) return { point: legs[0].a, bridge: legs[0].bridge }; if (m >= total) return { point: legs[legs.length - 1].b, bridge: legs[legs.length - 1].bridge };
  let lo = 0, hi = legs.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (legs[mid].end < m) lo = mid + 1; else hi = mid; }
  const l = legs[lo], t = Math.max(0, Math.min(1, (m - l.start) / l.d));
  return { point: [l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t], bridge: l.bridge };
}
// 默认配速（与 story.html 一致）；pace 可覆盖 road 腿的时间权重
function buildPlan(pathObj, paceWeights) {
  const { legs, total } = pathObj;
  const roadDist = legs.reduce((s, l) => s + (l.bridge ? 0 : l.d), 0) || 1;
  const bridges = legs.filter(l => l.bridge).length;
  const roadMs = Math.max(3200, Math.min(17000, (roadDist / 1000) * PLAYBACK / SPEED));
  const bridgeMs = bridges ? Math.min(BRIDGE_GLIDE_MS, (roadMs * 0.4) / bridges) : 0;
  // road 腿权重：默认 = d；若提供 paceWeights（与 legs 等长，仅 road 生效）则归一化后乘 roadMs
  let wSum = 0; const w = legs.map((l, i) => { if (l.bridge) return 0; const ww = paceWeights ? Math.max(1e-6, paceWeights[i]) : l.d; wSum += ww; return ww; });
  const seg = []; let t = 0;
  for (let i = 0; i < legs.length; i++) { const l = legs[i]; const ms = l.bridge ? bridgeMs : (w[i] / (wSum || 1)) * roadMs; seg.push({ l, tStart: t, ms }); t += ms; }
  const duration = t || 1;
  const metersAt = el => { if (el <= 0) return 0; if (el >= duration) return total; let lo = 0, hi = seg.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (seg[mid].tStart + seg[mid].ms < el) lo = mid + 1; else hi = mid; } const e = seg[lo]; const frac = e.ms > 0 ? (el - e.tStart) / e.ms : 1; return e.l.start + Math.max(0, Math.min(1, frac)) * e.l.d; };
  return { duration, metersAt };
}

function pct(arr, q) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

// 评测单章
function evalChapter(ch, transformSeg, opts) {
  const paceFn = opts.pace, look = opts.lookahead || LOOKAHEAD_M, clamp = opts.headClampDeg || 0;
  const rawSegs = (ch.segments || []).map(s => (s || []).map(normalizePoint).filter(Boolean)).filter(s => s.length >= 2);
  if (!rawSegs.length) return null;
  const procSegs = rawSegs.map(s => transformSeg(s)).filter(s => s && s.length >= 2);
  const pathObj = buildLegs(procSegs);
  if (!pathObj.legs.length) return null;
  // 原始轨迹长度（保真度参照）
  let rawLen = 0; for (const s of rawSegs) for (let i = 1; i < s.length; i++) rawLen += hav(s[i - 1], s[i]);
  // 本地平面：原始边集合（点到折线距离用）
  const refLat = (ch.stats ? (ch.stats.latMin + ch.stats.latMax) / 2 : 35);
  const proj = localProjector(refLat);
  const rawEdges = []; for (const s of rawSegs) { const pp = s.map(proj); for (let i = 1; i < pp.length; i++) rawEdges.push([pp[i - 1], pp[i]]); }
  // 变速：默认按里程；paceFn 可基于每条腿的「转角」给权重
  const paceWeights = paceFn ? paceFn(pathObj.legs) : null;
  const plan = buildPlan(pathObj, paceWeights);
  const posAt = m => sampleAt(pathObj, Math.max(0, Math.min(pathObj.total, m)));
  const headingAt = m => { const a = posAt(m - 1), b = posAt(m + look); if (a && b && (a.point[0] !== b.point[0] || a.point[1] !== b.point[1])) return bearingDeg(a.point, b.point); return 0; };
  const frames = Math.max(2, Math.round(plan.duration / FPS_MS));
  let sh = headingAt(0), prevH = sh, prevAng = 0, prevBridge = true;
  const angVel = [], angAcc = [], latDev = [];
  for (let f = 1; f <= frames; f++) {
    const raw = f / frames; const m = plan.metersAt(easeInOutSine(raw) * plan.duration); const s = posAt(m);
    if (clamp) { let st = (((headingAt(m) - sh + 540) % 360) - 180) * HEAD_LERP; if (st > clamp) st = clamp; else if (st < -clamp) st = -clamp; sh = (sh + st + 360) % 360; }
    else sh = lerpAngle(sh, headingAt(m), HEAD_LERP);
    const curBridge = !!s.bridge;
    // 只在「路段」上统计丝滑/保真：空隙(bridge)是快进掠过，本就偏离不存在的轨迹，不该计入
    if (!curBridge && !prevBridge) {
      const av = angDiff(prevH, sh); angVel.push(av); angAcc.push(Math.abs(av - prevAng)); prevAng = av;
      const pp = proj(s.point); let best = Infinity; for (const e of rawEdges) { const dd = distPointToSeg(pp, e[0], e[1]); if (dd < best) best = dd; if (best < 5) break; } latDev.push(best);
    } else { prevAng = 0; }
    prevH = sh; prevBridge = curBridge;
  }
  if (!angVel.length) return null;
  let procLen = 0; for (const s of procSegs) for (let i = 1; i < s.length; i++) procLen += hav(s[i - 1], s[i]);
  return {
    name: ch.name,
    durS: +(plan.duration / 1000).toFixed(1),
    maxAngVel: +Math.max(...angVel).toFixed(2),
    p95AngVel: +pct(angVel, 0.95).toFixed(2),
    meanAngVel: +(angVel.reduce((a, b) => a + b, 0) / angVel.length).toFixed(3),
    maxAngAcc: +Math.max(...angAcc).toFixed(2),
    p95AngAcc: +pct(angAcc, 0.95).toFixed(3),
    maxLatDevM: +Math.max(...latDev).toFixed(0),
    p95LatDevM: +pct(latDev, 0.95).toFixed(0),
    lenPct: +(((procLen - rawLen) / (rawLen || 1)) * 100).toFixed(1),
  };
}

export function evaluate(transformSeg, opts = {}) {
  const rows = [];
  for (const ch of CH) { if (ch.transition) continue; const r = evalChapter(ch, transformSeg, opts); if (r) rows.push(r); }
  const agg = (k, fn) => fn(rows.map(r => r[k]));
  const mean = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
  const summary = {
    name: opts.name || 'strategy',
    // 丝滑度（越低越好）
    avg_p95AngVel: mean(rows.map(r => r.p95AngVel)),
    worst_maxAngVel: +Math.max(...rows.map(r => r.maxAngVel)).toFixed(2),
    avg_p95AngAcc: mean(rows.map(r => r.p95AngAcc)),
    worst_maxAngAcc: +Math.max(...rows.map(r => r.maxAngAcc)).toFixed(2),
    // 保真度（越低越贴合真实轨迹）
    worst_maxLatDevM: +Math.max(...rows.map(r => r.maxLatDevM)).toFixed(0),
    avg_p95LatDevM: mean(rows.map(r => r.p95LatDevM)),
    avg_lenPct: mean(rows.map(r => r.lenPct)),
  };
  return { summary, rows };
}
