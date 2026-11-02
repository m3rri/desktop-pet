// 기본 캐릭터(곰)의 상태별 이미지를 만든다. 외부 이미지 편집기 없이 코드로 그림.
//   idle.png  : 정지 PNG
//   walk.png  : APNG (반복)
//   click.gif : GIF  (1회 재생)
//   sleep.png : APNG (반복)
//   drag.png  : 정지 PNG
// 세 가지 형식(PNG, APNG, GIF)을 섞은 이유: 앱이 모든 형식을 불러오는지 확인하기 위해.
//
// 사용법: node scripts/make-sample-pet.js [출력 폴더]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const W = 128, H = 128;
const OUT = process.argv[2] || path.join(__dirname, '..', 'assets', 'pets', 'default');

// ---------- 래스터 ----------
const OUTLINE = [70, 50, 40], FUR = [255, 196, 120], DARK = [50, 35, 30],
  WHITE = [255, 255, 255], CHEEK = [255, 140, 140];

function newCanvas() { return Buffer.alloc(W * H * 4); }

function blend(px, x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const da = px[i + 3] / 255, sa = Math.min(1, a);
  const oa = sa + da * (1 - sa);
  [r, g, b].forEach((c, k) => { px[i + k] = Math.round((c * sa + px[i + k] * da * (1 - sa)) / (oa || 1)); });
  px[i + 3] = Math.round(oa * 255);
}

// 가장자리를 1px 부드럽게 처리한 타원
function ellipse(px, cx, cy, rx, ry, color) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(W - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
    blend(px, x, y, color, Math.max(0, Math.min(1, (1 - d) * Math.min(rx, ry) + 0.5)));
  }
}

// 두꺼운 선 (원을 찍어서 그림)
function line(px, x0, y0, x1, y1, r, color) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
  for (let i = 0; i <= n; i++) ellipse(px, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r, r, color);
}

// ---------- 곰 ----------
// 좌표는 하단 중앙(64, 118)을 원점으로 한 값. k=0.8로 줄여 점프·Z가 들어갈 위쪽 여백을 확보.
function drawBear(px, { dy = 0, sx = 1, sy = 1, eyes = 'open', look = 0, mouth = 'small', feet = null } = {}) {
  const k = 0.8;
  const X = (lx) => 64 + k * sx * lx, Y = (ly) => 118 + dy + k * sy * ly;
  const E = (lx, ly, rx, ry, c) => ellipse(px, X(lx), Y(ly), k * sx * rx, k * sy * ry, c);

  if (feet) { // 걷기: 발을 번갈아 들어 올림
    E(-22, -4 + feet[0], 12, 8, OUTLINE); E(-22, -4 + feet[0], 9.5, 5.5, FUR);
    E(22, -4 + feet[1], 12, 8, OUTLINE); E(22, -4 + feet[1], 9.5, 5.5, FUR);
  }
  E(-26, -82, 12, 16, OUTLINE); E(26, -82, 12, 16, OUTLINE);   // 귀
  E(-26, -80, 8, 11, FUR); E(26, -80, 8, 11, FUR);
  E(0, -44, 50, 44, OUTLINE); E(0, -44, 47, 41, FUR);          // 몸통

  const ex = (side) => side * 16 + look;
  if (eyes === 'open') {
    for (const s of [-1, 1]) { E(ex(s), -48, 5, 7, DARK); E(ex(s) - 2, -51, 1.8, 2.2, WHITE); }
  } else if (eyes === 'surprised') {
    for (const s of [-1, 1]) { E(ex(s), -50, 7, 9, DARK); E(ex(s) - 2, -54, 2.5, 3, WHITE); }
  } else if (eyes === 'closed') {
    for (const s of [-1, 1]) line(px, X(ex(s) - 6), Y(-46), X(ex(s) + 6), Y(-46), 1.4, DARK);
  } else if (eyes === 'happy') { // ^ ^
    for (const s of [-1, 1]) {
      line(px, X(ex(s) - 6), Y(-44), X(ex(s)), Y(-52), 1.4, DARK);
      line(px, X(ex(s)), Y(-52), X(ex(s) + 6), Y(-44), 1.4, DARK);
    }
  }
  E(-26 + look, -34, 7, 4, CHEEK); E(26 + look, -34, 7, 4, CHEEK);
  if (mouth === 'small') E(look, -36, 4, 3, DARK);
  else if (mouth === 'open') { E(look, -34, 6, 7, DARK); E(look, -31, 3.5, 3, [230, 100, 100]); }
}

