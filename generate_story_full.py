#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为环中国摩旅 8 章 + 转场，用 seed2.0 mini 一次性生成整体标题/开场白/每章叙事。
把每章真实数据签名喂给模型，让文案落到真实细节。产出 story.json。"""
import json
from pathlib import Path
import server  # 复用已验证的 call_seed

HERE = Path(__file__).resolve().parent
built = json.loads((HERE / "chapters_built.json").read_text(encoding="utf-8"))["chapters"]

# 构造喂给模型的数据签名（不含 segments）
sig = []
for c in built:
    s = c.get("stats", {})
    sig.append({
        "name": c["name"], "region": c["region"], "theme": c["theme"], "emotion": c["emotion"],
        "dateRange": f"{c['dateStart']}~{c['dateEnd']}", "days": s.get("days"),
        "distanceKm": s.get("distanceKm"), "altMax": s.get("altMax"), "altMin": s.get("altMin"),
        "milestones": [m["label"] for m in c.get("milestones", [])],
        "transition": c.get("transition", False),
    })

TITLE_CANDIDATES = [
    "把整个中国，画成一条线", "从海到屋脊：222天，一个人的中国",
    "向南，向西，向上，回家", "一笔成环：辽东出发，辽东归来",
]

prompt = f"""你是顶级旅行纪录片的旁白撰稿人。下面是一位骑士环中国摩旅的真实数据：
2025年3月12日—11月14日，222天，骑行约35000公里，从辽宁出发逆时针绕中国一整圈，
触及最南(海南三亚北纬18.22°)、最高(阿里新藏线海拔5390.6米)、最西(喀什东经73.98°)、最北(漠河北纬53.56°)、最东(抚远东经134.72°)，最后回到辽宁，在地图上画出完整的中国轮廓。

请为这部交互式叙事作品创作：
1. title：总标题。可从候选里选最好的，或自拟更佳的（要有情绪和史诗感，不超过14字）。候选：{TITLE_CANDIDATES}
2. intro：30-50字开场白，定下整段旅程的情绪基调。
3. 每个章节的 story：结合该章的真实数据（里程、海拔、天数、端点），写60-110字有画面感、有温度、能带动情绪的旁白；情绪要贴合该章的 emotion；所有章节串起来要构成"出发的孤勇→江南的松弛→蓄力的沉默→登顶的狂喜→归乡的圆满"的完整弧线。
   特别注意：标记 transition=true 的"间章·回家换气"是回家休整的过场，只写一句20字以内的换气旁白即可，不要展开。

严格只返回 JSON，不要任何额外文字：
{{"title":"...","intro":"...","chapters":[{{"name":"章节名","story":"该章旁白"}}]}}
chapters 的顺序和数量必须与下面输入完全一致（共{len(sig)}章）。

各章数据：
{json.dumps(sig, ensure_ascii=False, indent=2)}
"""

print(f"调用 seed2.0 mini 生成 {len(sig)} 章叙事…（带 thinking，约 30-60 秒）")
raw = server.call_seed(prompt, max_tokens=8000)
data = server.parse_json_object(raw)
(HERE / "story.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n✅ 总标题：{data.get('title')}")
print(f"开场：{data.get('intro')}\n")
for ch in data.get("chapters", []):
    print(f"【{ch['name']}】\n  {ch['story']}\n")
