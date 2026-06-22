// 方案A·步骤1：从「照片」App 导出终章时段(2025-10-13~11-14)的照片原件（iCloud 自动拉取）。
// 只导真照片（HEIC/JPG/JPEG/DNG/TIFF），排除 PNG 截图和视频。分批导出，单批失败不中断。
// 用法：node tools/export_north_photos.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = path.join(os.homedir(), "Desktop", "北境照片导出");
mkdirSync(OUT, { recursive: true });
const BATCH = 25;

const QUERY = `
with timeout of 900 seconds
  tell application "Photos"
    set d1 to current date
    set year of d1 to 2025
    set month of d1 to October
    set day of d1 to 13
    set time of d1 to 0
    set d2 to current date
    set year of d2 to 2025
    set month of d2 to November
    set day of d2 to 14
    set time of d2 to 86399
    set ids to id of (every media item whose date of it ≥ d1 and date of it ≤ d2)
    set fns to filename of (every media item whose date of it ≥ d1 and date of it ≤ d2)
    set AppleScript's text item delimiters to linefeed
    return (ids as text) & "\\n=====SPLIT=====\\n" & (fns as text)
  end tell
end timeout`;

console.log("① 查询照片清单…");
const raw = execFileSync("osascript", ["-e", QUERY], { encoding: "utf8", timeout: 900000 });
const [idPart, fnPart] = raw.split(/=====SPLIT=====/);
const ids = idPart.trim().split("\n").map(s => s.trim()).filter(Boolean);
const fns = fnPart.trim().split("\n").map(s => s.trim()).filter(Boolean);
if (ids.length !== fns.length) { console.error("id/文件名数量不配对", ids.length, fns.length); process.exit(1); }

const PHOTO_EXT = /\.(heic|heif|jpg|jpeg|dng|tif|tiff)$/i;
const picks = ids.map((id, i) => ({ id, fn: fns[i] })).filter(x => PHOTO_EXT.test(x.fn));
console.log(`清单 ${ids.length} 项 → 照片 ${picks.length} 张（已排除 PNG 截图/视频）`);
writeFileSync(path.join(OUT, "_清单.json"), JSON.stringify(picks, null, 1));

const batches = [];
for (let i = 0; i < picks.length; i += BATCH) batches.push(picks.slice(i, i + BATCH));

let okBatches = 0, failBatches = 0;
for (let b = 0; b < batches.length; b++) {
  const items = batches[b].map(x => `media item id "${x.id}"`).join(", ");
  const script = `
with timeout of 1200 seconds
  tell application "Photos"
    set outDir to POSIX file "${OUT}" as alias
    export {${items}} to outDir with using originals
  end tell
end timeout`;
  const before = readdirSync(OUT).length;
  try {
    execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 1200000 });
    const after = readdirSync(OUT).length;
    okBatches++;
    console.log(`② 批 ${b + 1}/${batches.length} 完成（目录新增 ${after - before} 个文件，累计 ${after}）`);
  } catch (e) {
    failBatches++;
    console.log(`② 批 ${b + 1}/${batches.length} 失败：${String(e.message).slice(0, 120)}（继续下一批）`);
  }
}
const files = readdirSync(OUT).filter(f => PHOTO_EXT.test(f));
console.log(`③ 导出结束：成功批 ${okBatches}/${batches.length}，目录共 ${files.length} 张照片 → ${OUT}`);
