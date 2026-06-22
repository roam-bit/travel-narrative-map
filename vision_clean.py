#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全量视觉清洗成品文件夹：doubao 视觉模型三分类(旅游/无关/存疑)，无关→_已剔除，存疑→_存疑待定。
断点续：每批写 vision_labels.json，被中断后重跑跳过已分类的。"""
import base64, subprocess, json, urllib.request, server, os, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path.home()/"Desktop"/"环华摩旅_照片成品"
HERE = Path(__file__).resolve().parent
LABELS = HERE/"vision_labels.json"
TRASH = Path.home()/"Desktop"/"旅行照片_已剔除"/"视觉剔除"
DOUBT = Path.home()/"Desktop"/"_存疑待定"
PROMPT = '看这张照片内容判断类别。只回JSON：{"类":"旅游"或"无关"或"存疑","物":"6字内"}。无关=报告/病历/证件/票据/收据/截图/二维码/聊天记录/纯杂物等明确与旅行无关；存疑=展板/特产/纪念品/招牌等可能有关；其余风景/人物/美食/动物/街景/车辆=旅游。'

photos = [p for ch in sorted(ROOT.iterdir()) if ch.is_dir()
          for p in sorted(ch.iterdir()) if p.suffix.lower() in ('.heic','.jpg','.jpeg','.png')]
labels = json.loads(LABELS.read_text()) if LABELS.exists() else {}
todo = [p for p in photos if str(p) not in labels]
print(f"共 {len(photos)} 张，已分类 {len(labels)}，待分类 {len(todo)}")

def classify(p, tries=3):
    for k in range(tries):
        tmp = tempfile.mktemp(suffix=".jpg")
        try:
            subprocess.run(["sips","-s","format","jpeg","-Z","1024",str(p),"--out",tmp], capture_output=True)
            b64 = base64.b64encode(open(tmp,"rb").read()).decode()
            payload = {"model": server.ARK_MODEL, "input":[{"role":"user","content":[
                {"type":"input_text","text":PROMPT},
                {"type":"input_image","image_url":"data:image/jpeg;base64,"+b64}]}], "max_output_tokens":2000}
            req = urllib.request.Request(server.ARK_API_URL, data=json.dumps(payload).encode(),
                headers={"Authorization":f"Bearer {server.ARK_API_KEY}","Content-Type":"application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=120) as r:
                d = server.parse_json_object(server.extract_response_text(json.loads(r.read().decode())))
            return str(p), {"类": d.get("类","存疑"), "物": d.get("物","")}
        except Exception as e:
            if k == tries-1: return str(p), {"类":"存疑","物":"识别失败:"+str(e)[:20]}
            time.sleep(3*(k+1))
        finally:
            if os.path.exists(tmp): os.remove(tmp)

# 分批分类，每批写盘（断点续）
B = 40
for i in range(0, len(todo), B):
    batch = todo[i:i+B]
    for path, info in ThreadPoolExecutor(max_workers=4).map(classify, batch):
        labels[path] = info
    LABELS.write_text(json.dumps(labels, ensure_ascii=False))
    done = sum(1 for p in photos if str(p) in labels)
    print(f"[{time.strftime('%H:%M:%S')}] 进度 {done}/{len(photos)}")

# 全部分类完 → 移动
TRASH.mkdir(parents=True, exist_ok=True); DOUBT.mkdir(parents=True, exist_ok=True)
mv_junk = mv_doubt = 0
for path, info in labels.items():
    if not os.path.exists(path): continue
    cls = info.get("类")
    if cls == "无关":
        dst = TRASH/os.path.basename(path)
        if not dst.exists(): __import__("shutil").move(path, str(dst)); mv_junk += 1
    elif cls == "存疑":
        dst = DOUBT/os.path.basename(path)
        if not dst.exists(): __import__("shutil").move(path, str(dst)); mv_doubt += 1

trav = sum(1 for v in labels.values() if v.get("类")=="旅游")
print(f"\n✅ 完成：旅游 {trav} 留 | 无关 {mv_junk} → _已剔除/视觉剔除 | 存疑 {mv_doubt} → _存疑待定")
print("分类明细见 vision_labels.json")
