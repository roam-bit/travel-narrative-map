# Three.js Vendor Files

本目录只保留本项目运行 3D 出行模型需要的 Three.js 文件，来源为 `three@0.142.0`。

选择 `0.142.0` 的原因：高德 `AMap.GLCustomLayer` 当前提供的是 WebGL1 上下文，Three.js r163 以后不再支持 WebGL1。高德官方 `GLCustomLayer + THREE` 示例也使用 `three@0.142`。

## 文件

- `three.module.js`
- `GLTFLoader.js`
- `BufferGeometryUtils.js`
- `SkeletonUtils.js`
- `LICENSE`

## 授权

Three.js 使用 MIT License，许可证文本见 `LICENSE`。
