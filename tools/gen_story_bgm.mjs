// 叙事 BGM v2「推门一年·心路」：按当事人口述的真实情绪曲线合成 ~80s（见 故事素材-当事人口述.md）。
// 曲线 = 明亮出发(兴奋好奇) → 回落+温暖(老同学) → 疲倦(泉州) → 深谷(广西一个月,全曲最暗)
//      → 重新出发爬升 → 最高潮(藏疆,三观重塑) → 冷硬机械(北境赶路)+每晚热水的暖音 → 温暖终止(G228,大叔按下快门,呼应开头)。
// 纯 PCM 合成零依赖，立体声。用法：node tools/gen_story_bgm.mjs
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SR = 44100, BPM = 112, BEAT = 60 / BPM;
const BARS = 37, DUR = BARS * 4 * BEAT + 2.8;   // ≈82s
const N = Math.ceil(DUR * SR);
const L = new Float64Array(N), R = new Float64Array(N);

const f = m => 440 * Math.pow(2, (m - 69) / 12);
// 明亮进行（C 起）：C G Am F；深谷：Am F（低回）；北境：Am 持续
const BRIGHT = [
  { root: 48, chord: [60, 64, 67], pad: [48, 55, 60, 64, 67] },   // C
  { root: 43, chord: [59, 62, 67], pad: [43, 50, 59, 62, 67] },   // G
  { root: 45, chord: [57, 60, 64], pad: [45, 52, 57, 60, 64] },   // Am
  { root: 41, chord: [57, 60, 65], pad: [41, 48, 57, 60, 65] },   // F
];
const DARK = [
  { root: 45, chord: [57, 60, 64], pad: [45, 52, 57, 60] },       // Am
  { root: 41, chord: [53, 57, 60], pad: [41, 48, 53, 57] },       // F(低位)
];
const MOTIF = [69, 72, 76, 79];   // A C E G："远方"动机（C 大调里=C6，通吃明暗）

const rnd = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(20260611);
function addNote(start, dur, gain, pan, gen){
  const i0 = Math.max(0, Math.floor(start * SR)), i1 = Math.min(N, Math.ceil((start + dur) * SR));
  const gl = gain * Math.cos(pan * Math.PI / 4 + Math.PI / 4) * 1.2, gr = gain * Math.sin(pan * Math.PI / 4 + Math.PI / 4) * 1.2;
  for (let i = i0; i < i1; i++){ const v = gen(i / SR - start); L[i] += v * gl; R[i] += v * gr; }
}
const pluck = fr => t => Math.exp(-3.4 * t) * Math.min(1, t / 0.01) * (Math.sin(2 * Math.PI * fr * t) * 0.8 + Math.sin(4 * Math.PI * fr * t) * 0.2);
const bass  = fr => t => Math.exp(-5 * t) * Math.min(1, t / 0.008) * (Math.sin(2 * Math.PI * fr * t) + Math.sin(4 * Math.PI * fr * t) * 0.35 + Math.sin(6 * Math.PI * fr * t) * 0.12);
const lead  = fr => t => Math.exp(-2.2 * t) * Math.min(1, t / 0.015) * (Math.sin(2 * Math.PI * fr * t) + Math.sin(6 * Math.PI * fr * t) / 3 + Math.sin(10 * Math.PI * fr * t) / 6);
const padG  = (fr, dur) => t => {
  const env = Math.min(1, t / 0.7) * Math.min(1, Math.max(0, (dur - t) / 0.9));
  return env * (Math.sin(2 * Math.PI * fr * 0.9975 * t) + Math.sin(2 * Math.PI * fr * t) + Math.sin(2 * Math.PI * fr * 1.0025 * t)) / 3;
};
const kick  = () => t => { const ph = 45 * t + (150 - 45) / 28 * (1 - Math.exp(-28 * t)); return Math.exp(-9 * t) * Math.sin(2 * Math.PI * ph); };
const snare = () => t => ((rnd() * 2 - 1) * 0.7 * Math.exp(-16 * t) + Math.sin(2 * Math.PI * 185 * t) * 0.5 * Math.exp(-22 * t));
const hat   = () => { let p = 0; return t => { const w = rnd() * 2 - 1, hp = w - p; p = w; return hp * Math.exp(-55 * t); }; };
const crash = () => { let p = 0; return t => { const w = rnd() * 2 - 1, hp = w - p; p = w; return hp * Math.exp(-1.4 * t) * 0.8; }; };
const beatT = (bar, beat) => (bar * 4 + beat) * BEAT;

