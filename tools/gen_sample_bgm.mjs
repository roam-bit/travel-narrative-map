// 生成示例 BGM（柔和钢琴感琶音，C–G–Am–F 循环，16 秒可无缝循环）→ bgm/示例·旅途琶音(可删).wav
// 纯 PCM 合成，零依赖。用法：node tools/gen_sample_bgm.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SR = 44100, SECONDS = 16;
const N = SR * SECONDS;
const buf = new Float64Array(N);

const f = midi => 440 * Math.pow(2, (midi - 69) / 12);
// C-G-Am-F（每和弦 4 秒）：[根音低八度, 琶音音符...]
const CHORDS = [
  { bass: 48, arp: [60, 64, 67, 72, 67, 64] },   // C
  { bass: 43, arp: [59, 62, 67, 71, 67, 62] },   // G
  { bass: 45, arp: [57, 60, 64, 69, 64, 60] },   // Am
  { bass: 41, arp: [57, 60, 65, 69, 65, 60] },   // F
];
const CHORD_S = 4, NOTE_S = CHORD_S / 6;

// 一个柔和的"电钢"音色：基波 + 弱二次谐波，指数衰减
function pluck(freq, t, dur){
  if (t < 0 || t >= dur) return 0;
  const env = Math.exp(-3.2 * t / dur) * Math.min(1, t / 0.012);   // 快起音 + 指数衰减
  return env * (Math.sin(2 * Math.PI * freq * t) * 0.8 + Math.sin(4 * Math.PI * freq * t) * 0.18);
}

for (let ci = 0; ci < CHORDS.length; ci++){
  const c = CHORDS[ci], chordStart = ci * CHORD_S;
  // 低音垫：整和弦时长的长音
  for (let i = 0; i < CHORD_S * SR; i++){
    const t = i / SR;
    buf[(chordStart * SR + i) | 0] += pluck(f(c.bass), t, CHORD_S) * 0.30;
  }
  // 琶音：上下行 6 音
  for (let ni = 0; ni < c.arp.length; ni++){
    const noteStart = chordStart + ni * NOTE_S;
    for (let i = 0; i < NOTE_S * SR * 1.8 && (noteStart * SR + i) < N; i++){   // 音尾自然延到下一音里
      const t = i / SR;
      buf[(noteStart * SR + i) | 0] += pluck(f(c.arp[ni]), t, NOTE_S * 1.8) * 0.22;
    }
  }
}
// 总线：软限幅 + 整体音量
let peak = 0;
for (const v of buf) peak = Math.max(peak, Math.abs(v));
const pcm = new Int16Array(N);
for (let i = 0; i < N; i++) pcm[i] = Math.round(Math.tanh(buf[i] / peak * 1.2) * 0.78 * 32767);

// WAV 封装（16bit 单声道）
const dataBytes = pcm.length * 2;
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + dataBytes, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(dataBytes, 40);

mkdirSync(path.join(ROOT, "bgm"), { recursive: true });
const out = path.join(ROOT, "bgm", "示例·旅途琶音(可删).wav");
writeFileSync(out, Buffer.concat([header, Buffer.from(pcm.buffer)]));
console.log("✅ 已生成", out, (dataBytes / 1024 / 1024).toFixed(1) + "MB");
