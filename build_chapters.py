#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
轨迹切分器：按章节定义把灵敢足迹 CSV 切成多篇章。
每章输出：去噪+抽稀轨迹分段(GCJ02) + 统计(点数/天数/里程/海拔/边界) + 代表点 + 里程碑(GCJ02)。

用法：
  1. chapters_def.json 写章节定义（每项 {name,dateStart,dateEnd,region,theme,emotion,[transition],[milestone]}）
  2. python3 build_chapters.py
  3. 产出 chapters_built.json
"""
import csv, json, math, datetime
from datetime import timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
CSV = str(Path.home() / "Downloads" / "track.csv")   # 你的轨迹 CSV 路径（自行替换）
TZ = datetime.timezone(datetime.timedelta(hours=8))
GAP_MS = 30 * 60 * 1000          # 分段：相邻点间隔 >30min 断开
TARGET_PTS_PER_CH = 1200         # 每章抽稀目标点数（控制前端渲染量）
REP_POINTS = 8                   # 每章代表点数量
MAX_SPEED_KMH = 200              # 瞬时速度 >200km/h 视为 GPS 漂移噪点，剔除

# ---- WGS84 -> GCJ02 ----
_a = 6378245.0; _ee = 0.00669342162296594323
def _out(lng, lat): return not (73.66 < lng < 135.05 and 3.86 < lat < 53.55)
def _tlat(x, y):
    r = -100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*math.sqrt(abs(x))
    r += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
    r += (20*math.sin(y*math.pi)+40*math.sin(y/3*math.pi))*2/3
    r += (160*math.sin(y/12*math.pi)+320*math.sin(y*math.pi/30))*2/3
    return r
def _tlng(x, y):
    r = 300+x+2*y+0.1*x*x+0.1*x*y+0.1*math.sqrt(abs(x))
    r += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
    r += (20*math.sin(x*math.pi)+40*math.sin(x/3*math.pi))*2/3
    r += (150*math.sin(x/12*math.pi)+300*math.sin(x/30*math.pi))*2/3
    return r
def wgs2gcj(lng, lat):
    if _out(lng, lat): return [round(lng, 6), round(lat, 6)]
    dlat = _tlat(lng-105, lat-35); dlng = _tlng(lng-105, lat-35)
    rl = lat/180*math.pi; m = math.sin(rl); m = 1-_ee*m*m; sm = math.sqrt(m)
    dlat = (dlat*180)/((_a*(1-_ee))/(m*sm)*math.pi)
    dlng = (dlng*180)/(_a/sm*math.cos(rl)*math.pi)
    return [round(lng+dlng, 6), round(lat+dlat, 6)]

def haversine(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2-lat1); dl = math.radians(lng2-lng1)
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

def denoise(sel):
    """剔除瞬时速度 >200km/h 的 GPS 漂移点（如海南章 7/02 往返福建的伪迹）。"""
    if len(sel) < 3:
        return sel, 0
    out = [sel[0]]; dropped = 0
    for i in range(1, len(sel)):
        g, la, ln, al, sp = sel[i]
        pg, pla, pln = out[-1][0], out[-1][1], out[-1][2]
        dt_h = (g - pg) / 1000 / 3600
        if dt_h <= 0:
            continue
        d = haversine(pla, pln, la, ln)
        if d / dt_h > MAX_SPEED_KMH:   # 漂移，跳过
            dropped += 1
            continue
        out.append(sel[i])
    return out, dropped

def ms(date_str, end=False):
    d = datetime.datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=TZ)
    if end: d += timedelta(days=1)
    return int(d.timestamp()*1000)

def load_points():
    pts = []
    with open(CSV, encoding="utf-8") as fp:
        for row in csv.DictReader(fp):
            try:
                pts.append((int(row["geoTime"]), float(row["latitude"]), float(row["longitude"]),
                            float(row["altitude"] or 0), float(row["speed"] or 0)))
            except (ValueError, KeyError):
                continue
    pts.sort()
    return pts

def conv_milestones(c):
    out = []
    for m in (c.get("milestone") or []):
        lng, lat = wgs2gcj(m["lng"], m["lat"])
        out.append({"label": m["label"], "lng": lng, "lat": lat})
    return out

def build_chapter(pts, c):
    lo, hi = ms(c["dateStart"]), ms(c["dateEnd"], end=True)
    sel = [p for p in pts if lo <= p[0] < hi]
    base = {"name": c["name"], "dateStart": c["dateStart"], "dateEnd": c["dateEnd"],
            "region": c.get("region", ""), "theme": c.get("theme", ""), "emotion": c.get("emotion", ""),
            "transition": bool(c.get("transition")), "milestones": conv_milestones(c)}
    if not sel:
        return {**base, "empty": True}
    sel, dropped = denoise(sel)
    # 真实里程（原始点，分段内累加）
    dist = 0.0
    for i in range(1, len(sel)):
        if sel[i][0]-sel[i-1][0] <= GAP_MS:
            dist += haversine(sel[i-1][1], sel[i-1][2], sel[i][1], sel[i][2])
    # 分段
    segs = []; cur = [sel[0]]
    for p in sel[1:]:
        if p[0]-cur[-1][0] > GAP_MS: segs.append(cur); cur = [p]
        else: cur.append(p)
    segs.append(cur)
    # 抽稀
    step = max(1, len(sel)//TARGET_PTS_PER_CH)
    gcj_segs = []
    for seg in segs:
        if len(seg) < 2: continue
        keep = seg[::step]
        if keep[-1] != seg[-1]: keep.append(seg[-1])
        gcj_segs.append([wgs2gcj(p[2], p[1]) for p in keep])
    # 代表点：按时间均匀取 REP_POINTS 个（GCJ）
    reps = []; n = len(sel)
    for k in range(REP_POINTS):
        p = sel[min(n-1, n*k//REP_POINTS)]
        lng, lat = wgs2gcj(p[2], p[1])
        reps.append({"lng": lng, "lat": lat, "alt": round(p[3]),
                     "t": datetime.datetime.fromtimestamp(p[0]/1000, TZ).strftime("%Y-%m-%d %H:%M")})
    lats = [p[1] for p in sel]; lngs = [p[2] for p in sel]; alts = [p[3] for p in sel]
    days = len(set(datetime.datetime.fromtimestamp(p[0]/1000, TZ).date() for p in sel))
    return {
        **base,
        "stats": {"points": len(sel), "days": days, "distanceKm": round(dist), "droppedNoise": dropped,
                  "altMin": round(min(alts)), "altMax": round(max(alts)),
                  "latMin": round(min(lats), 4), "latMax": round(max(lats), 4),
                  "lngMin": round(min(lngs), 4), "lngMax": round(max(lngs), 4)},
        "repPoints": reps,
        "segments": gcj_segs,
    }

def main():
    defs = json.loads((HERE / "chapters_def.json").read_text(encoding="utf-8"))
    pts = load_points()
    out = [build_chapter(pts, c) for c in defs]
    (HERE / "chapters_built.json").write_text(json.dumps({"chapters": out}, ensure_ascii=False), encoding="utf-8")
    total_km = sum(c.get("stats", {}).get("distanceKm", 0) for c in out if not c.get("transition"))
    print(f"✅ 切了 {len(out)} 块（含转场），骑行总里程约 {total_km} km\n")
    for c in out:
        s = c.get("stats"); tag = "🏠转场" if c.get("transition") else "    "
        if s:
            mil = f" 🚩{len(c['milestones'])}个端点" if c.get("milestones") else ""
            print(f"  {tag} {c['name']:16s} {c['dateStart']}~{c['dateEnd']}  {s['points']:5d}点 {s['days']:2d}天 {s['distanceKm']:5d}km 海拔{s['altMin']}~{s['altMax']}m 去噪{s['droppedNoise']}{mil}")
        else:
            print(f"  {tag} {c['name']:16s} ⚠️ 无数据")

if __name__ == "__main__":
    main()
