#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""清洗+重建：把截图/网图移到_已剔除(可恢复)，用纯实拍重新归类+转JPG落作品。"""
import json, subprocess, os, shutil, datetime, math, re
from pathlib import Path

DEST = str(Path.home() / "Desktop" / "旅行照片_原图导出")   # 你的原图导出目录（自行替换）
HERE = Path(__file__).resolve().parent
TRASH = Path.home()/"Desktop"/"旅行照片_已剔除"
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

# 1. 扫描
print("① 扫描…")
out=subprocess.run(["exiftool","-j","-n","-r","-Make","-GPSLatitude","-GPSLongitude","-DateTimeOriginal","-CreateDate","-FileType","-MIMEType",DEST],capture_output=True,text=True)
exif=json.loads(out.stdout)
seen={}
for r in exif:
    bn=os.path.basename(r["SourceFile"])
    if bn not in seen:seen[bn]=r
records=list(seen.values())

# 2. 分类 + 移 junk 到 _已剔除
print("② 移除截图/网图到 _已剔除…")
TRASH.mkdir(exist_ok=True)
keep=[];moved=0
for r in records:
    if r.get("Make") or r.get("GPSLatitude") is not None:
        keep.append(r)
    else:
        src=r["SourceFile"]
        if os.path.exists(src):
            dst=TRASH/os.path.basename(src)
            if not dst.exists():
                try:shutil.move(src,str(dst));moved+=1
                except Exception:pass
print(f"   移除 {moved} 个；保留实拍 {len(keep)} 个")

# 3. 归类 keep
def is_vid(r):return str(r.get("MIMEType","")).startswith("video") or str(r.get("FileType","")).upper() in("MOV","MP4")
assign={n:{"photo":[],"video":[]} for n in order}
for r in keep:
    t=ptime(r);glat=r.get("GPSLatitude");glng=r.get("GPSLongitude")
    ch=None
    if t and datetime.datetime(2025,3,12,tzinfo=TZ)<=t<datetime.datetime(2025,11,15,tzinfo=TZ):ch=by_time(t)
    elif glng is not None:ch=by_gps(glng,glat)
    if not ch:continue
    rec={"src":r["SourceFile"],"t":t.strftime("%Y%m%d_%H%M") if t else "z","gps":[glng,glat] if glng is not None else None}
    assign[ch]["video" if is_vid(r) else "photo"].append(rec)

# 4. 转 JPG（每章采样50）
print("③ 转 JPG 落作品…")
WEB=HERE/"photos_web"
if WEB.exists():shutil.rmtree(WEB)
WEB.mkdir()
PER=50;web={};total=0
for ch in order:
    if "间章" in ch:continue
    a=assign[ch];photos=sorted(a["photo"],key=lambda x:x["t"])
    if len(photos)>PER:
        idx=sorted(set(round(i*(len(photos)-1)/(PER-1)) for i in range(PER)));photos=[photos[i] for i in idx]
    if not photos and not a["video"]:continue
    safe=re.sub(r'[ ·，]','',ch);folder=WEB/safe;folder.mkdir(parents=True,exist_ok=True)
    lst=[]
    for i,p in enumerate(photos):
        dst=folder/f"{i:03d}.jpg"
        subprocess.run(["sips","-s","format","jpeg","-Z","1280",p["src"],"--out",str(dst)],capture_output=True)
        if dst.exists():lst.append({"file":f"photos_web/{safe}/{i:03d}.jpg","t":p["t"],"gps":p["gps"]});total+=1
    web[ch]={"photos":lst,"videoCount":len(a["video"]),"photoTotal":len(a["photo"])}
json.dump(web,open(HERE/"web_photos.json","w"),ensure_ascii=False,indent=1)

print(f"\n✅ 完成：移除 {moved} 截图/网图 → _已剔除（可恢复）；作品用 {total} 张纯实拍")
print(f"{'章节':16s}{'实拍照片':>8}{'视频':>5}")
for ch in order:
    if "间章" in ch:continue
    a=assign[ch];p=len(a["photo"]);v=len(a["video"])
    if p or v:print(f"  {ch:16s}{p:8d}{v:5d}")
