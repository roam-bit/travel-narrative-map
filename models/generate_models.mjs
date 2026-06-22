import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = dirname(fileURLToPath(import.meta.url));

const COLORS = {
  tire: [0.012, 0.014, 0.018, 1],
  rubber: [0.035, 0.04, 0.048, 1],
  metal: [0.63, 0.68, 0.72, 1],
  chrome: [0.92, 0.9, 0.82, 1],
  motoOrange: [1.0, 0.47, 0.12, 1],
  warmCream: [1.0, 0.9, 0.68, 1],
  bikeBlue: [0.1, 0.48, 1.0, 1],
  ebikeGreen: [0.18, 0.86, 0.42, 1],
  carWhite: [0.92, 0.95, 1.0, 1],
  carOrange: [1.0, 0.55, 0.12, 1],
  glass: [0.34, 0.63, 1.0, 0.82],
  jacket: [0.055, 0.068, 0.085, 1],
  pants: [0.025, 0.03, 0.04, 1],
  skin: [1.0, 0.74, 0.54, 1],
  red: [0.95, 0.08, 0.08, 1],
  light: [1.0, 0.96, 0.78, 1],
};

const MAT = {
  tire: 0,
  rubber: 1,
  metal: 2,
  chrome: 3,
  motoOrange: 4,
  warmCream: 5,
  bikeBlue: 6,
  ebikeGreen: 7,
  carWhite: 8,
  carOrange: 9,
  glass: 10,
  jacket: 11,
  pants: 12,
  skin: 13,
  red: 14,
  light: 15,
};

function material(name, color, metallic = 0, roughness = 0.68) {
  const mat = {
    name,
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: color,
      metallicFactor: metallic,
      roughnessFactor: roughness,
    },
  };
  if (color[3] < 1) mat.alphaMode = "BLEND";
  return mat;
}

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vecNormalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function faceNormal(a, b, c) {
  return vecNormalize(vecCross(vecSub(b, a), vecSub(c, a)));
}

function pushTri(out, a, b, c) {
  const start = out.positions.length / 3;
  const n = faceNormal(a, b, c);
  out.positions.push(...a, ...b, ...c);
  out.normals.push(...n, ...n, ...n);
  out.indices.push(start, start + 1, start + 2);
}

function pushQuad(out, a, b, c, d) {
  pushTri(out, a, b, c);
  pushTri(out, a, c, d);
}

function part(materialIndex) {
  return { positions: [], normals: [], indices: [], materialIndex };
}

function box(center, size, materialIndex) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map(v => v / 2);
  const v = [
    [cx - sx, cy - sy, cz - sz],
    [cx + sx, cy - sy, cz - sz],
    [cx + sx, cy + sy, cz - sz],
    [cx - sx, cy + sy, cz - sz],
    [cx - sx, cy - sy, cz + sz],
    [cx + sx, cy - sy, cz + sz],
    [cx + sx, cy + sy, cz + sz],
    [cx - sx, cy + sy, cz + sz],
  ];
  const out = part(materialIndex);
  pushQuad(out, v[0], v[1], v[2], v[3]);
  pushQuad(out, v[5], v[4], v[7], v[6]);
  pushQuad(out, v[4], v[0], v[3], v[7]);
  pushQuad(out, v[1], v[5], v[6], v[2]);
  pushQuad(out, v[3], v[2], v[6], v[7]);
  pushQuad(out, v[4], v[5], v[1], v[0]);
  return out;
}

