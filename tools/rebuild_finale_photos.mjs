// 方案A·步骤2：用导出的北境照片重建 web_photos.json 终章数据（替换 5 张误分的出发前照片）。
// 流程：exiftool 扫描 → 过滤(带GPS+终章日期) → 按时间排序+均匀采样50张 → sips 转 1280px jpg → 更新 web_photos.json。
// 只动终章，其他章不碰。改前自动备份 web_photos.json。
// 用法：node tools/rebuild_finale_photos.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(os.homedir(), "Desktop", "北境照片导出");
const CH_NAME = "终章 · 冰封北境与归途";
const FOLDER = "终章冰封北境与归途";   // 与 build_web_photos.py 的 re.sub(r'[ ·，]','') 命名一致
const PER = 50;
const D_START = "20251013", D_END = "20251114";

// ① exiftool 扫描（-n 数值 GPS：东经北纬为正，与 web_photos 的 [lng,lat] 一致）
console.log("① exiftool 扫描导出目录…");
const exifRaw = execFileSync("exiftool", ["-json", "-n", "-DateTimeOriginal", "-GPSLatitude", "-GPSLongitude", "-r", SRC], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const exif = JSON.parse(exifRaw);
console.log("扫描", exif.length, "个文件");

const norm = t => String(t || "").replace(/[: ]/g, "");   // '2025:10:21 14:30:00' → '20251021143000'
let noGps = 0, outRange = 0;
const usable = exif.filter(p => {
  const d = norm(p.DateTimeOriginal).slice(0, 8);
  if (!(p.GPSLatitude != null && p.GPSLongitude != null)) { noGps++; return false; }
  if (!(d >= D_START && d <= D_END)) { outRange++; return false; }
  return true;
}).map(p => ({
  src: p.SourceFile,
  t: norm(p.DateTimeOriginal).slice(0, 8) + "_" + norm(p.DateTimeOriginal).slice(8, 12),
  gps: [p.GPSLongitude, p.GPSLatitude],
})).sort((a, b) => a.t < b.t ? -1 : 1);
console.log(`可用 ${usable.length} 张（无GPS跳过 ${noGps}，日期范围外 ${outRange}）`);
if (!usable.length) { console.error("❌ 没有可用照片，停止（不动现有数据）"); process.exit(1); }

// ② 均匀采样 ≤50 张（同 build_web_photos.py 逻辑）
let picks = usable;
if (picks.length > PER) {
  const idx = [...new Set(Array.from({ length: PER }, (_, i) => Math.round(i * (picks.length - 1) / (PER - 1))))];
  picks = idx.map(i => picks[i]);
}
console.log("② 采样", picks.length, "张");

// ③ 备份 + 重建 photos_web/终章 目录
const webJsonPath = path.join(ROOT, "web_photos.json");
const backupPath = path.join(ROOT, "web_photos.backup-20260610.json");
if (!existsSync(backupPath)) copyFileSync(webJsonPath, backupPath);
console.log("③ 已备份 web_photos.json →", path.basename(backupPath));
const destDir = path.join(ROOT, "photos_web", FOLDER);
rmSync(destDir, { recursive: true, force: true });   // 清掉 5 张误分的出发前照片
mkdirSync(destDir, { recursive: true });

const lst = [];
picks.forEach((p, i) => {
  const dst = path.join(destDir, String(i).padStart(3, "0") + ".jpg");
  try {
    execFileSync("sips", ["-s", "format", "jpeg", "-Z", "1280", p.src, "--out", dst], { stdio: "pipe" });
    if (existsSync(dst)) lst.push({ file: `photos_web/${FOLDER}/${String(i).padStart(3, "0")}.jpg`, t: p.t, gps: p.gps });
  } catch (e) { console.log("  转换失败跳过:", path.basename(p.src)); }
});
console.log("④ 转换完成", lst.length, "张 →", destDir);
if (!lst.length) { console.error("❌ 全部转换失败，恢复备份后停止"); copyFileSync(backupPath, webJsonPath); process.exit(1); }

// ⑤ 更新 web_photos.json（只动终章）
const web = JSON.parse(readFileSync(webJsonPath, "utf8"));
const old = web[CH_NAME] || {};
web[CH_NAME] = { photos: lst, videoCount: old.videoCount || 0, photoTotal: usable.length };
writeFileSync(webJsonPath, JSON.stringify(web, null, 1));
console.log(`⑤ web_photos.json 终章已更新：${old.photos ? old.photos.length : 0} 张(含5张误分) → ${lst.length} 张真·北境照片`);
console.log("   GPS 范围:", "lng", Math.min(...lst.map(p => p.gps[0])).toFixed(1), "~", Math.max(...lst.map(p => p.gps[0])).toFixed(1),
  "| lat", Math.min(...lst.map(p => p.gps[1])).toFixed(1), "~", Math.max(...lst.map(p => p.gps[1])).toFixed(1));
