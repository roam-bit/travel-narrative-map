#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 iCloud 导出的全量实拍照片/视频，按 8 章重新整理到一个干净的成品文件夹（按时间命名，便于浏览）。"""
import json, subprocess, os, shutil, datetime, math, re
from pathlib import Path

SRC = str(Path.home() / "Desktop" / "旅行照片_原图导出")   # 你的原图导出目录（自行替换）
OUT = Path.home()/"Desktop"/"环华摩旅_照片成品"
HERE = Path(__file__).resolve().parent
TZ = datetime.timezone(datetime.timedelta(hours=8))
defs = json.loads((HERE/"chapters_def.json").read_text(encoding="utf-8"))
built = json.loads((HERE/"chapters_built.json").read_text(encoding="utf-8"))["chapters"]

_a=6378245.0;_ee=0.00669342162296594323
def _o(lng,lat):return not(73.66<lng<135.05 and 3.86<lat<53.55)
def _tl(x,y):
    r=-100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*math.sqrt(abs(x));r+=(20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3;r+=(20*math.sin(y*math.pi)+40*math.sin(y/3*math.pi))*2/3;r+=(160*math.sin(y/12*math.pi)+320*math.sin(y*math.pi/30))*2/3;return r
def _tg(x,y):
    r=300+x+2*y+0.1*x*x+0.1*x*y+0.1*math.sqrt(abs(x));r+=(20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3;r+=(20*math.sin(x*math.pi)+40*math.sin(x/3*math.pi))*2/3;r+=(150*math.sin(x/12*math.pi)+300*math.sin(x/30*math.pi))*2/3;return r
def w2g(lng,lat):
    if _o(lng,lat):return lng,lat
    dlat=_tl(lng-105,lat-35);dlng=_tg(lng-105,lat-35);rl=lat/180*math.pi;m=math.sin(rl);m=1-_ee*m*m;sm=math.sqrt(m)
    return lng+(dlng*180)/(_a/sm*math.cos(rl)*math.pi), lat+(dlat*180)/((_a*(1-_ee))/(m*sm)*math.pi)

order=[c["name"] for c in defs]
bounds={}
for c in defs:
    ds=datetime.datetime.strptime(c["dateStart"],"%Y-%m-%d").replace(tzinfo=TZ)
    de=datetime.datetime.strptime(c["dateEnd"],"%Y-%m-%d").replace(tzinfo=TZ)+datetime.timedelta(days=1)
    bounds[c["name"]]=(ds,de)
geo=[]
for c in built:
    for seg in c.get("segments",[]):
        for lng,lat in seg: geo.append((lng,lat,c["name"]))
def ptime(r):
    s=r.get("DateTimeOriginal") or r.get("CreateDate")
    if not s or not isinstance(s,str):return None
    try:return datetime.datetime.strptime(s.strip()[:19],"%Y:%m:%d %H:%M:%S").replace(tzinfo=TZ)
    except:return None
def by_time(t):
    for n,(ds,de) in bounds.items():
        if ds<=t<de:return n
    return None
def by_gps(lng,lat):
    g=w2g(lng,lat);best=None;bd=1e9
    for x,y,n in geo:
        d=(x-g[0])**2+(y-g[1])**2
        if d<bd:bd=d;best=n
    return best if bd<4 else None
def is_vid(r):return str(r.get("MIMEType","")).startswith("video") or str(r.get("FileType","")).upper() in("MOV","MP4")

print("① 扫描导出目录的实拍…")
out=subprocess.run(["exiftool","-j","-n","-r","-Make","-GPSLatitude","-GPSLongitude","-DateTimeOriginal","-CreateDate","-FileType","-MIMEType",SRC],capture_output=True,text=True)
exif=json.loads(out.stdout)
seen={}
for r in exif:
    bn=os.path.basename(r["SourceFile"])
    if bn not in seen and not bn.lower().endswith(".aae"):
        seen[bn]=r
records=[r for r in seen.values() if r.get("Make") or r.get("GPSLatitude") is not None]  # 只要实拍
print(f"   实拍 {len(records)} 个")

# 归章
buckets={n:[] for n in order}; skipped=0
for r in records:
    t=ptime(r);glng=r.get("GPSLongitude");glat=r.get("GPSLatitude")
    ch=None
    if t and datetime.datetime(2025,3,12,tzinfo=TZ)<=t<datetime.datetime(2025,11,15,tzinfo=TZ):ch=by_time(t)
    elif glng is not None:ch=by_gps(glng,glat)
    if not ch:skipped+=1;continue
    buckets[ch].append((t,r))

# 复制到成品文件夹
print("② 按章复制（按时间命名）…")
if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir(parents=True)
for idx,n in enumerate(order):
    items=buckets[n]
    if not items: continue
    items.sort(key=lambda x:(x[0] or datetime.datetime(2025,1,1,tzinfo=TZ)))
    safe=re.sub(r'[ ·，]','',n)
    folder=OUT/f"{idx:02d}_{safe}"; folder.mkdir(parents=True,exist_ok=True)
    for i,(t,r) in enumerate(items):
        src=r["SourceFile"]
        if not os.path.exists(src): continue
        ext=Path(src).suffix.lower()
        tag=t.strftime("%m%d_%H%M") if t else "noTime"
        kind="vid" if is_vid(r) else "pic"
        shutil.copy2(src, folder/f"{kind}_{tag}_{i:03d}{ext}")

print(f"\n✅ 成品文件夹：{OUT}")
print(f"{'章节':18s}{'照片':>5}{'视频':>5}")
gp=gv=0
for idx,n in enumerate(order):
    items=buckets[n]
    if not items: continue
    p=sum(1 for _,r in items if not is_vid(r));v=sum(1 for _,r in items if is_vid(r));gp+=p;gv+=v
    print(f"  {idx:02d}_{n:14s}{p:5d}{v:5d}")
print(f"\n合计 {gp} 照片 + {gv} 视频；未能归章(无时间无定位){skipped}")
print(f"总大小：{subprocess.run(['du','-sh',str(OUT)],capture_output=True,text=True).stdout.split()[0]}")
