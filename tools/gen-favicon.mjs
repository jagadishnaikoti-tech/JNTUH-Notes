// ---------------------------------------------------------------------------
// Generates the site favicon assets from a single original vector-ish design:
// an amber rounded square (brand accent #d97706) carrying a simple open-book
// glyph (white), matching the BookOpen mark used in the sidebar/footer.
//
// Outputs (written to public/):
//   favicon.svg          - scalable, primary icon
//   favicon.ico          - 32x32, legacy / default browser request
//   apple-touch-icon.png - 180x180 for iOS home-screen bookmarks
//
// Pure Node (zlib only) - no third-party dependencies. Run with:
//   node tools/gen-favicon.mjs
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

const AMBER = [0xd9, 0x77, 0x06]; // --color-accent
const INK = [0x1c, 0x19, 0x17]; // --color-on-accent
const PAPER = [0xff, 0xff, 0xff];

// --- geometry (normalized 0..1) --------------------------------------------
const CORNER_R = 0.22;
const MARGIN = 0.02;

/** Signed distance (<=0 inside) for a rounded square spanning [0,1]^2. */
function insideRounded(x, y) {
  const r = Math.max(0.0001, CORNER_R - MARGIN);
  const qx = Math.max(0, Math.abs(x - 0.5) - (0.5 - MARGIN - r));
  const qy = Math.max(0, Math.abs(y - 0.5) - (0.5 - MARGIN - r));
  return Math.sqrt(qx * qx + qy * qy) - r <= 0;
}

// Open-book pages: two quadrilaterals with a small gap at the spine.
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

/**
 * Render one RGBA pixel (0..255 x4) at normalized (x, y).
 * Uses 4x4 supersampling for antialiased edges.
 */
function sample(size, px, py) {
  const SS = 4;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let sy = 0; sy < SS; sy += 1) {
    for (let sx = 0; sx < SS; sx += 1) {
      const x = (px + (sx + 0.5) / SS) / size;
      const y = (py + (sy + 0.5) / SS) / size;
      if (!insideRounded(x, y)) continue;
      let color = AMBER;
      if (pointInQuad(x, y, LEFT_PAGE) || pointInQuad(x, y, RIGHT_PAGE)) {
        color = PAPER;
      } else {
        const d = x - 0.5;
        // subtle spine shadow for depth
        if (Math.abs(d) < 0.02) color = INK;
      }
      r += color[0];
      g += color[1];
      b += color[2];
      a += 255;
    }
  }
  const total = SS * SS;
  if (a === 0) return [0, 0, 0, 0];
  // premultiplied average, then unpremultiply
  const ar = r / total;
  const ag = g / total;
  const ab = b / total;
  const aa = a / total;
  const alpha = aa / 255;
  return [
    Math.round(ar / alpha),
    Math.round(ag / alpha),
    Math.round(ab / alpha),
    Math.round(aa),
  ];
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = sample(size, x, y);
      const i = (y * size + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
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

function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- ICO encoder (single 32x32, 32-bit BMP) --------------------------------
function encodeIco(rgba, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = size; // width
  entry[1] = size; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp

  const rowSize = size * 4;
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0);
  bmpHeader.writeInt32LE(size, 4);
  bmpHeader.writeInt32LE(size * 2, 8); // height doubled (XOR + AND)
  bmpHeader.writeUInt16LE(1, 12);
  bmpHeader.writeUInt16LE(32, 14);

  const pixels = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y += 1) {
    const srcY = size - 1 - y; // BMP bottom-up
    for (let x = 0; x < size; x += 1) {
      const s = (srcY * size + x) * 4;
      const d = y * rowSize + x * 4;
      pixels[d] = rgba[s + 2]; // blue
      pixels[d + 1] = rgba[s + 1]; // green
      pixels[d + 2] = rgba[s]; // red
      pixels[d + 3] = rgba[s + 3]; // alpha
    }
  }

  // AND mask: 1bpp, rows padded to 4 bytes. All zero (alpha handles it).
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size);

  const image = Buffer.concat([bmpHeader, pixels, mask]);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(22, 12); // offset

  return Buffer.concat([header, entry, image]);
}

// --- SVG --------------------------------------------------------------------
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="JNTUH Notes">
  <rect x="0.5" y="0.5" width="63" height="63" rx="14" fill="#d97706"/>
  <path d="M31.4 22.2c-4.6-2.2-11.2-2.9-16.4-2.1-1 .1-1.6 1-1.6 2v22.3c0 1.2 1 2.1 2.2 2 4.8-.6 10.9.1 15.8 2.3V22.2z" fill="#ffffff"/>
  <path d="M32.6 22.2c4.6-2.2 11.2-2.9 16.4-2.1 1 .1 1.6 1 1.6 2v22.3c0 1.2-1 2.1-2.2 2-4.8-.6-10.9.1-15.8 2.3V22.2z" fill="#ffffff"/>
  <path d="M31.4 22.2v26.5c-.3-.1-.6-.2-.9-.3V22c.3.1.6.1.9.2z" fill="#1c1917" opacity="0.55"/>
</svg>
`;

writeFileSync(join(PUBLIC, "favicon.svg"), SVG, "utf8");
writeFileSync(join(PUBLIC, "favicon.ico"), encodeIco(render(32), 32));
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), encodePng(render(180), 180));
// A crisp 32px PNG is handy for manifests / any explicit reference.
writeFileSync(join(PUBLIC, "favicon-32.png"), encodePng(render(32), 32));

console.log("favicon.svg, favicon.ico, favicon-32.png, apple-touch-icon.png written to public/");