for (let bar = 0; bar < BARS; bar++){
  const t0 = beatT(bar, 0);
  // 段落：0-4 出发明亮 | 5-8 回落温暖 | 9-10 疲倦 | 11-16 深谷 | 17-22 重新出发 | 23-30 最高潮 | 31-33 北境冷硬 | 34-36 凯旋终止
  const SEC = bar <= 4 ? "go" : bar <= 8 ? "soft" : bar <= 10 ? "tired" : bar <= 16 ? "valley"
            : bar <= 22 ? "rise" : bar <= 30 ? "peak" : bar <= 33 ? "north" : "home";
  const C = SEC === "valley" ? DARK[bar % 2] : SEC === "north" ? DARK[0] : BRIGHT[Math.floor(bar / 2) % 4];

  if (SEC === "go"){   // 出发：明亮八分琶音 + 轻 kick(1/3拍) + 垫——兴奋、好奇、状态最满
    for (let b = 0; b < 8; b++) addNote(t0 + b * BEAT / 2, BEAT, 0.15, 0.25, pluck(f(C.chord[b % 3] + (b % 4 === 3 ? 12 : 0))));
    addNote(t0, 0.5, 0.20, 0, kick()); addNote(t0 + 2 * BEAT, 0.5, 0.20, 0, kick());
    addNote(t0, 4 * BEAT, 0.10, 0, padG(f(C.root), 4 * BEAT));
  }
  if (SEC === "soft"){   // 回落+温暖：琶音四分变稀 + 温暖中音长对位（多年未见的老同学）
    for (let b = 0; b < 4; b++) addNote(t0 + b * BEAT, BEAT, 0.12, 0.25, pluck(f(C.chord[b % 3])));
    addNote(t0, 4 * BEAT, 0.09, -0.3, padG(f(C.chord[1]), 4 * BEAT));
    addNote(t0, 4 * BEAT, 0.10, 0, padG(f(C.root), 4 * BEAT));
  }
  if (SEC === "tired"){   // 疲倦（泉州连住4天）：只剩两个单音和垫
    addNote(t0, BEAT * 2, 0.11, 0.2, pluck(f(C.chord[0])));
    addNote(t0 + 2.5 * BEAT, BEAT * 1.5, 0.08, 0.2, pluck(f(C.root + 12)));
    addNote(t0, 4 * BEAT, 0.09, 0, padG(f(C.root), 4 * BEAT));
  }
  if (SEC === "valley"){   // 深谷（广西·独自对抗的一个月）：低音下行长垫 + 心跳弱 kick + 孤灯单音
    addNote(t0, 4 * BEAT, 0.12, 0, padG(f(C.root - 12 + 12), 4 * BEAT));
    addNote(t0, 0.5, 0.10, 0, kick());                                  // 每小节一次心跳
    if (bar >= 13) addNote(t0 + 2 * BEAT, 0.5, 0.07, 0, kick());        // 后半：心跳渐稳（撑过来）
    if (bar % 2 === 0) addNote(t0 + 1.5 * BEAT, BEAT * 2.5, 0.085, 0.35, pluck(f(C.chord[2] + 12)));   // 高处一滴孤音
    if (bar >= 15) for (let b = 0; b < 2; b++) addNote(t0 + b * 2 * BEAT, BEAT, 0.07, 0.2, pluck(f(C.chord[b % 3])));   // 单音规律化
  }
  if (SEC === "rise"){   // 重新出发（"影响不到我的摩旅计划"）：节奏回归逐层叠
    const k = bar - 17;   // 0..5 力度爬升
    for (let b = 0; b < 8; b++) addNote(t0 + b * BEAT / 2, BEAT, 0.10 + k * 0.008, 0.25, pluck(f(C.chord[b % 3] + (b % 4 === 3 ? 12 : 0))));
    for (let b = 0; b < 4; b++) addNote(t0 + b * BEAT, 0.5, 0.26 + k * 0.015, 0, kick());
    for (let b = 0; b < 8; b++) addNote(t0 + b * BEAT / 2, BEAT / 2, 0.15, 0, bass(f(C.root)));
    addNote(t0, 4 * BEAT, 0.10, 0, padG(f(C.root), 4 * BEAT));
    if (k >= 2){ addNote(t0 + BEAT, 0.3, 0.15, 0.1, snare()); addNote(t0 + 3 * BEAT, 0.3, 0.15, 0.1, snare()); }
    if (k >= 3) for (let b = 0; b < 8; b++) addNote(t0 + b * BEAT / 2, 0.08, 0.06, -0.3, hat());
  }
  if (SEC === "peak"){   // 最高潮（藏疆：最美景色+朋友+三观重塑）：全奏 + 动机上行
    for (let b = 0; b < 4; b++) addNote(t0 + b * BEAT, 0.5, 0.38, 0, kick());
    const pat = [0, 0, 7, 0, 12, 0, 7, 5];
    for (let b = 0; b < 8; b++) addNote(t0 + b * BEAT / 2, BEAT / 2, 0.20, 0, bass(f(C.root + pat[b])));
    addNote(t0 + BEAT, 0.3, 0.20, 0.1, snare()); addNote(t0 + 3 * BEAT, 0.3, 0.20, 0.1, snare());
    for (let b = 0; b < 16; b++) addNote(t0 + b * BEAT / 4, 0.08, b % 4 === 2 ? 0.10 : 0.06, -0.3, hat());
    C.pad.forEach((m, k2) => addNote(t0, 4 * BEAT, 0.055, k2 % 2 ? 0.5 : -0.5, padG(f(m), 4 * BEAT)));
    const up = bar >= 27 ? 12 : 0;
    MOTIF.forEach((m, k2) => addNote(t0 + k2 * BEAT, BEAT * 1.1, 0.17, -0.1, lead(f(m + up))));
    if (bar >= 29) MOTIF.forEach((m, k2) => addNote(t0 + k2 * BEAT, BEAT * 1.1, 0.11, 0.15, lead(f(m + 24))));   // 顶点双八度
    if ([23, 27].includes(bar)) addNote(t0, 2.2, 0.16, 0, crash());
  }
  if (SEC === "north"){   // 北境：抽掉和声只剩机械节奏（冷、赶路）+ 小节末一个温暖长音（每晚的热水池）
    for (let b = 0; b < 4; b++) addNote(t0 + b * BEAT, 0.5, 0.34, 0, kick());
    for (let b = 0; b < 8; b++) addNote(t0 + b * BEAT / 2, BEAT / 2, 0.19, 0, bass(f(45)));
    for (let b = 0; b < 16; b++) addNote(t0 + b * BEAT / 4, 0.08, b % 4 === 2 ? 0.09 : 0.055, -0.3, hat());
    addNote(t0 + BEAT, 0.3, 0.17, 0.1, snare()); addNote(t0 + 3 * BEAT, 0.3, 0.17, 0.1, snare());
    addNote(t0 + 3 * BEAT, BEAT * 2.2, 0.075, 0.4, padG(f(64), BEAT * 2.2));   // 热水的暖音冒头
    if (bar === 31) addNote(t0, 2.2, 0.15, 0, crash());
  }
  if (SEC === "home"){   // 凯旋（G228 起点，大叔按下快门）：温暖满和弦 + 开头琶音动机再现 → 单音收
    if (bar === 34){
      addNote(t0, 2.5, 0.17, 0, crash());
      BRIGHT[0].pad.forEach((m, k2) => addNote(t0, 8 * BEAT, 0.06, k2 % 2 ? 0.4 : -0.4, padG(f(m), 8 * BEAT)));
      for (let b = 0; b < 8; b++) addNote(t0 + b * BEAT / 2, BEAT, 0.13, 0.25, pluck(f(BRIGHT[0].chord[b % 3] + (b % 4 === 3 ? 12 : 0))));
    }
    if (bar === 35) for (let b = 0; b < 4; b++) addNote(t0 + b * BEAT, BEAT, 0.11, 0.25, pluck(f(BRIGHT[0].chord[b % 3])));
    if (bar === 36){ addNote(t0, BEAT * 4, 0.10, 0, padG(f(48), BEAT * 4)); addNote(t0 + BEAT, BEAT * 3, 0.14, 0, pluck(f(60))); }
  }
}

let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const pcm = new Int16Array(N * 2);
for (let i = 0; i < N; i++){
  pcm[i * 2]     = Math.round(Math.tanh(L[i] / peak * 1.35) * 0.82 * 32767);
  pcm[i * 2 + 1] = Math.round(Math.tanh(R[i] / peak * 1.35) * 0.82 * 32767);
}
const dataBytes = pcm.length * 2;
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + dataBytes, 4); h.write("WAVE", 8);
h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write("data", 36); h.writeUInt32LE(dataBytes, 40);

mkdirSync(path.join(ROOT, "bgm"), { recursive: true });
rmSync(path.join(ROOT, "bgm", "示例·推门一年·渐燃(可删).wav"), { force: true });
const out = path.join(ROOT, "bgm", "示例·推门一年v2·心路(可删).wav");
writeFileSync(out, Buffer.concat([h, Buffer.from(pcm.buffer)]));
console.log("✅ 已生成", out, (dataBytes / 1024 / 1024).toFixed(1) + "MB，时长 " + DUR.toFixed(1) + "s");
