#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清洗分析：按「有无拍摄设备(Make)/GPS」区分实拍 vs 截图网图。只分析报告+写清单，不移动文件。"""
import json, subprocess, os
from pathlib import Path

DEST = str(Path.home() / "Desktop" / "旅行照片_原图导出")   # 你的原图导出目录（自行替换）
HERE = Path(__file__).resolve().parent

print("exiftool 扫描设备/GPS 信息…")
out = subprocess.run(["exiftool","-j","-n","-r","-Make","-Model","-GPSLatitude",
                      "-DateTimeOriginal","-CreateDate","-FileType","-MIMEType","-ImageWidth","-ImageHeight",
                      DEST], capture_output=True, text=True)
exif = json.loads(out.stdout)
# 去重 basename（保留第一个出现的路径）
seen = {}
for r in exif:
    bn = os.path.basename(r["SourceFile"])
    if bn not in seen: seen[bn] = r
records = list(seen.values())

keep, junk = [], []
for r in records:
    has_make = bool(r.get("Make"))
    has_gps = r.get("GPSLatitude") is not None
    if has_make or has_gps:
        keep.append(r)
    else:
        junk.append(r)

def is_vid(r): return str(r.get("MIMEType","")).startswith("video") or str(r.get("FileType","")).upper() in ("MOV","MP4")

kp = sum(1 for r in keep if not is_vid(r)); kv = sum(1 for r in keep if is_vid(r))
jp = sum(1 for r in junk if not is_vid(r)); jv = sum(1 for r in junk if is_vid(r))

print(f"\n总 {len(records)} 个文件（去重后）")
print(f"  ✅ 留（实拍·有设备或GPS）：{len(keep)}  = 照片{kp} + 视频{kv}")
print(f"  🗑️  剔除（无设备无GPS·截图网图）：{len(junk)} = 照片{jp} + 视频{jv}")

print("\n--- 「剔除」样本（看判断准不准）---")
for r in junk[:12]:
    fn = os.path.basename(r["SourceFile"]); ft = r.get("FileType",""); w = r.get("ImageWidth",""); h = r.get("ImageHeight","")
    print(f"  {fn:22s} {ft:5s} {w}x{h}  Make={r.get('Make') or '无'}")

print("\n--- 「留」样本（确认真照片没被误剔）---")
for r in keep[:8]:
    fn = os.path.basename(r["SourceFile"]); mk = r.get("Make") or ""; gps = "有GPS" if r.get("GPSLatitude") is not None else ""
    print(f"  {fn:22s} {r.get('FileType',''):5s} Make={mk} {gps}")

# 写剔除清单（供确认后移动）
json.dump([r["SourceFile"] for r in junk], open(HERE/"junk_list.json","w"), ensure_ascii=False)
print(f"\n剔除清单已写入 junk_list.json（{len(junk)} 个），等你确认后我移到 _已剔除/")
