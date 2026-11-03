// 검은 고양이 캐릭터의 상태별 이미지를 만든다. 기본 곰(make-sample-pet.js)과 같은 그림체:
// 둥근 몸통 하나 + 굵은 외곽선 + 단순한 얼굴. 모든 이미지는 128x128, 하단 중앙 기준으로 같은 위치.
//   idle.png                 정지
//   walk.png                 걷기 (반복)
//   click_1.png ~ click_5.png 클릭할 때 무작위 1회 재생: 점프 / 흔들기 / 꼬리 흔들기 / 갸웃 / 하트
//   sleep.png                잠자기 (반복)
//   drag.png                 들려 있을 때
// 모두 APNG(.png): GIF는 반투명 픽셀이 없어 어두운 털과 외곽선 경계가 계단처럼 보이기 때문
//
// 사용법: node scripts/make-cat-pet.js [출력 폴더]
const fs = require('fs');
const path = require('path');
const { W, H, encodePNG, encodeAPNG } = require('./image-encode');

const OUT = process.argv[2] || path.join(__dirname, '..', 'assets', 'pets', 'cat');

const C = {
  outline: [22, 22, 30],
  fur: [52, 52, 64],
  furLight: [74, 74, 90],     // 배·주둥이 쪽 밝은 털
  earIn: [240, 150, 170],
  eye: [214, 226, 92],
  pupil: [24, 24, 30],
  white: [255, 255, 255],
  nose: [245, 140, 165],
  line: [210, 210, 222],      // 수염·입·감은 눈 (어두운 털 위에서 보이도록 밝게)
  cheek: [245, 130, 160],
  heart: [255, 95, 130],
  z: [150, 170, 240],
};

// ---------- 래스터 ----------
// 도형을 "로컬 좌표"로 정의하고, 픽셀마다 3x3 표본을 역변환해서 도형 안인지 검사(안티에일리어싱).
// 역변환 방식이라 몸 전체를 기울이거나(갸웃) 늘리고 누르는(점프) 변형이 모든 도형에 똑같이 적용됨.
const SS = 3;
const newCanvas = () => Buffer.alloc(W * H * 4);

function blendPx(px, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * W + x) * 4;
  const da = px[i + 3] / 255, sa = Math.min(1, a);
  const oa = sa + da * (1 - sa);
  [r, g, b].forEach((c, k) => { px[i + k] = Math.round((c * sa + px[i + k] * da * (1 - sa)) / (oa || 1)); });
  px[i + 3] = Math.round(oa * 255);
}

// pose: 화면 위치·변형. 로컬 원점 = 발 밑 중앙, 위쪽이 음수. k=0.8로 줄여 점프·하트가 들어갈 여백 확보
function makeView({ dx = 0, dy = 0, sx = 1, sy = 1, rot = 0 } = {}) {
  const k = 0.8, pivotY = -44; // 기울기·늘이기는 몸통 중심 기준
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return (wx, wy) => {
    const u = (wx - 64 - dx) / k, v = (wy - 118 - dy) / k - pivotY;
    const a = cos * u + sin * v, b = -sin * u + cos * v;
    return [a / sx, b / sy + pivotY];
  };
}
const SCREEN = (wx, wy) => [wx, wy]; // 변형 없이 화면 좌표 그대로 (하트·Z)

function fill(px, view, inside, color, alpha = 1) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let n = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const [lx, ly] = view(x + (i + 0.5) / SS, y + (j + 0.5) / SS);
      if (inside(lx, ly)) n++;
    }
    if (n) blendPx(px, x, y, color, alpha * n / (SS * SS));
  }
}

// ---------- 도형 (로컬 좌표에서 안/밖 판정) ----------
const ellipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function polygon(pts) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
// 꺾은선을 두께 r로 (선분까지 거리 <= r)
function stroke(pts, r) {
  return (x, y) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      if (Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) <= r) return true;
    }
    return false;
  };
}
// 삼각형을 무게중심 쪽으로 줄여 안쪽 도형 만들기 (외곽선 두께 표현)
function shrink(pts, d) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy); return [x - ((x - cx) / l) * d, y - ((y - cy) / l) * d]; });
}
const heartShape = (cx, cy, s) => (x, y) => {
  const u = (x - cx) / s, v = -(y - cy) / s;
  return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0;
};
// 꼬리: 몸 오른쪽 아래에서 위로 휘어 올라가는 곡선. wag(라디안)만큼 뿌리 기준으로 흔들림
function tailPts(wag = 0) {
  const base = [34, -14];
  const raw = [[34, -14], [50, -16], [60, -28], [62, -44], [56, -58], [50, -62]];
  const c = Math.cos(wag), s = Math.sin(wag);
  return raw.map(([x, y]) => {
    const u = x - base[0], v = y - base[1];
    return [base[0] + c * u - s * v, base[1] + s * u + c * v];
  });
}

