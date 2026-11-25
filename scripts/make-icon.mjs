// Generates build/icon.png (256×256): REA's mark, a rounded indigo square with a white diamond.
// Pure Node (zlib) so no image tooling is required.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const S = 256;
const px = Buffer.alloc(S * S * 4);
const set = (x, y, r, g, b, a) => { const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const rad = 56, cx = Math.min(Math.max(x, rad), S - 1 - rad), cy = Math.min(Math.max(y, rad), S - 1 - rad);
  const inside = (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  if (!inside) { set(x, y, 0, 0, 0, 0); continue; }
  const d = Math.abs(x - 128) + Math.abs(y - 128);
  const t = y / S;
  if (d < 70 && d > 40) set(x, y, 255, 255, 255, 255);
  else if (d <= 22) set(x, y, 255, 255, 255, 255);
  else set(x, y, Math.round(79 - 30 * t), Math.round(91 - 40 * t), Math.round(213 - 60 * t), 255);
}
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
mkdirSync("build", { recursive: true });
writeFileSync("build/icon.png", png);
mkdirSync("public", { recursive: true });
writeFileSync("public/favicon.png", png);
console.log("wrote build/icon.png and public/favicon.png");