function taperedBox(center, bottomSize, topSize, materialIndex, topOffset = [0, 0]) {
  const [cx, cy, cz] = center;
  const [bw, bh, bd] = bottomSize;
  const [tw, th, td] = topSize;
  const y0 = cy - bh / 2;
  const y1 = cy + th / 2;
  const [tox, toz] = topOffset;
  const b = [
    [cx - bw / 2, y0, cz - bd / 2],
    [cx + bw / 2, y0, cz - bd / 2],
    [cx + bw / 2, y0, cz + bd / 2],
    [cx - bw / 2, y0, cz + bd / 2],
  ];
  const t = [
    [cx + tox - tw / 2, y1, cz + toz - td / 2],
    [cx + tox + tw / 2, y1, cz + toz - td / 2],
    [cx + tox + tw / 2, y1, cz + toz + td / 2],
    [cx + tox - tw / 2, y1, cz + toz + td / 2],
  ];
  const out = part(materialIndex);
  pushQuad(out, b[0], b[1], b[2], b[3]);
  pushQuad(out, t[3], t[2], t[1], t[0]);
  pushQuad(out, b[0], t[0], t[1], b[1]);
  pushQuad(out, b[1], t[1], t[2], b[2]);
  pushQuad(out, b[2], t[2], t[3], b[3]);
  pushQuad(out, b[3], t[3], t[0], b[0]);
  return out;
}

function cylinderX(center, radius, length, segments, materialIndex) {
  const [cx, cy, cz] = center;
  const x0 = cx - length / 2;
  const x1 = cx + length / 2;
  const out = part(materialIndex);
  for (let i = 0; i < segments; i++) {
    const a0 = (Math.PI * 2 * i) / segments;
    const a1 = (Math.PI * 2 * (i + 1)) / segments;
    const y0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const y1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    const start = out.positions.length / 3;
    out.positions.push(
      x0, cy + y0, cz + z0,
      x1, cy + y0, cz + z0,
      x1, cy + y1, cz + z1,
      x0, cy + y1, cz + z1,
    );
    out.normals.push(
      0, y0 / radius, z0 / radius,
      0, y0 / radius, z0 / radius,
      0, y1 / radius, z1 / radius,
      0, y1 / radius, z1 / radius,
    );
    out.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  for (const [x, normalX] of [[x0, -1], [x1, 1]]) {
    const centerIndex = out.positions.length / 3;
    out.positions.push(x, cy, cz);
    out.normals.push(normalX, 0, 0);
    for (let i = 0; i < segments; i++) {
      const a = (Math.PI * 2 * i) / segments;
      out.positions.push(x, cy + Math.cos(a) * radius, cz + Math.sin(a) * radius);
      out.normals.push(normalX, 0, 0);
    }
    for (let i = 0; i < segments; i++) {
      const a = centerIndex + 1 + i;
      const b = centerIndex + 1 + ((i + 1) % segments);
      if (normalX < 0) out.indices.push(centerIndex, b, a);
      else out.indices.push(centerIndex, a, b);
    }
  }
  return out;
}

function cylinderBetween(start, end, radius, segments, materialIndex) {
  const axis = vecSub(end, start);
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-6) return part(materialIndex);
  const w = vecNormalize(axis);
  const seed = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = vecNormalize(vecCross(w, seed));
  const v = vecNormalize(vecCross(u, w));
  const out = part(materialIndex);
  for (let i = 0; i < segments; i++) {
    const a0 = (Math.PI * 2 * i) / segments;
    const a1 = (Math.PI * 2 * (i + 1)) / segments;
    const r0 = [
      Math.cos(a0) * radius * u[0] + Math.sin(a0) * radius * v[0],
      Math.cos(a0) * radius * u[1] + Math.sin(a0) * radius * v[1],
      Math.cos(a0) * radius * u[2] + Math.sin(a0) * radius * v[2],
    ];
    const r1 = [
      Math.cos(a1) * radius * u[0] + Math.sin(a1) * radius * v[0],
      Math.cos(a1) * radius * u[1] + Math.sin(a1) * radius * v[1],
      Math.cos(a1) * radius * u[2] + Math.sin(a1) * radius * v[2],
    ];
    const p0 = [start[0] + r0[0], start[1] + r0[1], start[2] + r0[2]];
    const p1 = [end[0] + r0[0], end[1] + r0[1], end[2] + r0[2]];
    const p2 = [end[0] + r1[0], end[1] + r1[1], end[2] + r1[2]];
    const p3 = [start[0] + r1[0], start[1] + r1[1], start[2] + r1[2]];
    const startIndex = out.positions.length / 3;
    out.positions.push(...p0, ...p1, ...p2, ...p3);
    out.normals.push(
      ...vecNormalize(r0),
      ...vecNormalize(r0),
      ...vecNormalize(r1),
      ...vecNormalize(r1),
    );
    out.indices.push(startIndex, startIndex + 1, startIndex + 2, startIndex, startIndex + 2, startIndex + 3);
  }
  for (const [center, normal, reverse] of [[start, [-w[0], -w[1], -w[2]], true], [end, w, false]]) {
    const centerIndex = out.positions.length / 3;
    out.positions.push(...center);
    out.normals.push(...normal);
    for (let i = 0; i < segments; i++) {
      const a = (Math.PI * 2 * i) / segments;
      const p = [
        center[0] + Math.cos(a) * radius * u[0] + Math.sin(a) * radius * v[0],
        center[1] + Math.cos(a) * radius * u[1] + Math.sin(a) * radius * v[1],
        center[2] + Math.cos(a) * radius * u[2] + Math.sin(a) * radius * v[2],
      ];
      out.positions.push(...p);
      out.normals.push(...normal);
    }
    for (let i = 0; i < segments; i++) {
      const a = centerIndex + 1 + i;
      const b = centerIndex + 1 + ((i + 1) % segments);
      if (reverse) out.indices.push(centerIndex, b, a);
      else out.indices.push(centerIndex, a, b);
    }
  }
  return out;
}

