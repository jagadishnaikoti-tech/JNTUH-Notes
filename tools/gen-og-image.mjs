// ---------------------------------------------------------------------------
// Generates public/og-image.png: a 1200x630 social-sharing card using the real
// brand identity (amber open-book mark + "JNTUH NOTES" wordmark on parchment).
// Pure Node (zlib only) - no third-party dependencies, no fabricated imagery.
//
// Run with: node tools/gen-og-image.mjs
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

const W = 1200;
const H = 630;

const PARCHMENT = [0xff, 0xfb, 0xeb];
const AMBER = [0xd9, 0x77, 0x06];
const INK = [0x1c, 0x19, 0x17];
const WHITE = [0xff, 0xff, 0xff];

// --- 5x7 bitmap font (only the glyphs this wordmark needs) ------------------
const FONT = {
  J: [".###.", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

const WORDMARK = "JNTUH NOTES";
const S = 11; // font pixel scale
const GLYPH_W = 5 * S;
const GLYPH_H = 7 * S;
const ADVANCE = GLYPH_W + S;

const TEXT_W = WORDMARK.length * ADVANCE - S;
const TILE = 150;
const GAP = 46;
const COMPOSITION_W = TILE + GAP + TEXT_W;
const START_X = Math.round((W - COMPOSITION_W) / 2);
const TILE_X = START_X;
const TILE_Y = Math.round((H - TILE) / 2);
const TEXT_X = START_X + TILE + GAP;
const TEXT_Y = Math.round((H - GLYPH_H) / 2);

// --- logo geometry (normalized tile coords) --------------------------------
const CORNER_R = 0.22;
const MARGIN = 0.02;
const LEFT_PAGE = [
  [0.235, 0.4],
  [0.485, 0.345],
  [0.485, 0.665],
  [0.235, 0.605],
];
const RIGHT_PAGE = [
  [0.515, 0.345],
  [0.765, 0.4],
  [0.765, 0.605],
  [0.515, 0.665],
];

function insideRounded(x, y) {
  const r = Math.max(0.0001, CORNER_R - MARGIN);
  const qx = Math.max(0, Math.abs(x - 0.5) - (0.5 - MARGIN - r));
  const qy = Math.max(0, Math.abs(y - 0.5) - (0.5 - MARGIN - r));
  return Math.sqrt(qx * qx + qy * qy) - r <= 0;
}

function pointInQuad(px, py, quad) {
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % quad.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Return [r,g,b] for a sample point or null for background. */
function colorAt(x, y) {
  // Logo tile.
  if (x >= TILE_X && x < TILE_X + TILE && y >= TILE_Y && y < TILE_Y + TILE) {
    const u = (x - TILE_X) / TILE;
    const v = (y - TILE_Y) / TILE;
    if (insideRounded(u, v)) {
      if (pointInQuad(u, v, LEFT_PAGE) || pointInQuad(u, v, RIGHT_PAGE)) {
        return WHITE;
      }
      if (Math.abs(u - 0.5) < 0.02) return INK;
      return AMBER;
    }
  }

  // Wordmark glyphs.
  if (
    x >= TEXT_X &&
    x < TEXT_X + TEXT_W &&
    y >= TEXT_Y &&
    y < TEXT_Y + GLYPH_H
  ) {
    const col = Math.floor((x - TEXT_X) / ADVANCE);
    const within = (x - TEXT_X) - col * ADVANCE;
    if (within < GLYPH_W) {
      const gx = Math.floor(within / S);
      const gy = Math.floor((y - TEXT_Y) / S);
      const glyph = FONT[WORDMARK[col]];
      if (glyph && glyph[gy] && glyph[gy][gx] === "#") return INK;
    }
  }

  // Amber rule under the wordmark.
  const ruleY = TEXT_Y + GLYPH_H + 30;
  if (y >= ruleY && y < ruleY + 8 && x >= TEXT_X && x < TEXT_X + TEXT_W) {
    return AMBER;
  }

  return null;
}

function render() {
  const buf = Buffer.alloc(W * H * 4);
  const SS = 2;
  for (let py = 0; py < H; py += 1) {
    for (let px = 0; px < W; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          const c = colorAt(x, y) || PARCHMENT;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * W + px) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

// --- PNG encoder -----------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rowBytes = w * 4;
  const raw = Buffer.alloc(h * (rowBytes + 1));
  for (let y = 0; y < h; y += 1) {
    raw[y * (rowBytes + 1)] = 0; // filter: none
    rgba.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(PUBLIC, "og-image.png"), encodePng(render(), W, H));
console.log("og-image.png (1200x630) written to public/");