// ---------- 고양이 ----------
function drawCat(px, {
  pose = {}, eyes = 'open', look = 0, mouth = 'w', tail = 0, feet = null, ears = 0,
} = {}) {
  const view = makeView(pose);
  const F = (shape, color, alpha) => fill(px, view, shape, color, alpha);

  // 꼬리 (몸 뒤)
  const tp = tailPts(tail);
  F(stroke(tp, 8), C.outline); F(stroke(tp, 5.5), C.fur);

  // 걷기용 발
  if (feet) for (const [fx, lift] of [[-22, feet[0]], [22, feet[1]]]) {
    F(ellipse(fx, -4 + lift, 12, 8), C.outline); F(ellipse(fx, -4 + lift, 9.5, 5.5), C.fur);
  }

  // 귀 (ears: 양수면 바깥으로 젖힘)
  for (const side of [-1, 1]) {
    const tilt = ears * side;
    const ear = [[side * 46 + tilt, -64], [side * 34 + tilt * 2, -104], [side * 10, -84]];
    F(polygon(ear), C.outline);
    F(polygon(shrink(ear, 4)), C.fur);
    F(polygon(shrink(ear, 11)), C.earIn);
  }

  // 몸통 + 밝은 배
  F(ellipse(0, -44, 50, 44), C.outline);
  F(ellipse(0, -44, 47, 41), C.fur);
  F(ellipse(0, -28, 26, 18), C.furLight, 0.55);

  // 눈
  const ex = (s) => s * 17 + look;
  if (eyes === 'open' || eyes === 'surprised') {
    const big = eyes === 'surprised' ? 1.25 : 1;
    for (const s of [-1, 1]) {
      F(ellipse(ex(s), -52, 9 * big, 10 * big), C.eye);
      F(ellipse(ex(s) + look * 0.2, -51, (eyes === 'surprised' ? 2.2 : 3.6), 7 * big), C.pupil);
      F(ellipse(ex(s) - 3, -56, 2.2, 2.6), C.white);
    }
  } else if (eyes === 'closed') {
    for (const s of [-1, 1]) F(stroke([[ex(s) - 8, -50], [ex(s), -46], [ex(s) + 8, -50]], 1.6), C.line);
  } else if (eyes === 'happy') { // ^ ^
    for (const s of [-1, 1]) F(stroke([[ex(s) - 8, -47], [ex(s), -56], [ex(s) + 8, -47]], 1.8), C.eye);
  }

  // 볼, 코, 입, 수염
  F(ellipse(-28 + look, -34, 7, 4), C.cheek, 0.45); F(ellipse(28 + look, -34, 7, 4), C.cheek, 0.45);
  F(polygon([[-4 + look, -40], [4 + look, -40], [look, -36]]), C.nose);
  if (mouth === 'w') F(stroke([[look - 7, -33], [look - 3.5, -30], [look, -34], [look + 3.5, -30], [look + 7, -33]], 1.2), C.line);
  else if (mouth === 'open') { F(ellipse(look, -30, 5, 6), C.outline); F(ellipse(look, -28, 3, 2.5), C.nose); }
  for (const s of [-1, 1]) {
    F(stroke([[s * 24 + look, -38], [s * 46 + look, -42]], 0.9), C.line);
    F(stroke([[s * 24 + look, -34], [s * 46 + look, -32]], 0.9), C.line);
  }
}

const frame = (draw) => { const px = newCanvas(); draw(px); return px; };
const heart = (px, cx, cy, s, a = 1) => fill(px, SCREEN, heartShape(cx, cy, s), C.heart, a);
function zz(px, x, y, s, a = 1) {
  fill(px, SCREEN, stroke([[x, y], [x + s, y], [x, y + s], [x + s, y + s]], 1.4), C.z, a);
}
const deg = (d) => (d * Math.PI) / 180;

// ---------- 상태별 이미지 ----------
fs.mkdirSync(OUT, { recursive: true });
const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log(name, buf.length, 'bytes'); };