function ellipsoid(center, radii, materialIndex, segments = 10, rings = 5) {
  const [cx, cy, cz] = center;
  const [rx, ry, rz] = radii;
  const out = part(materialIndex);
  for (let ring = 0; ring < rings; ring++) {
    const v0 = (Math.PI * ring) / rings;
    const v1 = (Math.PI * (ring + 1)) / rings;
    for (let seg = 0; seg < segments; seg++) {
      const u0 = (Math.PI * 2 * seg) / segments;
      const u1 = (Math.PI * 2 * (seg + 1)) / segments;
      const pts = [
        spherePoint(cx, cy, cz, rx, ry, rz, u0, v0),
        spherePoint(cx, cy, cz, rx, ry, rz, u1, v0),
        spherePoint(cx, cy, cz, rx, ry, rz, u1, v1),
        spherePoint(cx, cy, cz, rx, ry, rz, u0, v1),
      ];
      const start = out.positions.length / 3;
      out.positions.push(...pts[0].p, ...pts[1].p, ...pts[2].p, ...pts[3].p);
      out.normals.push(...pts[0].n, ...pts[1].n, ...pts[2].n, ...pts[3].n);
      out.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  return out;
}

function spherePoint(cx, cy, cz, rx, ry, rz, u, v) {
  const sx = Math.cos(u) * Math.sin(v);
  const sy = Math.cos(v);
  const sz = Math.sin(u) * Math.sin(v);
  return {
    p: [cx + sx * rx, cy + sy * ry, cz + sz * rz],
    n: vecNormalize([sx / rx, sy / ry, sz / rz]),
  };
}

function diamond(center, radius, materialIndex) {
  const [cx, cy, cz] = center;
  const v = [
    [cx, cy + radius, cz],
    [cx, cy - radius, cz],
    [cx + radius, cy, cz],
    [cx - radius, cy, cz],
    [cx, cy, cz + radius],
    [cx, cy, cz - radius],
  ];
  const faces = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];
  const out = part(materialIndex);
  faces.forEach(face => pushTri(out, v[face[0]], v[face[1]], v[face[2]]));
  return out;
}

function wheel(parts, x, z, radius, width, hubRadius = radius * 0.42) {
  parts.push(
    cylinderX([x, radius, z], radius, width, 18, MAT.tire),
    cylinderX([x, radius, z], hubRadius, width * 1.18, 14, MAT.chrome),
  );
}

function rider(parts, opts = {}) {
  const {
    x = 0,
    y = 0,
    z = 0,
    lean = 0,
    helmet = MAT.warmCream,
    jacket = MAT.jacket,
    compact = false,
  } = opts;
  const torsoZ = z + lean * 0.18;
  const shoulderZ = z - 0.12 + lean * 0.2;
  const hipZ = z + 0.13;
  const headZ = z - 0.19 + lean * 0.22;
  const torsoY = y + (compact ? 0.86 : 0.93);
  const headY = y + (compact ? 1.12 : 1.2);
  parts.push(
    ellipsoid([x, torsoY, torsoZ], [0.16, compact ? 0.2 : 0.24, 0.13], jacket, 10, 5),
    ellipsoid([x, headY, headZ], [0.13, 0.13, 0.14], helmet, 10, 5),
    box([x, y + 0.67, hipZ], [0.28, 0.12, 0.2], MAT.pants),
  );
  return {
    shoulderL: [x - 0.13, torsoY + 0.05, shoulderZ],
    shoulderR: [x + 0.13, torsoY + 0.05, shoulderZ],
    hipL: [x - 0.1, y + 0.65, hipZ],
    hipR: [x + 0.1, y + 0.65, hipZ],
    kneeL: [x - 0.15, y + 0.42, z + 0.24],
    kneeR: [x + 0.15, y + 0.42, z + 0.24],
  };
}

function normalizeParts(parts) {
  const range = aggregateBounds(parts);
  const offsetX = -(range.min[0] + range.max[0]) / 2;
  const offsetY = -range.min[1];
  const offsetZ = -(range.min[2] + range.max[2]) / 2;
  for (const prim of parts) {
    for (let i = 0; i < prim.positions.length; i += 3) {
      prim.positions[i] += offsetX;
      prim.positions[i + 1] += offsetY;
      prim.positions[i + 2] += offsetZ;
    }
  }
  return parts;
}

function motorcycle() {
  const p = [];
  wheel(p, 0, -0.58, 0.22, 0.11);
  wheel(p, 0, 0.52, 0.22, 0.12);
  p.push(
    cylinderBetween([-0.08, 0.23, -0.58], [-0.13, 0.74, -0.42], 0.018, 10, MAT.metal),
    cylinderBetween([0.08, 0.23, -0.58], [0.13, 0.74, -0.42], 0.018, 10, MAT.metal),
    cylinderBetween([-0.09, 0.23, 0.52], [-0.2, 0.46, 0.14], 0.018, 10, MAT.metal),
    cylinderBetween([0.09, 0.23, 0.52], [0.2, 0.46, 0.14], 0.018, 10, MAT.metal),
    cylinderBetween([0, 0.35, 0.48], [0, 0.53, -0.2], 0.025, 10, MAT.metal),
    cylinderBetween([0, 0.38, -0.47], [0, 0.58, 0.2], 0.022, 10, MAT.metal),
    taperedBox([0, 0.5, -0.12], [0.34, 0.16, 0.62], [0.24, 0.18, 0.5], MAT.motoOrange, [0, -0.03]),
    taperedBox([0, 0.62, -0.42], [0.42, 0.18, 0.24], [0.28, 0.16, 0.16], MAT.warmCream, [0, -0.02]),
    ellipsoid([0, 0.55, -0.02], [0.19, 0.13, 0.32], MAT.motoOrange, 12, 5),
    box([0, 0.72, 0.25], [0.34, 0.09, 0.42], MAT.rubber),
    box([0, 0.57, 0.48], [0.42, 0.12, 0.12], MAT.red),
    diamond([0, 0.64, -0.58], 0.07, MAT.light),
    cylinderX([0, 0.78, -0.47], 0.022, 0.5, 10, MAT.chrome),
    cylinderBetween([0.18, 0.39, 0.48], [0.26, 0.36, -0.16], 0.035, 12, MAT.chrome),
  );
  const pose = rider(p, { y: 0.02, z: 0.08, lean: -0.7, helmet: MAT.warmCream });
  p.push(
    cylinderBetween(pose.shoulderL, [-0.22, 0.78, -0.48], 0.028, 8, MAT.jacket),
    cylinderBetween(pose.shoulderR, [0.22, 0.78, -0.48], 0.028, 8, MAT.jacket),
    cylinderBetween(pose.hipL, [-0.18, 0.38, 0.18], 0.035, 8, MAT.pants),
    cylinderBetween([-0.18, 0.38, 0.18], [-0.15, 0.36, -0.16], 0.032, 8, MAT.pants),
    cylinderBetween(pose.hipR, [0.18, 0.38, 0.18], 0.035, 8, MAT.pants),
    cylinderBetween([0.18, 0.38, 0.18], [0.15, 0.36, -0.16], 0.032, 8, MAT.pants),
  );
  return normalizeParts(p);
}

function bike() {
  const p = [];
  wheel(p, 0, -0.6, 0.25, 0.055, 0.07);
  wheel(p, 0, 0.6, 0.25, 0.055, 0.07);
  const bb = [0, 0.38, 0.08];
  const seat = [0, 0.72, 0.2];
  const head = [0, 0.74, -0.43];
  p.push(
    cylinderBetween([0, 0.25, -0.6], head, 0.018, 8, MAT.bikeBlue),
    cylinderBetween([0, 0.25, 0.6], seat, 0.018, 8, MAT.bikeBlue),
    cylinderBetween(seat, head, 0.018, 8, MAT.bikeBlue),
    cylinderBetween(bb, head, 0.018, 8, MAT.bikeBlue),
    cylinderBetween(bb, seat, 0.018, 8, MAT.bikeBlue),
    cylinderBetween(bb, [0, 0.25, 0.6], 0.018, 8, MAT.bikeBlue),
    cylinderBetween(bb, [0, 0.25, -0.6], 0.015, 8, MAT.metal),
    cylinderX([0, 0.8, -0.55], 0.018, 0.46, 8, MAT.chrome),
    box([0, 0.76, 0.24], [0.32, 0.07, 0.18], MAT.rubber),
    cylinderX([0, 0.38, 0.08], 0.055, 0.18, 12, MAT.chrome),
  );
  const pose = rider(p, { y: 0.06, z: 0.06, lean: -0.3, helmet: MAT.bikeBlue, compact: true });
  p.push(
    cylinderBetween(pose.shoulderL, [-0.2, 0.8, -0.55], 0.026, 8, MAT.jacket),
    cylinderBetween(pose.shoulderR, [0.2, 0.8, -0.55], 0.026, 8, MAT.jacket),
    cylinderBetween(pose.hipL, [-0.16, 0.43, 0.06], 0.031, 8, MAT.pants),
    cylinderBetween([-0.16, 0.43, 0.06], [-0.06, 0.34, -0.08], 0.028, 8, MAT.pants),
    cylinderBetween(pose.hipR, [0.14, 0.42, 0.16], 0.031, 8, MAT.pants),
    cylinderBetween([0.14, 0.42, 0.16], [0.07, 0.34, 0.29], 0.028, 8, MAT.pants),
  );
  return normalizeParts(p);
}

function ebike() {
  const p = [];
  wheel(p, 0, -0.5, 0.2, 0.105);
  wheel(p, 0, 0.48, 0.2, 0.115);
  p.push(
    taperedBox([0, 0.34, -0.02], [0.34, 0.15, 0.95], [0.28, 0.16, 0.78], MAT.ebikeGreen),
    box([0, 0.52, 0.12], [0.36, 0.12, 0.48], MAT.rubber),
    taperedBox([0, 0.58, -0.38], [0.42, 0.26, 0.18], [0.3, 0.3, 0.14], MAT.ebikeGreen, [0, -0.02]),
    box([0, 0.73, 0.19], [0.34, 0.08, 0.38], MAT.rubber),
    box([0, 0.46, 0.58], [0.36, 0.18, 0.16], MAT.red),
    cylinderBetween([-0.09, 0.21, -0.5], [-0.17, 0.75, -0.45], 0.02, 10, MAT.metal),
    cylinderBetween([0.09, 0.21, -0.5], [0.17, 0.75, -0.45], 0.02, 10, MAT.metal),
    cylinderX([0, 0.8, -0.54], 0.022, 0.5, 10, MAT.chrome),
    diamond([0, 0.61, -0.51], 0.06, MAT.light),
  );
  const pose = rider(p, { y: 0.02, z: 0.12, lean: -0.35, helmet: MAT.ebikeGreen, compact: true });
  p.push(
    cylinderBetween(pose.shoulderL, [-0.22, 0.8, -0.54], 0.026, 8, MAT.jacket),
    cylinderBetween(pose.shoulderR, [0.22, 0.8, -0.54], 0.026, 8, MAT.jacket),
    cylinderBetween(pose.hipL, [-0.16, 0.42, 0.18], 0.032, 8, MAT.pants),
    cylinderBetween(pose.hipR, [0.16, 0.42, 0.18], 0.032, 8, MAT.pants),
  );
  return normalizeParts(p);
}

function car() {
  const p = [];
  p.push(
    taperedBox([0, 0.31, 0.02], [0.96, 0.24, 1.58], [0.82, 0.24, 1.42], MAT.carOrange, [0, -0.03]),
    taperedBox([0, 0.49, -0.04], [0.84, 0.22, 1.16], [0.72, 0.18, 0.96], MAT.carWhite, [0, -0.02]),
    taperedBox([0, 0.69, -0.08], [0.62, 0.2, 0.72], [0.46, 0.22, 0.48], MAT.glass, [0, -0.03]),
    box([0, 0.56, -0.58], [0.56, 0.04, 0.2], MAT.glass),
    box([0, 0.55, 0.35], [0.5, 0.04, 0.18], MAT.glass),
    box([-0.49, 0.48, -0.1], [0.08, 0.11, 0.52], MAT.glass),
    box([0.49, 0.48, -0.1], [0.08, 0.11, 0.52], MAT.glass),
    box([-0.27, 0.37, -0.82], [0.18, 0.08, 0.04], MAT.light),
    box([0.27, 0.37, -0.82], [0.18, 0.08, 0.04], MAT.light),
    box([-0.28, 0.35, 0.82], [0.18, 0.08, 0.04], MAT.red),
    box([0.28, 0.35, 0.82], [0.18, 0.08, 0.04], MAT.red),
  );
  for (const x of [-0.52, 0.52]) {
    for (const z of [-0.48, 0.5]) {
      p.push(
        cylinderX([x, 0.16, z], 0.16, 0.14, 18, MAT.tire),
        cylinderX([x, 0.16, z], 0.075, 0.16, 12, MAT.chrome),
      );
    }
  }
  return normalizeParts(p);
}

function walker() {
  const p = [];
  p.push(
    ellipsoid([0, 1.2, -0.08], [0.13, 0.14, 0.13], MAT.warmCream, 10, 5),
    ellipsoid([0, 0.86, 0], [0.17, 0.27, 0.12], MAT.motoOrange, 10, 5),
    box([0, 0.58, 0.04], [0.26, 0.12, 0.16], MAT.pants),
    cylinderBetween([-0.14, 0.96, -0.02], [-0.28, 0.68, -0.18], 0.035, 8, MAT.jacket),
    cylinderBetween([0.14, 0.96, 0.02], [0.28, 0.68, 0.18], 0.035, 8, MAT.jacket),
    cylinderBetween([-0.09, 0.52, 0.01], [-0.18, 0.22, -0.18], 0.04, 8, MAT.pants),
    cylinderBetween([0.09, 0.52, 0.06], [0.16, 0.22, 0.18], 0.04, 8, MAT.pants),
    box([-0.2, 0.045, -0.24], [0.24, 0.09, 0.16], MAT.tire),
    box([0.17, 0.045, 0.24], [0.24, 0.09, 0.16], MAT.tire),
    box([0, 0.95, 0.14], [0.24, 0.32, 0.1], MAT.bikeBlue),
    diamond([0, 1.04, -0.22], 0.045, MAT.light),
  );
  return normalizeParts(p);
}

function makeGltf(name, primitives) {
  const materials = [
    material("tire_black", COLORS.tire),
    material("rubber_dark", COLORS.rubber),
    material("metal_silver", COLORS.metal, 0.25),
    material("chrome_warm", COLORS.chrome, 0.35, 0.42),
    material("moto_orange", COLORS.motoOrange),
    material("warm_cream", COLORS.warmCream),
    material("bike_blue", COLORS.bikeBlue),
    material("ebike_green", COLORS.ebikeGreen),
    material("car_white", COLORS.carWhite),
    material("car_orange", COLORS.carOrange),
    material("glass_blue", COLORS.glass, 0, 0.18),
    material("rider_jacket", COLORS.jacket),
    material("rider_pants", COLORS.pants),
    material("skin_warm", COLORS.skin),
    material("tail_red", COLORS.red),
    material("headlight_warm", COLORS.light),
  ];
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  const meshPrimitives = primitives.map(prim => {
    const positionAccessor = pushAccessor(chunks, bufferViews, accessors, new Float32Array(prim.positions), 34962, 5126, "VEC3", bounds(prim.positions));
    const normalAccessor = pushAccessor(chunks, bufferViews, accessors, new Float32Array(prim.normals), 34962, 5126, "VEC3");
    const indexAccessor = pushAccessor(chunks, bufferViews, accessors, new Uint16Array(prim.indices), 34963, 5123, "SCALAR");
    return {
      attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
      indices: indexAccessor,
      material: prim.materialIndex,
    };
  });
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const buffer = Buffer.concat(chunks, totalLength);
  return {
    asset: { version: "2.0", generator: "Codex procedural low-poly travel models v2" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name: `${name}_mesh`, primitives: meshPrimitives }],
    materials,
    buffers: [{ byteLength: buffer.byteLength, uri: `data:application/octet-stream;base64,${buffer.toString("base64")}` }],
    bufferViews,
    accessors,
  };
}

