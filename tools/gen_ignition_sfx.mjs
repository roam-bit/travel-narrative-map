// 开场点火音效：巡航摩托「启动马达→点燃→怠速→轰油门→回落淡出」~2.4s 合成（独立音效轨，不进 BGM 曲库）。
// 原理：摩托声=周期性爆发脉冲串。怠速 ~12.5Hz 突突 → 轰油门脉冲率拉到 ~42Hz 再回落；脉冲=低频爆破+排气噪声尾。
// 用法：node tools/gen_ignition_sfx.mjs → sfx/ignition.wav
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SR = 44100, DUR = 2.45, N = Math.ceil(DUR * SR);
const buf = new Float64Array(N);
const rnd = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(228228);

// 单次引擎爆发脉冲：低频体 + 排气噪声尾
function pulse(t0, baseF, amp){
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.07 * SR);
  for (let k = 0; k < len && i0 + k < N; k++){
    const t = k / SR;
    const body = Math.sin(2 * Math.PI * baseF * t) * Math.exp(-t * 55);
    const exhaust = (rnd() * 2 - 1) * Math.exp(-t * 130) * 0.55;
    buf[i0 + k] += (body + exhaust) * amp;
  }
}
// 启动马达咔哒（金属高频短脉冲）
function clack(t0, amp){
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.02 * SR);
  let p = 0;
  for (let k = 0; k < len && i0 + k < N; k++){
    const t = k / SR;
    const w = rnd() * 2 - 1, hp = w - p; p = w;
    buf[i0 + k] += (hp * Math.exp(-t * 280) + Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 220) * 0.35) * amp;
  }
}

// ① 启动马达 0~0.28s：高频哒哒哒（25Hz 重复）
for (let t = 0.02; t < 0.28; t += 0.04) clack(t, 0.5);
// ② 点燃 0.28s：一声低频轰 + 大噪声爆
{
  const i0 = Math.floor(0.28 * SR), len = Math.floor(0.22 * SR);
  for (let k = 0; k < len && i0 + k < N; k++){
    const t = k / SR;
    const f = 52 - 22 * Math.min(1, t / 0.2);   // 52→30Hz 下扫
    buf[i0 + k] += (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * 1.1 + (rnd() * 2 - 1) * Math.exp(-t * 38) * 0.7);
  }
}
// ③④⑤ 怠速 → 轰油门 → 回落：脉冲率包络 12.5Hz → 42Hz → 14Hz
let t = 0.36;
while (t < DUR - 0.05){
  let rate, amp, baseF;
  if (t < 1.15){ rate = 12.5; amp = 0.85; baseF = 70 + (rnd() - 0.5) * 16; }                        // 怠速突突（频率抖动=机械不均匀感）
  else if (t < 1.55){ const u = (t - 1.15) / 0.4; rate = 12.5 + u * 29.5; amp = 0.85 + u * 0.5; baseF = 70 + u * 25 + (rnd() - 0.5) * 10; }   // 轰油门
  else { const u = Math.min(1, (t - 1.55) / 0.5); rate = 42 - u * 28; amp = 1.3 - u * 0.55; baseF = 95 - u * 25 + (rnd() - 0.5) * 12; }       // 回落
  pulse(t, baseF, amp);
  t += 1 / rate;
}
// 全局：尾部淡出（2.0s 起）+ 一阶低通（车体闷感）+ 软失真（机械粗粝）
let lp = 0;
const out = new Float64Array(N);
for (let i = 0; i < N; i++){
  const tt = i / SR;
  const fade = tt > 2.0 ? Math.exp(-(tt - 2.0) * 7) : 1;
  lp += 0.32 * (buf[i] - lp);
  out[i] = Math.tanh(lp * 2.2) * fade;
}
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
const pcm = new Int16Array(N);
for (let i = 0; i < N; i++) pcm[i] = Math.round(out[i] / peak * 0.85 * 32767);

const dataBytes = pcm.length * 2;
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + dataBytes, 4); h.write("WAVE", 8);
h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
h.write("data", 36); h.writeUInt32LE(dataBytes, 40);
mkdirSync(path.join(ROOT, "sfx"), { recursive: true });
writeFileSync(path.join(ROOT, "sfx", "ignition.wav"), Buffer.concat([h, Buffer.from(pcm.buffer)]));
console.log("✅ 已生成 sfx/ignition.wav", (dataBytes / 1024).toFixed(0) + "KB，时长 " + DUR + "s");
