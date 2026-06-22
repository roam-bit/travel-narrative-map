# 环中国摩旅 3D 出行模型

本目录里的 `.gltf` 是项目本地生成的低多边形模型，不依赖第三方 CDN 或外部素材包。

## 文件

- `motorcycle-rider.gltf`：摩托骑手
- `bike-rider.gltf`：自行车骑手
- `ebike-rider.gltf`：电动车骑手
- `car.gltf`：汽车
- `walker.gltf`：步行小人
- `generate_models.mjs`：可重复生成上述模型的脚本

## 授权

- `*.gltf`（本目录根下的 5 个）：由本项目脚本 `generate_models.mjs` 程序化生成，可自由使用、修改、商用，无署名约束。
- `akira/`（摩托车实际使用的模型）：来自 Sketchfab，**CC-BY-4.0**，允许商用但**必须署名**。分享/发布时须附下方署名：

> This work is based on "Akira Guy On Motorcycle (Animated)" (https://sketchfab.com/3d-models/akira-guy-on-motorcycle-animated-06d83fb6d2aa408385aebefff128d454) by Jungle Jim (https://sketchfab.com/jungle_jim) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

⚠️ 注意：该模型为《AKIRA》同人作品，原作动漫另有版权。自用/作品集无碍；若产品**正式商业化发布**，建议替换为无第三方 IP 的模型。

## 朝向

模型在 glTF 坐标中以 `-Z` 为前进方向。页面加载到高德 3D 图层时会先绕 X 轴旋转 90 度，再用路线方位角绕 Z 轴旋转。若实际车头和路线方向有偏差，调整 `story.html` 中的 `GLTF_HEADING_OFFSET`。