function pushAccessor(chunks, bufferViews, accessors, typed, target, componentType, type, range) {
  const byteLengthSoFar = chunks.reduce((sum, c) => sum + c.length, 0);
  const padding = (4 - (byteLengthSoFar % 4)) % 4;
  if (padding) chunks.push(Buffer.alloc(padding));
  const byteOffset = chunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  chunks.push(bytes);
  const viewIndex = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
  const accessor = {
    bufferView: viewIndex,
    componentType,
    count: typed.length / (type === "VEC3" ? 3 : 1),
    type,
  };
  if (range) Object.assign(accessor, range);
  const accessorIndex = accessors.length;
  accessors.push(accessor);
  return accessorIndex;
}

function bounds(values) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      min[j] = Math.min(min[j], values[i + j]);
      max[j] = Math.max(max[j], values[i + j]);
    }
  }
  return { min, max };
}

function aggregateBounds(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const prim of parts) {
    const range = bounds(prim.positions);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], range.min[i]);
      max[i] = Math.max(max[i], range.max[i]);
    }
  }
  return { min, max };
}

const models = {
  "motorcycle-rider.gltf": ["motorcycle_rider", motorcycle()],
  "bike-rider.gltf": ["bike_rider", bike()],
  "ebike-rider.gltf": ["ebike_rider", ebike()],
  "car.gltf": ["car", car()],
  "walker.gltf": ["walker", walker()],
};

for (const [file, [name, parts]] of Object.entries(models)) {
  const gltf = makeGltf(name, parts);
  writeFileSync(join(outDir, file), `${JSON.stringify(gltf)}\n`);
  const range = aggregateBounds(parts);
  console.log(
    `generated ${file} bounds min=${range.min.map(n => n.toFixed(3)).join(",")} max=${range.max.map(n => n.toFixed(3)).join(",")}`,
  );
}
