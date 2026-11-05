// 캐릭터 이미지 생성 스크립트용: RGBA 버퍼를 PNG / APNG / ICO로 인코딩
const zlib = require('zlib');

const W = 128, H = 128;

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
function idat(px, w = W, h = H) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return zlib.deflateSync(raw);
}
function ihdr(w = W, h = H) {
  const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 6; return b;
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePNG(px, w = W, h = H) {
  return Buffer.concat([SIG, chunk('IHDR', ihdr(w, h)), chunk('IDAT', idat(px, w, h)), chunk('IEND', Buffer.alloc(0))]);
}

// Windows 아이콘(.ico): 크기별 PNG를 그대로 담는 형식 (Windows Vista 이상)
//   images: [{ size, png }]  size는 16~256
function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; // 0 = 256
    e.writeUInt16LE(1, 4);   // planes
    e.writeUInt16LE(32, 6);  // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
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


module.exports = { W, H, encodePNG, encodeAPNG, encodeICO };
