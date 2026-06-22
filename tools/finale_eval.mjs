// M4 收尾评测台：从 story.html 提取真实页面代码，在 node 里跑收尾的纯数学部分做回归。
// 用法：node tools/finale_eval.mjs
// 验证：①script 语法 ②finaleFitView 目标视野 ③全程流光路径点数/合法性 ④照片聚类簇数/间距/总数/顺序
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, "story.html"), "utf8");

// 取主 <script> 块（不带 src 的最后一块）
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = blocks[blocks.length - 1].replace("window.onload = boot;", "");

// 最小 DOM/环境 mock：顶层只有声明和 $ 等，足够 vm 跑起来
const sandbox = {
  window: {}, innerWidth: 1512, innerHeight: 884,
  document: { querySelector: () => null, createElement: () => ({ style: {} }) },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, console, Math, JSON,
  URLSearchParams, location: { search: "" },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox);
  console.log("✅ 语法/顶层执行 OK");
} catch (e) {
  console.log("❌ script 执行失败:", e.message);
  process.exit(1);
}

// 灌入真实数据（页面变量是 let 声明、不在 sandbox 对象上 → 必须在 context 内部赋值）
sandbox.__DATA = {
  CH: JSON.parse(readFileSync(path.join(root, "chapters_built.json"), "utf8")).chapters,
  WEB: JSON.parse(readFileSync(path.join(root, "web_photos.json"), "utf8")),
  map: { getSize: () => ({ width: 1512, height: 884 }) },
};
vm.runInContext(`
  CH = __DATA.CH;
  realChapters = CH.map((c, i) => ({ c, i })).filter(x => !x.c.transition);
  window.WEBPHOTOS = __DATA.WEB;
  map = __DATA.map;
`, sandbox);

let fail = 0;
const check = (name, ok, detail) => { console.log((ok ? "✅" : "❌") + " " + name + (detail ? "：" + detail : "")); if (!ok) fail++; };

// ① 目标视野
const fit = vm.runInContext("finaleFitView()", sandbox);
check("fit.zoom 合理", fit.zoom >= 3.5 && fit.zoom <= 5.5, "zoom=" + fit.zoom.toFixed(2));
check("fit.center 在中国范围", fit.center[0] > 90 && fit.center[0] < 120 && fit.center[1] > 20 && fit.center[1] < 45,
  "center=" + fit.center.map(v => v.toFixed(2)).join(","));

// ② 全程流光路径（多段：>200km 空隙断开，飞机/轮渡不画直线）
const t0 = Date.now();
const fp = vm.runInContext("buildFinalePath()", sandbox);
const buildMs = Date.now() - t0;
const havM = (a, b) => { const R = 6371008.8, r = d => d * Math.PI / 180; const h = Math.sin(r(b[1]-a[1])/2)**2 + Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(r(b[0]-a[0])/2)**2; return 2*R*Math.asin(Math.min(1,Math.sqrt(h))); };
check("流光总点数适中(1000~4000)", fp.total >= 1000 && fp.total <= 4000, fp.total + " 点 / " + fp.runs.length + " 段，构建 " + buildMs + "ms");
const badPt = fp.runs.flat().find(p => !Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1]));
check("无非法点", !badPt, badPt ? JSON.stringify(badPt) : "");
check("分段生效(≥2 段：海南→上海航段等已断开)", fp.runs.length >= 2, fp.runs.length + " 段");
// 关键：任何段内不允许出现 >200km 的相邻点 → 收尾画面不可能再有"飞机直线"
let maxLeg = 0, legAt = "";
fp.runs.forEach((r, q) => { for (let i = 1; i < r.length; i++){ const d = havM(r[i-1], r[i]); if (d > maxLeg){ maxLeg = d; legAt = "段" + q; } } });
check("段内最大相邻点距 ≤200km(无直线硬连)", maxLeg <= 200000, (maxLeg/1000).toFixed(0) + "km @" + legAt);
// 段间确实是真空隙（>200km），没有误切
let minGap = Infinity;
for (let q = 1; q < fp.runs.length; q++) minGap = Math.min(minGap, havM(fp.runs[q-1][fp.runs[q-1].length-1], fp.runs[q][0]));
check("段间空隙均 >200km(没误切骑行段)", minGap > 200000, "最小段间空隙 " + (minGap/1000).toFixed(0) + "km");
const first = fp.runs[0][0], last = fp.runs[fp.runs.length-1].slice(-1)[0];
const ends = "起 " + first.map(v => v.toFixed(2)) + " → 终 " + last.map(v => v.toFixed(2));
check("起点在丹东附近/终点在沈阳附近", Math.abs(first[0] - 124.4) < 1 && Math.abs(last[0] - 123.4) < 1, ends);

// ③ 照片聚类
const cl = vm.runInContext(`buildPhotoClusters(${fit.zoom})`, sandbox);
const total = cl.reduce((s, c) => s + c.members.length, 0);
const mx = (lng, z) => vm.runInContext(`mercX(${lng},${z})`, sandbox);
const my = (lat, z) => vm.runInContext(`mercY(${lat},${z})`, sandbox);
let minPx = 1e9;
for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++)
  minPx = Math.min(minPx, Math.hypot(mx(cl[i].center[0], fit.zoom) - mx(cl[j].center[0], fit.zoom), my(cl[i].center[1], fit.zoom) - my(cl[j].center[1], fit.zoom)));
check("簇数 8~20", cl.length >= 8 && cl.length <= 20, cl.length + " 簇，大小: " + cl.map(c => c.members.length).join(","));
check("照片总数守恒(=带GPS数=370)", total === 370, "聚类后合计 " + total);
// 北境红圈区域(lng>118,lat>43)必须有卡片 —— 用户验收的核心诉求
const northCards = cl.filter(c => c.center[0] > 118 && c.center[1] > 43);
check("北境区域有照片卡片(用户诉求)", northCards.length >= 1, northCards.length + " 张卡片，覆盖 " + northCards.reduce((s,c)=>s+c.members.length,0) + " 照片");
check("卡片最小间距 ≥ 70px", minPx >= 70, minPx.toFixed(0) + "px");
const ordSorted = cl.every((c, i) => i === 0 || cl[i - 1].ord <= c.ord);
check("弹出顺序=旅程顺序(ord 升序)", ordSorted);
const badImg = cl.find(c => !c.members[0].file);
check("每簇封面文件存在字段", !badImg);

// ④ 运镜插值光滑性：easeInOutCubic 端点与单调
const e0 = vm.runInContext("easeInOutCubic(0)", sandbox), e1 = vm.runInContext("easeInOutCubic(1)", sandbox);
let mono = true, prev = 0;
for (let t = 0; t <= 1.0001; t += .01){ const v = vm.runInContext(`easeInOutCubic(${t})`, sandbox); if (v < prev - 1e-9) mono = false; prev = v; }
check("缓动端点 0→1 且单调", Math.abs(e0) < 1e-9 && Math.abs(e1 - 1) < 1e-9 && mono);

console.log(fail ? `\n${fail} 项未通过` : "\n全部通过 🎉");
process.exit(fail ? 1 : 0);
