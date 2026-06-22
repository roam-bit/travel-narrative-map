// 给 web_photos.json 里所有照片生成 200px 缩略图 → photos_web/_thumbs/<原相对路径>
// 用途：收尾照片卡片封面（64px 显示）不再加载 1280px 大图（~320KB→~12KB）；lightbox 大图仍用原图。
// 幂等：已存在且比原图新的缩略图跳过。用法：node tools/build_thumbs.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = JSON.parse(readFileSync(path.join(ROOT, "web_photos.json"), "utf8"));

let made = 0, skipped = 0, failed = 0;
for (const grp of Object.values(web)) {
  for (const p of grp.photos || []) {
    const src = path.join(ROOT, p.file);                                   // photos_web/章/000.jpg
    const dst = path.join(ROOT, "photos_web", "_thumbs", path.relative("photos_web", p.file));
    if (!existsSync(src)) { failed++; continue; }
    if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs) { skipped++; continue; }
    mkdirSync(path.dirname(dst), { recursive: true });
    try {
      execFileSync("sips", ["-s", "format", "jpeg", "-Z", "200", src, "--out", dst], { stdio: "pipe" });
      made++;
    } catch (e) { failed++; }
  }
}
console.log(`缩略图：新生成 ${made}，跳过(已最新) ${skipped}，失败 ${failed}`);
