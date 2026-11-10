#!/usr/bin/env node
/**
 * 生成应用图标源图（1024×1024 PNG），再交给 `tauri icon` 切出全套尺寸。
 * 不依赖任何图像库：手写最小 PNG 编码器，4× 超采样做抗锯齿。
 *
 * 用法：node scripts/make-icon.mjs [输出路径]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const SIZE = 1024;
const SS = 4; // 超采样倍数
const OUT = path.resolve(process.argv[2] ?? "app-icon.png");

// ---------------------------------------------------------------- PNG 编码
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 绘制
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const BG = hex("#14142a");
const KEY = hex("#f4f4fa");
const BLACK = hex("#0b0b16");
const ACCENT = hex("#6c5ce7");

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** 返回某点的 [r,g,b,a] */
function shade(x, y) {
  // 外圈强调色描边
  if (
    inRoundRect(x, y, 22, 22, SIZE - 22, SIZE - 22, 208) &&
    !inRoundRect(x, y, 40, 40, SIZE - 40, SIZE - 40, 192)
  ) {
    return [...ACCENT, 255];
  }
  if (!inRoundRect(x, y, 22, 22, SIZE - 22, SIZE - 22, 208)) return [0, 0, 0, 0];
  if (!inRoundRect(x, y, 40, 40, SIZE - 40, SIZE - 40, 192)) return [...BG, 255];

  const top = 296;
  const bottom = 808;
  const left = 168;
  const right = 856;

  // 黑键压在白键之上，必须先判定
  const bw = 96;
  for (const center of [left + 172, left + 344, left + 516]) {
    if (inRoundRect(x, y, center - bw / 2, top, center + bw / 2, top + 290, 10)) {
      return [...BLACK, 255];
    }
  }

  // 白键
  const slot = (right - left) / 4;
  for (let i = 0; i < 4; i++) {
    const x0 = left + i * slot + 6;
    const x1 = left + i * slot + slot - 6;
    if (inRoundRect(x, y, x0, top, x1, bottom, 14)) return [...KEY, 255];
  }

  return [...BG, 255];
}

// ---------------------------------------------------------------- 渲染
const big = SIZE * SS;
const acc = new Float64Array(SIZE * SIZE * 4);

for (let y = 0; y < big; y++) {
  const ty = (y + 0.5) / SS;
  for (let x = 0; x < big; x++) {
    const tx = (x + 0.5) / SS;
    const [r, g, b, a] = shade(tx, ty);
    const px = Math.floor(y / SS) * SIZE + Math.floor(x / SS);
    acc[px * 4] += r * a;
    acc[px * 4 + 1] += g * a;
    acc[px * 4 + 2] += b * a;
    acc[px * 4 + 3] += a;
  }
}

const out = Buffer.alloc(SIZE * SIZE * 4);
const samples = SS * SS;
for (let i = 0; i < SIZE * SIZE; i++) {
  const a = acc[i * 4 + 3];
  const alpha = a / samples;
  out[i * 4 + 3] = Math.round(alpha);
  if (a > 0) {
    out[i * 4] = Math.round(acc[i * 4] / a);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / a);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / a);
  }
}

fs.writeFileSync(OUT, encodePng(SIZE, SIZE, out));
console.log(`已生成 ${OUT}`);