write('idle.png', encodePNG(frame((px) => drawCat(px))));

// 걷기: 바라보는 방향(오른쪽)으로 시선, 발 번갈아, 꼬리 살랑
write('walk.png', encodeAPNG([
  [0, -5, 0, 0.1], [-2, -2, -2, 0.05], [0, 0, -5, -0.05], [-2, -2, -2, 0.05],
].map(([dy, f0, f1, tail]) => frame((px) => drawCat(px, { pose: { dy }, look: 5, feet: [f0, f1], tail }))), 140));

// 1. 점프
write('click_1.png', encodeAPNG([
  { pose: { dy: 4, sx: 1.08, sy: 0.9 } },
  { pose: { dy: -10, sx: 0.96, sy: 1.06 }, eyes: 'happy', tail: -0.2 },
  { pose: { dy: -22 }, eyes: 'happy', mouth: 'open', tail: -0.35 },
  { pose: { dy: -26 }, eyes: 'happy', mouth: 'open', tail: -0.4 },
  { pose: { dy: -18 }, eyes: 'happy', tail: -0.25 },
  { pose: { dy: -6, sx: 0.97, sy: 1.04 }, eyes: 'happy' },
  { pose: { dy: 4, sx: 1.1, sy: 0.88 } },
  {},
].map((o) => frame((px) => drawCat(px, o))), 70));

// 2. 좌우로 흔들기
write('click_2.png', encodeAPNG([0, -7, 7, -7, 7, -4, 4, 0].map((dx, i) => {
  const edge = i === 0 || i === 7;
  return frame((px) => drawCat(px, { pose: { dx }, eyes: edge ? 'open' : 'happy', mouth: edge ? 'w' : 'open', tail: -dx * 0.03 }));
}), 80));

// 3. 꼬리 흔들기 (기분 좋음)
write('click_3.png', encodeAPNG([0, 0.28, -0.25, 0.3, -0.25, 0.28, -0.15, 0].map((tail, i) =>
  frame((px) => drawCat(px, { tail, eyes: i === 0 || i === 7 ? 'open' : 'happy', pose: { dy: i % 2 ? -2 : 0 } }))), 90));

// 4. 고개 갸웃 (오른쪽 → 왼쪽 → 제자리)
write('click_4.png', encodeAPNG([0, 6, 12, 12, 6, -6, -12, -12, -6, 0].map((d, i) =>
  frame((px) => drawCat(px, { pose: { rot: deg(d) }, eyes: i === 0 || i === 9 ? 'open' : 'surprised', ears: Math.abs(d) / 3, look: d / 3 }))), 90));

// 5. 하트: 눈 감고 웃으며 머리 위로 하트가 떠오름
write('click_5.png', encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7].map((i) => frame((px) => {
  drawCat(px, { eyes: i === 0 || i === 7 ? 'open' : 'happy', pose: { dy: i >= 1 && i <= 6 ? -2 : 0 }, tail: i % 2 ? 0.15 : -0.1 });
  if (i >= 1 && i <= 6) {
    const t = (i - 1) / 5;
    heart(px, 64, 30 - t * 13, 6 + t * 4, i === 6 ? 0.5 : 1);
    if (i >= 3) heart(px, 92, 34 - (t - 0.4) * 16, 4 + t * 2, i === 6 ? 0.4 : 0.85);
  }
})), 90));

// 잠자기: 눈 감고 숨쉬기 + Z
write('sleep.png', encodeAPNG([0, 1, 2, 3].map((i) => frame((px) => {
  drawCat(px, { eyes: 'closed', mouth: 'none', pose: { sy: i % 2 ? 1.02 : 0.98, dy: i % 2 ? -1 : 0 }, tail: 0.25 });
  zz(px, 92, 26 - i * 4, 6 + i);
  if (i >= 2) zz(px, 106, 12 - (i - 2) * 4, 4 + (i - 2), 0.7);
})), 450));

// 들려 있을 때: 놀란 눈, 몸이 늘어남, 꼬리는 아래로
write('drag.png', encodePNG(frame((px) => drawCat(px, { eyes: 'surprised', mouth: 'open', pose: { sy: 1.05 }, tail: 0.3 }))));

fs.writeFileSync(path.join(OUT, 'pet.json'), JSON.stringify({
  name: '검은 고양이',
  size: 128,
  speed: 80,
  facing: 'right',
  sleepAfterSec: 600,
}, null, 2) + '\n');
console.log('pet.json');
