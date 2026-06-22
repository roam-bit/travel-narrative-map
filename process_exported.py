#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""处理 iCloud 导出目录：扫 EXIF → 去重 → 按时间+GPS 归类到 8 章 → 统计 + 生成 assign.json"""
import json, subprocess, datetime, math, os
from pathlib import Path

DEST = str(Path.home() / "Desktop" / "旅行照片_原图导出")   # 你的原图导出目录（自行替换）
HERE = Path(__file__).resolve().parent
TZ = datetime.timezone(datetime.timedelta(hours=8))
defs = json.loads((HERE/"chapters_def.json").read_text(encoding="utf-8"))
built = json.loads((HERE/"chapters_built.json").read_text(encoding="utf-8"))["chapters"]

# WGS84->GCJ02
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

print("exiftool 扫描导出目录…")
out=subprocess.run(["exiftool","-j","-n","-r","-DateTimeOriginal","-CreateDate","-GPSLatitude","-GPSLongitude","-FileType","-MIMEType",DEST],capture_output=True,text=True)
exif=json.loads(out.stdout)
# 去重 by basename
seen={}
for r in exif:
    bn=os.path.basename(r["SourceFile"])
    if bn not in seen: seen[bn]=r
exif=list(seen.values())
print(f"去重后 {len(exif)} 个文件\n")

trip_lo=datetime.datetime(2025,3,12,tzinfo=TZ);trip_hi=datetime.datetime(2025,11,15,tzinfo=TZ)
assign={n:{"photo":[],"video":[]} for n in order}
unassigned=0
for r in exif:
    t=ptime(r);glat=r.get("GPSLatitude");glng=r.get("GPSLongitude")
    ch=None;method=None
    if t and trip_lo<=t<trip_hi:ch=by_time(t);method="time"
    elif glat is not None and glng is not None:ch=by_gps(glng,glat);method="gps"
    if not ch:unassigned+=1;continue
    isvid=str(r.get("MIMEType","")).startswith("video") or str(r.get("FileType","")).upper() in("MOV","MP4")
    rec={"src":r["SourceFile"],"t":t.strftime("%Y%m%d_%H%M") if t else "noTime","method":method,"gps":[glng,glat] if glng is not None else None}
    assign[ch]["video" if isvid else "photo"].append(rec)

json.dump(assign,open(HERE/"photos_assign.json","w"),ensure_ascii=False,default=str)
print(f"{'章节':16s}{'照片':>5}{'视频':>5}{'有GPS':>6}  说明")
print("-"*54)
for n in order:
    a=assign[n];p=len(a["photo"]);v=len(a["video"]);g=sum(1 for x in a["photo"]+a["video"] if x["gps"])
    note="(转场)" if "间章" in n else ("⚠️ 仍缺" if p+v<5 else "✅")
    print(f"{n:16s}{p:5d}{v:5d}{g:6d}  {note}")
tp=sum(len(assign[n]['photo']) for n in order);tv=sum(len(assign[n]['video']) for n in order)
print(f"\n已归类 {tp} 照片 + {tv} 视频；未能归类(截图/无定位) {unassigned}")
