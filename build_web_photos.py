#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读 photos_assign.json，每章按时间均匀采样照片转 JPG，生成 web_photos.json 供作品展示。"""
import json, subprocess, shutil, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
assign = json.loads((HERE/"photos_assign.json").read_text(encoding="utf-8"))
WEB = HERE/"photos_web"
if WEB.exists(): shutil.rmtree(WEB)
WEB.mkdir()
PER = 50  # 每章最多展示张数（均匀采样，避免一章几百张）

out = {}; total = 0
for ch, a in assign.items():
    if "间章" in ch: continue
    photos = sorted(a["photo"], key=lambda x: x["t"])
    if len(photos) > PER:
        idx = sorted(set(round(i*(len(photos)-1)/(PER-1)) for i in range(PER)))
        photos = [photos[i] for i in idx]
    if not photos and not a["video"]: continue
    safe = re.sub(r'[ ·，]','',ch)
    folder = WEB/safe; folder.mkdir(parents=True, exist_ok=True)
    lst = []
    for i, p in enumerate(photos):
        dst = folder/f"{i:03d}.jpg"
        subprocess.run(["sips","-s","format","jpeg","-Z","1280",p["src"],"--out",str(dst)], capture_output=True)
        if dst.exists():
            lst.append({"file":f"photos_web/{safe}/{i:03d}.jpg","t":p["t"],"gps":p["gps"]})
            total += 1
    out[ch] = {"photos": lst, "videoCount": len(a["video"]), "photoTotal": len(a["photo"])}

json.dump(out, open(HERE/"web_photos.json","w"), ensure_ascii=False, indent=1)
print(f"✅ 转换 {total} 张 web 照片")
print(f"web 资源大小：{subprocess.run(['du','-sh',str(WEB)],capture_output=True,text=True).stdout.split()[0]}")
for ch, d in out.items():
    print(f"  {ch:16s} 展示{len(d['photos']):2d}/{d['photoTotal']:3d}张 · {d['videoCount']}视频")
