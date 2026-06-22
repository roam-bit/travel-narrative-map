// 精确复刻评测台的 latDev 计算（只统计 non-bridge 帧），定位 worst_maxLatDevM=2156 的那一帧，
// 判断：它是 transform 真实把轨迹切弯甩出去，还是只是非桥但临近段边界/桥接边缘的少数帧（地板）。
import { evaluate, catmullRom, helpers } from './smooth_eval.mjs';
const { normalizePoint, hav, bearingDeg, lerpAngle, easeInOutSine, angDiff, localProjector } = helpers;
const CH = (await import('./smooth_eval.mjs')).CH;

function _hav(a, b) { const R = 6371008.8, r = x => x * Math.PI / 180; const la1 = r(a[1]), la2 = r(b[1]), dla = la2 - la1, dln = r(b[0] - a[0]); const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dln / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
function _normPt(p) { return (Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) ? [+p[0], +p[1]] : null; }
const CC_CUT_M = 250, CC_MIN_DEG = 18, CC_ARC_N = 6, CC_DEVCAP_M = 350, CC_MAXGAP_M = 200;
function cornerCutSmooth(rawPts) {
  const P = []; for (const raw of rawPts) { const p = _normPt(raw); if (p && (!P.length || _hav(P[P.length - 1], p) > 1)) P.push(p); }
  if (P.length < 3) return P;
  const refLat = P.reduce((s, p) => s + p[1], 0) / P.length;
  const kx = 111320 * Math.cos(refLat * Math.PI / 180), ky = 110540;
  const XY = P.map(p => [p[0] * kx, p[1] * ky]);
  const minTurn = CC_MIN_DEG * Math.PI / 180;
  const out = [XY[0].slice()];
  for (let i = 1; i < XY.length - 1; i++) {
    const A = XY[i - 1], B = XY[i], C = XY[i + 1];
    const ux = B[0] - A[0], uy = B[1] - A[1], vx = C[0] - B[0], vy = C[1] - B[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) { out.push(B.slice()); continue; }
    let cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    const turn = Math.acos(cos);
    if (turn < minTurn) { out.push(B.slice()); continue; }
    let t = Math.min(CC_CUT_M, lu * 0.35, lv * 0.35);
    const bulge = 0.5 * t * Math.sin(turn / 2);
    if (bulge > CC_DEVCAP_M && bulge > 1e-6) t *= CC_DEVCAP_M / bulge;
    if (t < 1) { out.push(B.slice()); continue; }
    const p1 = [B[0] - ux / lu * t, B[1] - uy / lu * t], p2 = [B[0] + vx / lv * t, B[1] + vy / lv * t];
    out.push(p1.slice());
    for (let s = 1; s < CC_ARC_N; s++) { const u = s / CC_ARC_N, iu = 1 - u; out.push([iu * iu * p1[0] + 2 * iu * u * B[0] + u * u * p2[0], iu * iu * p1[1] + 2 * iu * u * B[1] + u * u * p2[1]]); }
    out.push(p2.slice());
  }
  out.push(XY[XY.length - 1].slice());
  let lngLat = out.map(m => [m[0] / kx, m[1] / ky]);
  const dense = [lngLat[0]];
  for (let i = 1; i < lngLat.length; i++) { const a = lngLat[i - 1], b = lngLat[i], d = _hav(a, b); const n = Math.max(1, Math.ceil(d / CC_MAXGAP_M)); for (let s = 1; s <= n; s++) { const tt = s / n; dense.push([a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]); } }
  return dense;
}

// 评测台内部常量与函数（逐字复刻）
const MIN_BRIDGE_M = 8000, PLAYBACK = 7000, BRIDGE_GLIDE_MS = 450, HEAD_LERP = 0.18, LOOKAHEAD_M = 60, SPEED = 4, FPS_MS = 1000 / 60;
function distPointToSeg(p, a, b) { const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1]; const c1 = vx * wx + vy * wy; if (c1 <= 0) return Math.hypot(wx, wy); const c2 = vx * vx + vy * vy; if (c2 <= c1) return Math.hypot(p[0] - b[0], p[1] - b[1]); const t = c1 / c2; return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy)); }
function buildLegs(segsProcessed) { const legs = []; let total = 0, last = null; for (const seg of segsProcessed) { seg.forEach((cur, idx) => { if (last) { const d = hav(last, cur); if (d > 0.5) { const bridge = idx === 0 && d > MIN_BRIDGE_M; legs.push({ a: last, b: cur, d, start: total, end: total + d, heading: bearingDeg(last, cur), bridge }); total += d; } } last = cur; }); } return { legs, total }; }
function sampleAt(pathObj, m) { const { legs, total } = pathObj; if (!legs.length) return null; if (m <= 0) return { point: legs[0].a, bridge: legs[0].bridge }; if (m >= total) return { point: legs[legs.length - 1].b, bridge: legs[legs.length - 1].bridge }; let lo = 0, hi = legs.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (legs[mid].end < m) lo = mid + 1; else hi = mid; } const l = legs[lo], t = Math.max(0, Math.min(1, (m - l.start) / l.d)); return { point: [l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t], bridge: l.bridge }; }
function buildPlan(pathObj, paceWeights) { const { legs, total } = pathObj; const roadDist = legs.reduce((s, l) => s + (l.bridge ? 0 : l.d), 0) || 1; const bridges = legs.filter(l => l.bridge).length; const roadMs = Math.max(3200, Math.min(17000, (roadDist / 1000) * PLAYBACK / SPEED)); const bridgeMs = bridges ? Math.min(BRIDGE_GLIDE_MS, (roadMs * 0.4) / bridges) : 0; let wSum = 0; const w = legs.map((l, i) => { if (l.bridge) return 0; const ww = paceWeights ? Math.max(1e-6, paceWeights[i]) : l.d; wSum += ww; return ww; }); const seg = []; let t = 0; for (let i = 0; i < legs.length; i++) { const l = legs[i]; const ms = l.bridge ? bridgeMs : (w[i] / (wSum || 1)) * roadMs; seg.push({ l, tStart: t, ms }); t += ms; } const duration = t || 1; const metersAt = el => { if (el <= 0) return 0; if (el >= duration) return total; let lo = 0, hi = seg.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (seg[mid].tStart + seg[mid].ms < el) lo = mid + 1; else hi = mid; } const e = seg[lo]; const frac = e.ms > 0 ? (el - e.tStart) / e.ms : 1; return e.l.start + Math.max(0, Math.min(1, frac)) * e.l.d; }; return { duration, metersAt }; }

