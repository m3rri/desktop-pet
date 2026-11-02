// 외부 라이브러리 없이 투명 배경 PNG(128x128) 캐릭터를 만든다.
// 실제 이미지가 준비되면 assets/pet.png 를 교체하면 된다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 128, H = 128;
const px = Buffer.alloc(W * H * 4); // RGBA, 기본값 투명

function blend(x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const da = px[i + 3] / 255, sa = Math.min(1, a);
  const oa = sa + da * (1 - sa);
  for (const [k, c] of [[0, r], [1, g], [2, b]]) {
    px[i + k] = Math.round((c * sa + px[i + k] * da * (1 - sa)) / (oa || 1));
  }
  px[i + 3] = Math.round(oa * 255);
}
// 가장자리를 1px 부드럽게 처리한 타원
function ellipse(cx, cy, rx, ry, color) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
    const edge = (1 - d) * Math.min(rx, ry);
    blend(x, y, color, Math.max(0, Math.min(1, edge + 0.5)));
  }
}

ellipse(64, 74, 50, 44, [70, 50, 40]);     // 외곽선
ellipse(64, 74, 47, 41, [255, 196, 120]);  // 몸통
ellipse(38, 36, 12, 16, [70, 50, 40]);     // 왼쪽 귀
ellipse(90, 36, 12, 16, [70, 50, 40]);     // 오른쪽 귀
ellipse(38, 38, 8, 11, [255, 196, 120]);
ellipse(90, 38, 8, 11, [255, 196, 120]);
ellipse(64, 74, 47, 41, [255, 196, 120]);  // 귀 아래 몸통 덮기
ellipse(48, 70, 5, 7, [50, 35, 30]);       // 눈
ellipse(80, 70, 5, 7, [50, 35, 30]);
ellipse(46, 67, 1.8, 2.2, [255, 255, 255]);
ellipse(78, 67, 1.8, 2.2, [255, 255, 255]);
ellipse(38, 84, 7, 4, [255, 140, 140]);    // 볼
ellipse(90, 84, 7, 4, [255, 140, 140]);
ellipse(64, 82, 4, 3, [50, 35, 30]);       // 입

// PNG 인코딩
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);

const out = path.join(__dirname, '..', 'assets', 'pet.png');
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log('created', out);
