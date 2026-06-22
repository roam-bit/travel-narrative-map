# 旅行叙事地图 · 动态叙事地图 Demo

把一条真实的自驾/摩旅轨迹，变成一段会"自己讲故事"的动态地图：车辆沿路线行驶、章节逐段点亮、照片随地点浮现、AI 生成有情绪的叙事文案，配 BGM 与音效。

> 这是一个**纯前端 + 零依赖 Python 后端**的作品框架。本仓库为**开源代码框架**：真实旅程的照片与精确 GPS 轨迹未包含在内，你可以按下方说明接入自己的数据。

## ✨ 特性

- 🗺️ 基于高德地图 JS API 的轨迹动画（轨迹流光、车辆沿线行驶、里程牌跟随）
- 🏍️ Three.js 加载 3D 载具模型（摩托车 / 自行车 / 电动车 / 汽车 / 步行可切换）
- 📖 章节式叙事：逐章点亮路线，照片随地点浮现
- 🤖 接入大模型（火山引擎方舟 / 豆包）一键把流水账生成有画面感的叙事文案
- 🎵 章节 BGM + 点火音效，情绪随旅程起伏

## 🚀 快速开始

```bash
# 1. 配置密钥
cp .env.example .env
#   然后编辑 .env，至少填入高德地图的 AMAP_JS_KEY / AMAP_JS_SECURITY_CODE

# 2. 启动（纯标准库，无需 pip install）
python3 server.py

# 3. 浏览器打开
#   http://localhost:8130/story.html   ← 主叙事页
#   http://localhost:8130/index.html   ← 轨迹概览页
```

> 需要 Python 3.9+。数据处理脚本若要用，需额外安装 [`exiftool`](https://exiftool.org/)。

## 📂 接入你自己的数据

主叙事页 `story.html` 运行时会加载三个数据文件（本仓库未附带真实数据，需你自备）：

| 文件 | 内容 | 格式 |
|---|---|---|
| `web_photos.json` | 每章的照片 + 拍摄坐标 | `{ "章节名": { "photos": [{ "file": "photos_web/xxx.jpg", "t": "20250311_2111", "gps": [经度, 纬度] }] } }` |
| `chapters_built.json` | 每章的轨迹分段 + 统计 + 里程碑 | `{ "chapters": [ … ] }`，由 `build_chapters.py` 从轨迹 CSV 生成 |
| `story.json` | 总标题 + 开场白 + 各章叙事文案 | `{ "title", "intro", "chapters": [{ "name", "story" }] }` |

数据处理脚本（`build_chapters.py`、`process_exported.py`、`build_web_photos.py` 等）展示了从「轨迹 CSV + 照片 EXIF」到上述 JSON 的完整流水线，可参考改造。脚本里的本地目录路径请按需替换。

> ⚠️ 照片隐私提醒：原始照片的 EXIF 里含精确 GPS 与设备信息。若要公开你的照片，建议先清除 EXIF（如 `exiftool -all= -overwrite_original photos_web/`），并酌情模糊家/起终点附近的坐标。

## 🗂️ 目录结构

```
server.py            零依赖后端：serve 前端 + 运行时注入高德 key + AI 文案接口
story.html           主叙事页（轨迹动画 + 章节 + 3D 载具）
index.html           轨迹概览页
track.html           简易轨迹页
models/              3D 载具模型（gltf）+ generate_models.mjs 生成脚本
vendor/three/        Three.js（第三方库，MIT）
sfx/                 音效
*.py                 数据预处理脚本（轨迹切分 / 照片归类 / EXIF 清洗）
```

## 🔑 密钥怎么处理

源码里**没有任何明文密钥**。高德 key 在源 HTML 里是 `{{AMAP_JS_KEY}}` / `{{AMAP_SECURITY}}` 占位符，由 `server.py` 在响应时从 `.env` 注入。`.env` 已被 `.gitignore` 排除。

## 🙏 致谢

- 默认摩托车 3D 模型 **"Akira Guy On Motorcycle (Animated)"** by [Jungle Jim](https://sketchfab.com/jungle_jim)，许可 [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/)。
  来源：https://sketchfab.com/3d-models/akira-guy-on-motorcycle-animated-06d83fb6d2aa408385aebefff128d454
- 地图服务：[高德开放平台](https://lbs.amap.com/)
- 3D 渲染：[Three.js](https://threejs.org/)（MIT）

## 📄 许可

本项目代码以 MIT 协议开源（见 [LICENSE](LICENSE)）。
注意：`models/akira/` 下的第三方模型遵循其自带的 CC-BY-4.0 许可（见该目录 `license.txt`），使用/再分发须保留作者署名。
