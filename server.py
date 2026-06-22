#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
旅行叙事地图 · Demo 后端（纯标准库，零依赖）

职责：
  1. 运行时从项目根目录的 .env 读取 API key（明文 key 不进任何源文件）
  2. serve 前端 index.html，并在返回时把高德 key 注入到占位符（源文件不含明文 key）
  3. /api/generate_story —— 把整条路线发给 seed2.0 mini，一次性生成有情绪的叙事文案

启动：python3 server.py    然后浏览器打开 http://localhost:8130
"""
import json
import os
import re
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", 8130))
HERE = Path(__file__).resolve().parent
ENV_PATH = HERE / ".env"


# ---------- 读取 .env（运行时，不落地）----------
def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        print(f"⚠️  找不到 .env：{path}")
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env(ENV_PATH)
ARK_API_KEY = ENV.get("ARK_API_KEY", "")
ARK_MODEL = ENV.get("ARK_MODEL", "doubao-seed-2-0-mini-260428")
ARK_API_URL = ENV.get("ARK_API_URL", "https://ark.cn-beijing.volces.com/api/v3/responses")
AMAP_JS_KEY = ENV.get("AMAP_JS_KEY", "")
AMAP_JS_SECURITY = ENV.get("AMAP_JS_SECURITY_CODE", "")

print(f"✅ ARK key: {'已加载' if ARK_API_KEY else '缺失'} | model: {ARK_MODEL}")
print(f"✅ 高德 JS key: {'已加载' if AMAP_JS_KEY else '缺失'}")


# ---------- 解析 Responses API 返回的文本 ----------
def iter_dicts(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from iter_dicts(item)
    elif isinstance(value, list):
        for item in value:
            yield from iter_dicts(item)


def extract_response_text(result: dict) -> str:
    chunks = []
    for item in iter_dicts(result):
        if item.get("type") in {"output_text", "text"} and isinstance(item.get("text"), str):
            chunks.append(item["text"])
        elif isinstance(item.get("content"), str) and item.get("role") == "assistant":
            chunks.append(item["content"])
    if chunks:
        return "\n".join(dict.fromkeys(chunks))
    out = result.get("output_text")
    return out if isinstance(out, str) else ""


def parse_json_object(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"\s*```$", "", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            raise
        return json.loads(m.group(0))


# ---------- 调 seed2.0 mini ----------
def call_seed(prompt: str, max_tokens: int = 4000) -> str:
    # 注意：seed2.0 mini 带 thinking，reasoning 也算进 max_output_tokens，
    # 给小了正文会被截断成残缺 JSON。这里留足预算。
    if not ARK_API_KEY:
        raise RuntimeError("缺少 ARK_API_KEY")
    payload = {
        "model": ARK_MODEL,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        "max_output_tokens": max_tokens,
    }
    req = urllib.request.Request(
        ARK_API_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {ARK_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        result = json.loads(r.read().decode("utf-8"))
    return extract_response_text(result)


STORY_PROMPT = """你是一位擅长把旅途碎片写成有画面感、有情绪的叙事者。
下面是一段自驾游的行程，每个地点附了用户的流水账记录。请你：
1. 为整条路线起一个有诗意、能勾起情绪的总标题（不超过12字）
2. 写一段30-50字的开场白，定下整段旅程的情绪基调
3. 为每个地点写一段50-80字的叙事文案：有画面感、有温度、有细节，绝不是流水账，让看的人仿佛身临其境

严格只返回 JSON，格式：
{{"title":"总标题","intro":"开场白","chapters":[{{"name":"地点名","story":"该地点的叙事文案"}}]}}
chapters 的顺序和数量必须与输入完全一致。不要输出任何 JSON 以外的内容。

行程数据：
{itinerary}
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 静音默认日志

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store, must-revalidate")  # 开发期禁缓存，避免看到旧页面
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        import mimetypes
        from urllib.parse import unquote
        path = unquote(self.path.split("?")[0])  # URL 解码（中文路径）+ 忽略 ?t=xxx
        if path == "/api/bgm_list":  # BGM 曲库：列出 bgm/ 目录下的音频文件（M10）
            audio_exts = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"}
            bgm_dir = HERE / "bgm"
            files = sorted(f.name for f in bgm_dir.iterdir() if f.is_file() and f.suffix.lower() in audio_exts) if bgm_dir.is_dir() else []
            return self._send(200, json.dumps({"files": files}, ensure_ascii=False))
        if path in ("/", ""):
            path = "/index.html"
        target = (HERE / path.lstrip("/")).resolve()
        if not (target.exists() and target.is_file() and str(target).startswith(str(HERE))):
            return self._send(404, json.dumps({"error": "not found"}))
        # 任意 .html 都注入高德 key（源文件不含明文）
        if target.suffix.lower() == ".html":
            html = target.read_text(encoding="utf-8")
            html = html.replace("{{AMAP_JS_KEY}}", AMAP_JS_KEY).replace("{{AMAP_SECURITY}}", AMAP_JS_SECURITY)
            return self._send(200, html, "text/html; charset=utf-8")
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        # Range 请求支持（audio 拖进度条 / Safari 播放必需）：只处理单段 bytes=start-end
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes="):
            try:
                spec = rng[6:].split(",")[0].strip()
                s, _, e = spec.partition("-")
                start = int(s) if s else max(0, len(data) - int(e))
                end = min(int(e) if (e and s) else len(data) - 1, len(data) - 1)
                if 0 <= start <= end:
                    chunk = data[start:end + 1]
                    self.send_response(206)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(chunk)))
                    self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Cache-Control", "no-store, must-revalidate")
                    self.end_headers()
                    self.wfile.write(chunk)
                    return
            except (ValueError, OSError):
                pass
        return self._send(200, data, ctype)

    def do_POST(self):
        if self.path != "/api/generate_story":
            return self._send(404, json.dumps({"error": "not found"}))
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            chapters = body.get("chapters", [])
            itinerary = json.dumps(
                [{"name": c.get("name"), "time": c.get("time"), "note": c.get("note")} for c in chapters],
                ensure_ascii=False,
                indent=2,
            )
            prompt = STORY_PROMPT.format(itinerary=itinerary)
            raw = call_seed(prompt)
            data = parse_json_object(raw)
            self._send(200, json.dumps({"ok": True, **data}, ensure_ascii=False))
        except Exception as e:
            print(f"❌ generate_story 失败：{e}")
            self._send(200, json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))


if __name__ == "__main__":
    print(f"\n🚀 旅行叙事地图 Demo 已启动 → http://localhost:{PORT}\n")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