function analyze(ch, transform) {
  const rawSegs = (ch.segments || []).map(s => (s || []).map(normalizePoint).filter(Boolean)).filter(s => s.length >= 2);
  if (!rawSegs.length) return null;
  const procSegs = rawSegs.map(s => transform(s)).filter(s => s && s.length >= 2);
  const pathObj = buildLegs(procSegs);
  if (!pathObj.legs.length) return null;
  const refLat = (ch.stats ? (ch.stats.latMin + ch.stats.latMax) / 2 : 35);
  const proj = localProjector(refLat);
  const rawEdges = []; for (const s of rawSegs) { const pp = s.map(proj); for (let i = 1; i < pp.length; i++) rawEdges.push([pp[i - 1], pp[i]]); }
  const plan = buildPlan(pathObj, null);
  const posAt = m => sampleAt(pathObj, Math.max(0, Math.min(pathObj.total, m)));
  const frames = Math.max(2, Math.round(plan.duration / FPS_MS));
  let prevBridge = true; let worst = { dev: -1 };
  const latDev = [];
  for (let f = 1; f <= frames; f++) {
    const raw = f / frames; const m = plan.metersAt(easeInOutSine(raw) * plan.duration); const s = posAt(m);
    const curBridge = !!s.bridge;
    if (!curBridge && !prevBridge) {
      const pp = proj(s.point); let best = Infinity; for (const e of rawEdges) { const dd = distPointToSeg(pp, e[0], e[1]); if (dd < best) best = dd; if (best < 5) break; }
      latDev.push(best);
      if (best > worst.dev) {
        // 找最近 bridge 腿距离
        let minBD = Infinity; for (const l of pathObj.legs) if (l.bridge) { const d = Math.min(Math.abs(l.start - m), Math.abs(l.end - m)); if (d < minBD) minBD = d; }
        worst = { dev: best, m, point: s.point, minBridgeDistM: minBD };
      }
    }
    prevBridge = curBridge;
  }
  return { name: ch.name, maxLatDev: +worst.dev.toFixed(0), atM: +worst.m.toFixed(0), totalM: +pathObj.total.toFixed(0), minBridgeDistM: isFinite(worst.minBridgeDistM) ? +worst.minBridgeDistM.toFixed(0) : null, nFrames: frames, durS: +(plan.duration / 1000).toFixed(1) };
}

for (const name of ['终章 · 冰封北境与归途', '第一章 · 江南向暖', '第二章 · 一路到天涯', '第四章 · 攀升，向横断山']) {
  const ch = CH.find(c => c.name === name && !c.transition);
  if (!ch) { console.log('未找到', name); continue; }
  console.log(`\n【${name}】`);
  console.log('  combo   :', JSON.stringify(analyze(ch, cornerCutSmooth)));
}