function drawZ(px, x, y, s, alpha = 1) {
  const c = [90, 110, 200];
  const L = (a, b, c2, d) => line(px, x + a * s, y + b * s, x + c2 * s, y + d * s, 1.3 * alpha + 0.2, c);
  L(0, 0, 1, 0); L(1, 0, 0, 1); L(0, 1, 1, 1);
}

function frame(draw) { const px = newCanvas(); draw(px); return px; }

// ---------- 인코딩 ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function idat(px) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  return zlib.deflateSync(raw);
}
function ihdr() {
  const b = Buffer.alloc(13); b.writeUInt32BE(W, 0); b.writeUInt32BE(H, 4); b[8] = 8; b[9] = 6; return b;
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePNG(px) {
  return Buffer.concat([SIG, chunk('IHDR', ihdr()), chunk('IDAT', idat(px)), chunk('IEND', Buffer.alloc(0))]);
}

// APNG: acTL(애니메이션 정보) + 프레임마다 fcTL(위치·지연) + IDAT/fdAT(이미지)
function encodeAPNG(frames, delayMs) {
  const parts = [SIG, chunk('IHDR', ihdr())];
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4); // 0 = 무한 반복
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((px, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(W, 4); fctl.writeUInt32BE(H, 8);
    fctl.writeUInt32BE(0, 12); fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(delayMs, 20); fctl.writeUInt16BE(1000, 22);
    fctl[24] = 1; // dispose: 다음 프레임 전에 지움
    fctl[25] = 0; // blend: 덮어쓰기
    parts.push(chunk('fcTL', fctl));
    const data = idat(px);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function encodeGIF(frames, delayMs) {
  const gif = GIFEncoder();
  for (const px of frames) {
    const rgba = new Uint8Array(px);
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(rgba, palette, 'rgba4444');
    const transparentIndex = Math.max(0, palette.findIndex((c) => c[3] === 0));
    gif.writeFrame(index, W, H, { palette, delay: delayMs, transparent: true, transparentIndex, dispose: 2 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

// ---------- 상태별 이미지 ----------
fs.mkdirSync(OUT, { recursive: true });
const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log(name, buf.length, 'bytes'); };

write('idle.png', encodePNG(frame((px) => drawBear(px))));

// 걷기: 바라보는 방향(오른쪽)으로 눈을 치우치고, 발을 번갈아 들며 위아래로 흔들림
write('walk.png', encodeAPNG([
  [0, -5, 0], [-2, -2, -2], [0, 0, -5], [-2, -2, -2],
].map(([dy, f0, f1]) => frame((px) => drawBear(px, { dy, look: 5, feet: [f0, f1] }))), 140));

// 클릭: 웅크렸다가 점프 후 착지 (1회 재생)
write('click.gif', encodeGIF([
  { dy: 4, sx: 1.08, sy: 0.9 },
  { dy: -10, sx: 0.96, sy: 1.06, eyes: 'happy' },
  { dy: -22, eyes: 'happy', mouth: 'open' },
  { dy: -26, eyes: 'happy', mouth: 'open' },
  { dy: -18, eyes: 'happy' },
  { dy: -6, sx: 0.97, sy: 1.04, eyes: 'happy' },
  { dy: 4, sx: 1.1, sy: 0.88 },
  { dy: 0 },
].map((o) => frame((px) => drawBear(px, o))), 70));

// 잠자기: 눈 감고 숨쉬기 + Z가 떠오름
write('sleep.png', encodeAPNG([0, 1, 2, 3].map((i) => frame((px) => {
  drawBear(px, { eyes: 'closed', mouth: 'none', sy: i % 2 ? 1.02 : 0.98, dy: i % 2 ? -1 : 0 });
  drawZ(px, 92, 34 - i * 4, 6 + i);
  if (i >= 2) drawZ(px, 106, 20 - (i - 2) * 4, 4 + (i - 2), 0.7);
})), 450));

write('drag.png', encodePNG(frame((px) => drawBear(px, { eyes: 'surprised', mouth: 'open', sy: 1.04 }))));

fs.writeFileSync(path.join(OUT, 'pet.json'), JSON.stringify({
  name: '곰',
  size: 128,
  speed: 80,
  facing: 'right',
  sleepAfterSec: 600,
}, null, 2) + '\n');
console.log('pet.json');

// 트레이 아이콘
const tray = path.join(OUT, '..', '..', 'tray.png');
fs.copyFileSync(path.join(OUT, 'idle.png'), tray);
console.log('tray.png');
