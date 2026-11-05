// 기본 캐릭터(곰)의 상태별 이미지를 만든다. 외부 이미지 편집기 없이 코드로 그림.
//   idle.png  : 정지 PNG
//   walk.png  : APNG (반복)
//   click.gif   : GIF  (1회 재생) - 점프
//   click_2.png : APNG (1회 재생) - 좌우로 흔들기. 클릭할 때마다 click 이미지 중 하나를 무작위로 재생
//   sleep.png : APNG (반복)
//   drag.png  : 정지 PNG
// 세 가지 형식(PNG, APNG, GIF)을 섞은 이유: 앱이 모든 형식을 불러오는지 확인하기 위해.
//
// 사용법: node scripts/make-sample-pet.js [출력 폴더]
const fs = require('fs');
const path = require('path');
const { W, H, encodePNG, encodeAPNG, encodeGIF, encodeICO } = require('./image-encode');
const OUT = process.argv[2] || path.join(__dirname, '..', 'assets', 'pets', 'default');

// ---------- 래스터 ----------
const OUTLINE = [70, 50, 40], FUR = [255, 196, 120], DARK = [50, 35, 30],
  WHITE = [255, 255, 255], CHEEK = [255, 140, 140];

// 캔버스 크기: 캐릭터 이미지는 128, 아이콘을 그릴 때만 바꿈
let CW = W, CH = H;
function newCanvas() { return Buffer.alloc(CW * CH * 4); }

function blend(px, x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= CW || y >= CH || a <= 0) return;
  const i = (y * CW + x) * 4;
  const da = px[i + 3] / 255, sa = Math.min(1, a);
  const oa = sa + da * (1 - sa);
  [r, g, b].forEach((c, k) => { px[i + k] = Math.round((c * sa + px[i + k] * da * (1 - sa)) / (oa || 1)); });
  px[i + 3] = Math.round(oa * 255);
}

// 가장자리를 1px 부드럽게 처리한 타원
function ellipse(px, cx, cy, rx, ry, color) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(CW - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(CH - 1, Math.ceil(cy + ry + 1));
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
// view: 128 캔버스 좌표를 다른 크기 캔버스로 옮길 때 (아이콘). 화면 좌표 = o + scale * (128 기준 좌표)
function drawBear(px, { dx = 0, dy = 0, sx = 1, sy = 1, eyes = 'open', look = 0, mouth = 'small', feet = null,
  view = { scale: 1, ox: 0, oy: 0 } } = {}) {
  const k = 0.8, vs = view.scale;
  const X = (lx) => view.ox + vs * (64 + dx + k * sx * lx), Y = (ly) => view.oy + vs * (118 + dy + k * sy * ly);
  const E = (lx, ly, rx, ry, c) => ellipse(px, X(lx), Y(ly), vs * k * sx * rx, vs * k * sy * ry, c);

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
    for (const s of [-1, 1]) line(px, X(ex(s) - 6), Y(-46), X(ex(s) + 6), Y(-46), 1.4 * vs, DARK);
  } else if (eyes === 'happy') { // ^ ^
    for (const s of [-1, 1]) {
      line(px, X(ex(s) - 6), Y(-44), X(ex(s)), Y(-52), 1.4 * vs, DARK);
      line(px, X(ex(s)), Y(-52), X(ex(s) + 6), Y(-44), 1.4 * vs, DARK);
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

// 클릭(두 번째): 좌우로 몸을 흔들며 웃기 (1회 재생)
// GIF가 아닌 APNG의 1회 재생: 반복 여부는 파일이 아니라 상태(click)가 정하므로 파일은 무한 반복으로 저장해도 됨
write('click_2.png', encodeAPNG([0, -7, 7, -7, 7, -4, 4, 0].map((dx, i) =>
  frame((px) => drawBear(px, { dx, eyes: i === 0 || i === 7 ? 'open' : 'happy', mouth: i === 0 || i === 7 ? 'small' : 'open' }))), 80));

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

// 앱 아이콘 (exe, 설치 프로그램, 시작 메뉴): 크기마다 다시 그려야 작은 크기에서도 선명함.
// 곰이 128 캔버스에서 차지하는 영역(약 x 23~105, y 39~119)을 아이콘 정사각형 가운데에 맞춤
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const icons = ICON_SIZES.map((size) => {
  CW = size; CH = size;
  const scale = (size * 0.94) / 82;
  const view = { scale, ox: size / 2 - scale * 64, oy: size / 2 - scale * 79 };
  const px = newCanvas();
  drawBear(px, { view });
  return { size, png: encodePNG(px, size, size) };
});
CW = W; CH = H;
fs.writeFileSync(path.join(OUT, '..', '..', 'icon.ico'), encodeICO(icons));
fs.writeFileSync(path.join(OUT, '..', '..', 'icon.png'), icons[icons.length - 1].png);
console.log('icon.ico', ICON_SIZES.join(','), '/ icon.png 256');

// 트레이 아이콘
const tray = path.join(OUT, '..', '..', 'tray.png');
fs.copyFileSync(path.join(OUT, 'idle.png'), tray);
console.log('tray.png');
