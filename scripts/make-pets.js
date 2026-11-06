// 기본 캐릭터(곰, 검은 고양이, 푸들, 오목눈이, 토끼, 쿼카)의 상태별 이미지와 앱 아이콘을 만든다.
// 그림체: 손그림 느낌의 굵은 갈색 외곽선, 납작하고 둥근 떡 같은 몸, 작은 점 눈, 큰 분홍 볼터치, 파스텔 단색.
// 외곽선은 펜으로 긋듯 그림: 굵기가 조금씩 변하고, 끝은 가늘어지며, 군데군데 끊겨 끝과 끝이 맞닿지 않음.
// 선 위치도 미세하게 흔들어 매끈하지 않게 하고, 프레임마다 흔들림을 바꿔 선이 살짝 일렁이게 함 (선 떨림).
//
// 출력: assets/pets/default (곰), cat (고양이), dog (강아지), bird (오목눈이), rabbit (토끼), quokka (쿼카), assets/icon.ico, icon.png, tray.png
// 모두 APNG(.png): 반투명 가장자리를 살리기 위해 (GIF는 계단 현상)
//
// 사용법: node scripts/make-pets.js [assets 폴더]
const fs = require('fs');
const path = require('path');
const { W, H, encodePNG, encodeAPNG, encodeICO } = require('./image-encode');

const ASSETS = process.argv[2] || path.join(__dirname, '..', 'assets');

const INK = [62, 44, 38];          // 외곽선·눈·입
const BLUSH = [247, 150, 168];
const CREAM = [255, 248, 236];     // 앞발, 고양이 눈 흰자 대신
const HEART = [255, 110, 140];

const PALETTE = {
  bear: { fur: [242, 200, 150], light: [253, 234, 208], earIn: [245, 170, 160], paw: CREAM },
  cat: { fur: [70, 64, 78], light: [98, 90, 106], earIn: [240, 160, 180], paw: [250, 244, 236], eye: [238, 226, 160] },
  // 푸들: 곰(주황빛 갈색)과 구분되는 밝은 크림 베이지, 귀는 조금 진하게
  dog: { fur: [242, 222, 192], ear: [229, 202, 166], light: [251, 241, 224], paw: [251, 241, 224], tongue: [244, 128, 148] },
  // 토끼: 하얀 몸, 분홍 귀 안쪽
  rabbit: { fur: [255, 253, 252], light: [255, 244, 246], earIn: [248, 182, 196], paw: [255, 255, 255], nose: [246, 150, 170] },
  // 쿼카: 따뜻한 회갈색 몸, 밝은 주둥이·앞발, 동그란 작은 귀
  quokka: { fur: [196, 160, 126], light: [238, 218, 194], earIn: [222, 168, 150], paw: [240, 224, 204] },
  // 오목눈이: 흰 몸, 하늘색은 날개에만
  bird: { fur: [253, 253, 255], light: [238, 238, 242], feather: [212, 214, 224], blue: [132, 182, 236], blueDeep: [82, 128, 204], blueLight: [205, 226, 250], beak: [70, 66, 82], feet: [110, 92, 92] },
};

// ---------- 래스터 ----------
// 도형은 "로컬 좌표"(발 밑 중앙이 원점, 위쪽이 음수)로 정의. 픽셀마다 3x3 표본을 로컬 좌표로 역변환해
// 도형 안인지 검사(안티에일리어싱). 몸 전체를 기울이거나 늘리는 변형이 모든 도형에 똑같이 적용됨
const SS = 3;
let CW = W, CH = H;

function blendPx(px, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * CW + x) * 4;
  const da = px[i + 3] / 255, sa = Math.min(1, a);
  const oa = sa + da * (1 - sa);
  [r, g, b].forEach((c, k) => { px[i + k] = Math.round((c * sa + px[i + k] * da * (1 - sa)) / (oa || 1)); });
  px[i + 3] = Math.round(oa * 255);
}

// pose: 128 캔버스 기준 위치·변형. icon: 아이콘 캔버스로 옮길 때 { scale, ox, oy }
function makeView({ dx = 0, dy = 0, sx = 1, sy = 1, rot = 0 } = {}, icon = null) {
  const k = 0.8, pivotY = -40;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const toLocal = (wx, wy) => {
    if (icon) { wx = (wx - icon.ox) / icon.scale; wy = (wy - icon.oy) / icon.scale; }
    const u = (wx - 64 - dx) / k, v = (wy - 118 - dy) / k - pivotY;
    const a = cos * u + sin * v, b = -sin * u + cos * v;
    return [a / sx, b / sy + pivotY];
  };
  const toWorld = (lx, ly) => {
    const a = lx * sx, b = (ly - pivotY) * sy;
    const u = cos * a - sin * b, v = sin * a + cos * b;
    let wx = 64 + dx + k * u, wy = 118 + dy + k * (v + pivotY);
    if (icon) { wx = icon.ox + icon.scale * wx; wy = icon.oy + icon.scale * wy; }
    return [wx, wy];
  };
  return { toLocal, toWorld };
}
const SCREEN = { toLocal: (x, y) => [x, y], toWorld: (x, y) => [x, y] };

// shape: { inside(x, y), bbox: [x0, y0, x1, y1] (로컬) }. 검사는 화면에서 도형이 차지하는 영역만
function fill(px, view, shape, color, alpha = 1) {
  const [x0, y0, x1, y1] = shape.bbox;
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => view.toWorld(x, y));
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) - 2));
  const maxX = Math.min(CW - 1, Math.ceil(Math.max(...corners.map((c) => c[0])) + 2));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) - 2));
  const maxY = Math.min(CH - 1, Math.ceil(Math.max(...corners.map((c) => c[1])) + 2));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    let n = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const [lx, ly] = view.toLocal(x + (i + 0.5) / SS, y + (j + 0.5) / SS);
      if (shape.inside(lx, ly)) n++;
    }
    if (n) blendPx(px, x, y, color, alpha * n / (SS * SS));
  }
}

// ---------- 도형 ----------
// 손그림 타원: 둥근 사각형에 가까운 초타원(n), 아래쪽을 납작하게(flat), 각도에 따라 반지름을 흔듦(wob)
// grow: 외곽선용으로 바깥쪽으로 키우는 두께
// fluff: 아래쪽 반 윤곽에 잔물결을 넣어 깃털·솜털처럼 보송보송하게 (새 몸)
const fluffAt = (t, fluff, phase) => (fluff && Math.sin(t) > 0 ? fluff * Math.sin(t) * Math.abs(Math.sin(11 * t + phase * 0.3)) : 0);
function blob(cx, cy, rx, ry, { n = 2, flat = 1, wob = 0, phase = 0, grow = 0, fluff = 0 } = {}) {
  const RX = rx + grow, RT = ry + grow, RB = ry * flat + grow;
  return {
    bbox: [cx - RX * 1.1, cy - RT * 1.1, cx + RX * 1.1, cy + RB * 1.1],
    inside(x, y) {
      const u = (x - cx) / RX, v = (y - cy) / (y > cy ? RB : RT);
      const t = Math.atan2(v, u);
      const f = 1 + wob * (0.6 * Math.sin(3 * t + phase) + 0.4 * Math.sin(5 * t + phase * 1.7 + 1.3)) + fluffAt(t, fluff, phase);
      return Math.pow(Math.abs(u), n) + Math.pow(Math.abs(v), n) <= Math.pow(f, n);
    },
  };
}
function stroke(pts, r) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return {
    bbox: [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r],
    inside(x, y) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const vx = bx - ax, vy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
        if (Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) <= r) return true;
      }
      return false;
    },
  };
}
function polygon(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return {
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    inside(x, y) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
  };
}

// ---------- 손그림 선 ----------
// 닫힌 윤곽(점 목록)을 따라 펜으로 긋듯 그린 외곽선.
//  - gaps: [[시작, 길이], ...] 둘레 비율(0~1). 그 구간은 긋지 않아서 선의 끝과 끝이 맞닿지 않음
//  - 선 굵기를 조금씩 바꾸고 끝은 가늘게(펜을 떼는 느낌), 선 위치도 미세하게 흔들어 매끈하지 않게
//  - seed: 도형마다 다른 흔들림, boil: 프레임마다 다른 흔들림(선 떨림)
const LINE_R = 2.2; // 외곽선 반폭 (로컬 단위, 화면에서 전체 굵기 약 3.5px)

// 굵기가 변하는 선분들 → 도형. 선분이 많아서 격자로 나눠 가까운 선분만 검사
function varStroke(segs) {
  const xs = segs.flatMap((s) => [s.ax - s.ra, s.bx - s.rb, s.ax + s.ra, s.bx + s.rb]);
  const ys = segs.flatMap((s) => [s.ay - s.ra, s.by - s.rb, s.ay + s.ra, s.by + s.rb]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const G = 6, grid = new Map();
  segs.forEach((s, idx) => {
    const r = Math.max(s.ra, s.rb);
    for (let gx = Math.floor((Math.min(s.ax, s.bx) - r - x0) / G); gx <= Math.floor((Math.max(s.ax, s.bx) + r - x0) / G); gx++)
      for (let gy = Math.floor((Math.min(s.ay, s.by) - r - y0) / G); gy <= Math.floor((Math.max(s.ay, s.by) + r - y0) / G); gy++) {
        const key = gx * 10007 + gy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(idx);
      }
  });
  return {
    bbox: [x0, y0, x1, y1],
    inside(x, y) {
      const list = grid.get(Math.floor((x - x0) / G) * 10007 + Math.floor((y - y0) / G));
      if (!list) return false;
      for (const idx of list) {
        const s = segs[idx];
        const vx = s.bx - s.ax, vy = s.by - s.ay;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (y - s.ay) * vy) / (vx * vx + vy * vy || 1)));
        if (Math.hypot(x - (s.ax + t * vx), y - (s.ay + t * vy)) <= s.ra + (s.rb - s.ra) * t) return true;
      }
      return false;
    },
  };
}

function sketchLine(pts, { r = LINE_R, gaps = [], seed = 0, boil = 0, rough = 0.7 } = {}) {
  const N = pts.length;
  const inGap = (i) => gaps.some(([s, l]) => (((i / N - s) % 1) + 1) % 1 < l);
  // 법선 방향으로 미세하게 흔들어 매끈하지 않게
  const jit = pts.map(([x, y], i) => {
    const [ax, ay] = pts[(i - 1 + N) % N], [bx, by] = pts[(i + 1) % N];
    let nx = by - ay, ny = -(bx - ax);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const d = rough * (0.65 * Math.sin(i * 0.3 + seed * 1.7 + boil * 1.9) + 0.35 * Math.sin(i * 0.77 + seed * 3.1 - boil * 1.3));
    return [x + nx * d, y + ny * d];
  });
  // 끊긴 틈을 기준으로 이어진 구간(run)으로 나눔
  let runs = [];
  if (!gaps.length) runs = [[...pts.keys(), 0]];
  else {
    let start = 0;
    while (!inGap(start)) start++;
    let cur = [];
    for (let k = 1; k <= N; k++) {
      const i = (start + k) % N;
      if (!inGap(i)) cur.push(i);
      else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
  }
  const segs = [];
  for (const run of runs) {
    const L = run.length;
    const rad = run.map((i, j) => {
      const m = gaps.length ? Math.min(j, L - 1 - j) : 99;
      const taper = Math.min(1, 0.55 + (0.45 * m) / 4); // 끝으로 갈수록 조금 가늘게
      return r * (1 + 0.16 * Math.sin(i * 0.37 + seed * 2.3 + boil * 0.9) + 0.06 * Math.sin(i * 1.1 + seed)) * taper;
    });
    for (let j = 0; j + 1 < L; j++) {
      const [ax, ay] = jit[run[j]], [bx, by] = jit[run[j + 1]];
      segs.push({ ax, ay, bx, by, ra: rad[j], rb: rad[j + 1] });
    }
  }
  return varStroke(segs);
}

// 손그림 타원의 윤곽 점 (blob()과 같은 모양). t=0이 오른쪽, 아래쪽(화면 기준)으로 돌아감
function blobPts(cx, cy, rx, ry, { n = 2, flat = 1, wob = 0, phase = 0, fluff = 0 } = {}) {
  const steps = Math.max(28, Math.round((Math.PI * (rx + ry)) / 1.4));
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps, c = Math.cos(t), s = Math.sin(t);
    const f = 1 + wob * (0.6 * Math.sin(3 * t + phase) + 0.4 * Math.sin(5 * t + phase * 1.7 + 1.3)) + fluffAt(t, fluff, phase);
    const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), ey = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    pts.push([cx + rx * f * ex, cy + (s > 0 ? ry * flat : ry) * f * ey]);
  }
  return pts;
}
// 닫힌 윤곽을 일정한 간격의 점으로 다시 찍음
function resample(pts, step) {
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const L = Math.hypot(bx - ax, by - ay);
    let d = carry;
    while (d < L) { out.push([ax + ((bx - ax) * d) / L, ay + ((by - ay) * d) / L]); d += step; }
    carry = d - L;
  }
  return out;
}
// 곱슬 윤곽 (푸들): 닫힌 윤곽의 점을 중심에서 바깥쪽으로 밀어 bumps개의 몽글몽글한 털뭉치를 만듦
function curlPts(pts, amp, bumps, phase = 0) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts.map(([x, y], i) => {
    const d = amp * Math.abs(Math.sin((Math.PI * bumps * i) / pts.length + phase * 0.05));
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * d, y + ((y - cy) / l) * d];
  });
}

// 꼭짓점 목록 → 모서리를 둥글린(Chaikin) 촘촘한 점
function smoothPts(verts, iter = 3, step = 1.4) {
  let p = verts;
  for (let k = 0; k < iter; k++) {
    const q = [];
    p.forEach(([x, y], i) => {
      const [nx, ny] = p[(i + 1) % p.length];
      q.push([0.75 * x + 0.25 * nx, 0.75 * y + 0.25 * ny], [0.25 * x + 0.75 * nx, 0.25 * y + 0.75 * ny]);
    });
    p = q;
  }
  const out = [];
  p.forEach(([x, y], i) => {
    const [nx, ny] = p[(i + 1) % p.length];
    const n = Math.max(1, Math.round(Math.hypot(nx - x, ny - y) / step));
    for (let k = 0; k < n; k++) out.push([x + ((nx - x) * k) / n, y + ((ny - y) * k) / n]);
  });
  return out;
}
// 꼬리: 중심선 양옆으로 두께만큼 벌린 윤곽 (끝은 둥글게)
function tubePts(center, r) {
  const dense = [];
  for (let i = 0; i + 1 < center.length; i++) {
    const [ax, ay] = center[i], [bx, by] = center[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 1.4));
    for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  dense.push(center[center.length - 1]);
  const normal = (i) => {
    const [ax, ay] = dense[Math.max(0, i - 1)], [bx, by] = dense[Math.min(dense.length - 1, i + 1)];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    return [-(by - ay) / l, (bx - ax) / l];
  };
  const left = dense.map((p, i) => { const [nx, ny] = normal(i); return [p[0] + nx * r, p[1] + ny * r]; });
  const right = dense.map((p, i) => { const [nx, ny] = normal(i); return [p[0] - nx * r, p[1] - ny * r]; });
  const [ex, ey] = dense[dense.length - 1], [nx, ny] = normal(dense.length - 1);
  const a0 = Math.atan2(ny, nx), cap = [];
  for (let k = 1; k < 10; k++) { const a = a0 - (Math.PI * k) / 10; cap.push([ex + Math.cos(a) * r, ey + Math.sin(a) * r]); }
  return [...left, ...cap, ...right.reverse()];
}
// 하트 윤곽 (위쪽 오목한 곳에서 시작)
function heartPts(cx, cy, s) {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (2 * Math.PI * i) / 64;
    pts.push([cx + (s * 16 * Math.sin(t) ** 3) / 16, cy - (s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 16]);
  }
  return pts;
}

// ---------- 캐릭터 ----------
// 색을 칠한 뒤 손그림 외곽선
function part(F, fillShape, color, pts, lineOpt) {
  F(fillShape, color);
  F(sketchLine(pts, lineOpt), INK);
}
// 두 도형이 겹치는 부분만 (몸 안쪽 무늬)
const both = (a, b) => ({ bbox: a.bbox, inside: (x, y) => a.inside(x, y) && b.inside(x, y) });
// 점 목록을 pivot 기준으로 회전
const rotPts = (pts, [px0, py0], ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => { const u = x - px0, v = y - py0; return [px0 + c * u - s * v, py0 + s * u + c * v]; });
};

// 캐릭터마다 다른 얼굴·몸 위치 (로컬 좌표)
const LAYOUT = {
  bear: { body: [0, -38, 46, 37, 2.35], eyeX: 14, eyeY: -41, blush: [26, -31, 8.5, 7] },
  cat: { body: [0, -38, 46, 37, 2.35], eyeX: 14, eyeY: -41, blush: [26, -31, 8.5, 7] },
  dog: { body: [0, -38, 46, 37, 2.35], eyeX: 14, eyeY: -44, blush: [21, -31, 6.5, 5] },
  // 토끼: 볼이 빵빵하도록 몸을 조금 넓게
  rabbit: { body: [0, -37, 48, 36, 2.3], eyeX: 14, eyeY: -41, blush: [29, -26, 10, 8] },
  quokka: { body: [0, -38, 45, 37, 2.3], eyeX: 13, eyeY: -43, blush: [26, -29, 7.5, 6] },
  // 새: 동그란 공 모양, 발이 보이도록 몸을 띄움
  bird: { body: [0, -50, 42, 39, 2.05], eyeX: 12, eyeY: -56, blush: [22, -46, 6, 4.5] },
};

function drawPet(px, kind, {
  pose = {}, icon = null, boil = 0, eyes = 'open', look = 0, mouth = 'w', paws = 'front', feet = null,
  tail = 0, ears = 0, blush = 1, wings = null, perk = 0,
  brows = null, props = null, pawPos = null, belly = false, puff = 0, earsBack = 0, rump = null, headTilt = 0, arms = null, afterPaws = null, tear = false,
} = {}) {
  const C = PALETTE[kind];
  const L = LAYOUT[kind];
  const view = makeView(pose, icon);
  const F = (shape, color, alpha) => fill(px, view, shape, color, alpha);
  // headTilt: 몸(아래쪽)은 그대로 두고 머리(귀·얼굴)만 갸웃. 목 위치(HP)를 축으로 얼굴 요소를 돌리고,
  // 몸 윤곽은 위로 갈수록 많이 돌아가게 휘어서 머리 부분만 기울어 보이게 함
  const HP = kind === 'bird' ? [0, -34] : [0, -22];
  const rotAt = (x, y, a) => { const c = Math.cos(a), sn = Math.sin(a), u = x - HP[0], v = y - HP[1]; return [HP[0] + c * u - sn * v, HP[1] + sn * u + c * v]; };
  const hview = headTilt ? { toLocal: (wx, wy) => rotAt(...view.toLocal(wx, wy), -headTilt), toWorld: (lx, ly) => view.toWorld(...rotAt(lx, ly, headTilt)) } : view;
  const FH = headTilt ? (shape, color, alpha) => fill(px, hview, shape, color, alpha) : F;
  const neckW = (y) => { const t = Math.max(0, Math.min(1, (HP[1] - y) / 30)); return t * t * (3 - 2 * t); };
  const bend = (pts) => (headTilt ? pts.map(([x, y]) => rotAt(x, y, headTilt * neckW(y))) : pts);
  const ph = boil * 2.1; // 프레임마다 다른 흔들림 → 선 떨림
  const wob = 0.022;
  const B = (cx, cy, rx, ry, o = {}) => ({ shape: blob(cx, cy, rx, ry, o), pts: blobPts(cx, cy, rx, ry, o) });
  const [bx, by, brx, bry, bn] = L.body;
  const bodyOpt = { n: bn, flat: 0.92, wob, phase: ph, fluff: kind === 'bird' ? 0.03 : 0 };
  // 푸들은 몸 윤곽 전체가 곱슬
  // 토끼는 완전한 타원이 아니라 위(이마)가 좁고 아래(주둥이·볼)가 넓은 얼굴
  // 토끼 얼굴: 둥근 이마 + 양옆 아래로 빵빵하게 튀어나온 동그란 볼 + 턱. 세 도형을 합친 윤곽이라
  // 이마와 볼이 만나는 옆선이 움푹 들어가 확실히 구분됨. 바닥은 납작하게
  const rabbitPts = () => {
    const parts = [[0, -45, 35, 31], [-27, -22, 22, 21], [27, -22, 22, 21], [0, -17, 30, 17]];
    const pts = [];
    for (let k = 0; k < 120; k++) {
      const t = (k / 120) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      // 중심(0, -36)에서 나가는 방향으로 각 타원을 빠져나가는 거리 중 가장 먼 값
      let r = 0;
      for (const [cx, cy, rx, ry] of parts) {
        const ox = -cx / rx, oy = (-36 - cy) / ry, dx = c / rx, dy = sn / ry;
        const A = dx * dx + dy * dy, Bq = 2 * (ox * dx + oy * dy), Cq = ox * ox + oy * oy - 1, disc = Bq * Bq - 4 * A * Cq;
        if (disc >= 0) r = Math.max(r, (-Bq + Math.sqrt(disc)) / (2 * A));
      }
      r *= 1 + wob * (0.6 * Math.sin(3 * t + ph) + 0.4 * Math.sin(5 * t + ph * 1.7 + 1.3));
      pts.push([c * r, Math.min(-36 + sn * r, -0.5)]);
    }
    return resample(smoothPts(pts, 2, 99), 1.4); // 점 간격을 다른 캐릭터 윤곽(약 1.4)과 맞춰야 선 떨림이 같은 느낌
  };
  const bodyPts = kind === 'dog' ? curlPts(blobPts(bx, by, brx - 2, bry - 2, bodyOpt), 2.8, 15)
    : kind === 'rabbit' ? rabbitPts()
    : kind === 'quokka' ? blobPts(bx, by, brx, bry, bodyOpt).map(([x, y]) => [x * (1 + 0.1 * Math.max(-1, Math.min(0.6, (y - by) / bry))), y]) : blobPts(bx, by, brx, bry, bodyOpt);
  const bodyShape0 = kind === 'dog' || kind === 'rabbit' || kind === 'quokka' ? polygon(bodyPts) : blob(bx, by, brx, bry, bodyOpt);
  const bodyPtsT = bend(bodyPts), bodyShape = headTilt ? polygon(bodyPtsT) : bodyShape0;

  // ----- 몸 뒤: 꼬리, 펼친 날개, 귀 -----
  // 꼬리는 진행 방향의 뒤쪽에 붙어야 함. 원본 이미지는 오른쪽으로 가는 기준(facing: right)이므로 꼬리를 왼쪽에 그림.
  // 왼쪽으로 갈 때는 앱이 좌우를 뒤집으므로 꼬리가 오른쪽에 옴
  const back = (pts) => pts.map(([x, y]) => [-x, y]);
  // 사냥 준비 자세(고양이): 머리 뒤로 치켜든 엉덩이와 곧게 선 꼬리가 보이고, rump만큼 좌우로 씰룩임
  if (kind === 'cat' && rump !== null) {
    const rx0 = rump;
    const tc = rotPts([[rx0 - 4, -88], [rx0 - 8, -102], [rx0 - 5, -113], [rx0 + 3, -117]], [rx0 - 4, -88], rump * 0.035);
    const tl = tubePts(tc, 5.8);
    part(F, polygon(tl), C.fur, tl, { seed: 11, boil, gaps: [[0.47, 0.05], [0.97, 0.06]] });
    const rp = rotPts(blobPts(rx0, -80, 25, 16, { wob, phase: ph + 3 }), [0, -64], rump * 0.012); // 엉덩이를 흔들 때 살짝 기울어짐
    part(F, polygon(rp), C.fur, rp, { seed: 19, boil, gaps: [[0.62, 0.06]] });
  }
  if (kind === 'cat' && rump === null) {
    const center = back(rotPts([[26, -9], [44, -12], [54, -22], [56, -36], [51, -48]], [30, -10], tail));
    // puff: 하악질할 때 꼬리털을 부풀림 (굵고 삐죽삐죽)
    const outline = puff ? curlPts(tubePts(center, 6.5 + puff), puff * 0.7, 26, boil) : tubePts(center, 6.5);
    part(F, polygon(outline), C.fur, outline, { seed: 11, boil, gaps: [[0.47, 0.05], [0.97, 0.06]] });
  }
  if (kind === 'dog') { // 푸들 방울 꼬리: 짧은 꼬리 끝에 동그란 곱슬 털뭉치. 평소·걷기에도 보이도록 몸 바깥쪽으로 뺌
    const center = back(rotPts([[37, -11], [47, -14], [54, -20]], [37, -11], tail));
    const stick = tubePts(center, 3.6);
    part(F, polygon(stick), C.fur, stick, { r: 1.7, seed: 12, boil, gaps: [[0.95, 0.07]] });
    const [px0, py0] = center[2];
    const pom = curlPts(blobPts(px0, py0 - 2, 7, 7, { phase: ph }), 1.6, 9, boil);
    part(F, polygon(pom), C.fur, pom, { r: 1.8, seed: 14, boil, gaps: [[0.2, 0.1]] });
  }
  if (kind === 'quokka') { // 짧고 가는 꼬리 (진행 방향 뒤쪽 아래)
    const center = back(rotPts([[30, -10], [42, -6], [52, -4], [58, -6]], [30, -10], tail * 0.4));
    const tl = tubePts(center, 3.6);
    part(F, polygon(tl), C.fur, tl, { r: 1.6, seed: 13, boil, gaps: [[0.95, 0.07]] });
  }
  if (kind === 'rabbit') { // 동그란 솜뭉치 꼬리 (몸 뒤 아래쪽, 진행 방향 뒤쪽)
    const [cx, cy] = back(rotPts([[42, -14]], [30, -14], tail))[0];
    const t = B(cx, cy, 8.5, 8, { wob: wob * 2, phase: ph + 4 });
    part(F, t.shape, C.fur, t.pts, { r: 1.7, seed: 17, boil, gaps: [[0.1, 0.12]] });
  }
  if (kind === 'bird') {
    // 꼬리깃: 몸 뒤에서 아래로 곧게 늘어진 긴 깃털 두 장 (포유류 꼬리처럼 휘지 않음). 발보다 조금 아래까지 내려옴.
    // 날개와 같은 색, 가운데 진한 줄, 끝은 살짝 갈라짐. tail만큼 뿌리를 축으로 까딱임
    const tb = [-6, -36], tip = [-16, 3];
    const R = (pts) => rotPts(pts, tb, -tail * 0.5);
    const ux = (tip[0] - tb[0]) / Math.hypot(tip[0] - tb[0], tip[1] - tb[1]), uy = (tip[1] - tb[1]) / Math.hypot(tip[0] - tb[0], tip[1] - tb[1]);
    const nx = -uy, ny = ux;
    const at = (t, w) => [tb[0] + (tip[0] - tb[0]) * t + nx * w, tb[1] + (tip[1] - tb[1]) * t + ny * w];
    const tailPts = smoothPts(R([at(0, 5), at(0.55, 5.6), at(1, 5.4), at(1.04, 2.6), at(0.95, 0), at(1.04, -2.6), at(1, -5.4), at(0.55, -5.6), at(0, -5)]), 2, 1.2);
    part(F, polygon(tailPts), C.blue, tailPts, { r: 1.7, seed: 13, boil, gaps: [[0.62, 0.05]] });
    F(both(polygon(tailPts), polygon(R([at(0, 1.6), at(1.1, 1.6), at(1.1, -1.6), at(0, -1.6)]))), C.blueDeep);
    for (const w of [3.4, -3.4]) F(stroke(R([at(0.25, w), at(0.92, w)]), 0.5), C.blueLight); // 깃털 결
    // 펼친 날개 (클릭·들기): wings = 날갯짓 각도(라디안). 몸 옆구리에서 바깥으로 펼치고 어깨를 축으로 퍼덕임.
    // 뒤쪽 가장자리는 깃털 끝처럼 물결 모양
    if (wings !== null) for (const s of [-1, 1]) {
      const sh = [s * 34, -54];
      const R = (pts) => rotPts(pts.map(([x, y]) => [s * x, y]), sh, -s * wings);
      const wingPts = smoothPts(R([[30, -60], [46, -70], [60, -74], [72, -70],
        [73, -63], [67, -61], [69, -55], [61, -53], [62, -47], [53, -46], [50, -42], [40, -44]]), 2);
      part(F, polygon(wingPts), C.blue, wingPts, { r: 1.9, seed: 20 + s, boil, gaps: [[0.18, 0.06]] });
      // 바깥쪽 깃털은 진한 색
      F(both(polygon(wingPts), polygon(R([[58, -80], [80, -74], [78, -50], [60, -44], [56, -60]]))), C.blueDeep);
      // 깃털 사이 결 (물결 안쪽으로 짧게)
      for (const [x0, y0, x1, y1] of [[67, -61], [61, -53], [53, -46]].map(([x, y]) => [x, y, x - 8, y - 5])) {
        F(stroke(R([[x0, y0], [x1, y1]]), 0.75), C.blueLight);
      }
    }
  }
  for (const side of [-1, 1]) {
    if (kind === 'bear') {
      const ex = side * 30, ey = -66;
      const e = B(ex, ey, 11, 10, { wob: wob * 1.5, phase: ph + side });
      part(FH, e.shape, C.fur, e.pts, { seed: 3 + side, boil, gaps: [[side > 0 ? 0.8 : 0.62, 0.09]] });
      FH(blob(ex, ey + 1, 5.5, 5, { wob, phase: ph }), C.earIn);
    } else if (kind === 'quokka') { // 머리 양옆 위의 작고 동그란 귀
      const ex = side * 24, ey = -74;
      const e = B(ex, ey, 10, 10, { wob: wob * 1.5, phase: ph + side });
      part(FH, e.shape, C.fur, e.pts, { seed: 3 + side, boil, gaps: [[side > 0 ? 0.8 : 0.62, 0.09]] });
      FH(blob(ex, ey + 1.5, 4.6, 5.4, { wob, phase: ph }), C.earIn);
    } else if (kind === 'rabbit') {
      const ang = side * (0.1 + 0.22 * Math.min(perk, 1.2)) + ears * 0.02 * side;
      const pivot = [side * 15, -64];
      const outer = rotPts(blobPts(side * 16, -86, 9.5, 24, { wob, phase: ph + side }), pivot, ang);
      part(FH, polygon(outer), C.fur, outer, { seed: 60 + side, boil, gaps: [[side > 0 ? 0.92 : 0.58, 0.07]] });
      FH(polygon(rotPts(blobPts(side * 16, -86, 4.6, 17, {}), pivot, ang)), C.earIn);
    } else if (kind === 'cat') {
      // earsBack: 하악질할 때 귀를 옆으로 납작하게 눕힘 (귀 끝이 바깥·아래로)
      const tilt = ears * side, bx2 = side * 16 * earsBack, by2 = 22 * earsBack;
      const outline = smoothPts([[side * 42 + tilt, -50], [side * 32 + tilt * 2 + bx2, -88 + by2], [side * 11, -66]]);
      part(FH, polygon(outline), C.fur, outline, { seed: 5 + side, boil, gaps: [[0.3, 0.07]] });
      FH(polygon(smoothPts([[side * 35 + tilt, -58], [side * 31 + tilt * 2 + bx2 * 0.8, -78 + by2 * 0.8], [side * 21, -65]], 2)), C.earIn);
    }
  }

  // ----- 몸 -----
  part(F, bodyShape, C.fur, bodyPtsT, { seed: 1, boil, gaps: [[0.85, 0.042], [0.4, 0.03]] });
  // 발라당 누웠을 때 보이는 밝은 배
  if (belly) F(both(blob(0, -10, 27, 14, { wob, phase: ph }), bodyShape), C.light);

  if (kind === 'dog') {
    // 푸들: 밝은 주둥이만. 털은 따로 그리지 않고 구불구불한 곱슬 윤곽으로만 표현
    FH(blob(look, -30, 15, 11, { wob, phase: ph + 2 }), C.light);
  } else if (kind === 'bird') {
    // 오목눈이: 머리·몸은 흰색 그대로 (색은 날개에만). 배 쪽에 옅은 그림자 + 가슴·배에 작은 깃털 결
    FH(both(blob(0, -16, 34, 12, { wob, phase: ph }), bodyShape), C.light);
    const tuft = (x, y, w) => FH(stroke([[x - w, y - w * 0.5], [x, y + w * 0.35], [x + w, y - w * 0.5]], 0.62), C.feather);
    for (const [x, y, w] of [[-14, -33, 3], [-4, -29, 3.2], [7, -32, 3], [16, -27, 2.8], [-18, -22, 2.8], [-7, -19, 3], [5, -21, 3.2], [15, -17, 2.6], [-1, -12, 2.6]]) tuft(x + look * 0.3, y, w);
  } else {
    // 주둥이 쪽 밝은 털
    if (kind === 'quokka') FH(both(blob(look, -22, 27, 17, { wob, phase: ph + 2 }), bodyShape), C.light); // 쿼카는 볼·턱 아래쪽이 넓게 밝은 색
    else FH(blob(look, -29, 15, 10, { wob, phase: ph + 2 }), C.light, kind === 'bear' ? 1 : 0.9);
  }

  // 볼터치
  const [cx, cy, crx, cry] = L.blush;
  for (const s of [-1, 1]) FH(blob(s * cx + look, cy, crx * blush, cry * blush, { wob, phase: ph + s }), BLUSH, kind === 'bird' ? 0.75 : 0.95);

  // ----- 눈 -----
  // 웃는 눈(happy)은 캐릭터마다 다른 모양: 고양이 반달 눈웃음, 곰 하트 눈, 강아지 초롱초롱 눈, 새 눈꼬리 없는 반달
  const HAPPY = { cat: 'crescent', bear: 'heart', dog: 'sparkle', bird: 'crescent', rabbit: 'crescent', quokka: 'crescent' };
  if (eyes === 'happy') eyes = HAPPY[kind];
  const ex = (s) => s * L.eyeX + look, ey = L.eyeY;
  const eyeColor = kind === 'cat' ? C.eye : INK;
  // 고양이 눈: 둥근 눈을 까만 동공이 거의 채우고, 둘레에 연노랑 테두리만 얇게 + 큰 반사광
  const catEye = (x, y, k) => {
    FH(blob(x, y, 5.9 * k, 5.6 * k, {}), eyeColor);
    FH(blob(x + look * 0.15, y + 0.15, 4.9 * k, 4.7 * k, {}), [16, 14, 20]);
    FH(blob(x - 1.8 * k, y - 1.8 * k, 1.75 * k, 1.6 * k, {}), [255, 255, 255]);
    FH(blob(x + 1.9 * k, y + 1.7 * k, 0.75 * k, 0.75 * k, {}), [255, 255, 255], 0.9);
  };
  const dot = kind === 'bird' ? [2.7, 2.9] : kind === 'dog' ? [3.8, 4] : [3, 4]; // 평소 눈 크기 (푸들은 크고 동그란 눈)
  const bigR = kind === 'bird' ? 3.7 : 5;                                          // 커진 눈: 동그랗게
  const lineEye = kind === 'cat' ? eyeColor : INK;
  const es = kind === 'bird' ? 0.8 : 1; // 새는 눈 표정 선도 작게
  if (eyes === 'open') {
    for (const s of [-1, 1]) {
      if (kind === 'cat') catEye(ex(s), ey, 1.1);
      else FH(blob(ex(s), ey, dot[0], dot[1], {}), INK);
    }
  } else if (eyes === 'hunt') { // 평소보다 조금 커진 눈 (사냥감에 집중)
    for (const s of [-1, 1]) catEye(ex(s), ey - 0.5, 1.24);
  } else if (eyes === 'big') {
    for (const s of [-1, 1]) {
      if (kind === 'cat') catEye(ex(s), ey - 1, 1.18);
      else { FH(blob(ex(s), ey - 1, bigR, bigR, {}), INK); FH(blob(ex(s) - bigR * 0.32, ey - 1 - bigR * 0.34, bigR * 0.3, bigR * 0.3, {}), [255, 255, 255]); }
    }
  } else if (eyes === 'happy') { // ^ ^
    for (const s of [-1, 1]) FH(stroke([[ex(s) - 5 * es, ey + 3 * es], [ex(s), ey - 3 * es], [ex(s) + 5 * es, ey + 3 * es]], 1.6 * es), lineEye);
  } else if (eyes === 'heart') { // ♥ ♥ 하트 눈
    for (const s of [-1, 1]) {
      const hp = heartPts(ex(s), ey + 0.6, 5.2 * es);
      FH(polygon(hp), HEART);
      FH(sketchLine(hp, { r: 0.75, rough: 0.15, seed: 50 + s, boil, gaps: [[0.97, 0.05]] }), INK);
      FH(blob(ex(s) - 1.9 * es, ey - 1.6 * es, 1.1 * es, 0.9 * es, {}), [255, 255, 255], 0.9);
    }
  } else if (eyes === 'sparkle') { // ✧ 초롱초롱: 크고 동그란 눈 + 별 반짝임
    const star = (x, y, r) => FH(polygon([[x, y - r], [x + r * 0.28, y - r * 0.28], [x + r, y], [x + r * 0.28, y + r * 0.28],
      [x, y + r], [x - r * 0.28, y + r * 0.28], [x - r, y], [x - r * 0.28, y - r * 0.28]]), [255, 255, 255]);
    for (const s of [-1, 1]) {
      const x = ex(s), y = ey - 1, R = kind === 'bird' ? 4.2 : 6;
      if (kind === 'cat') { FH(blob(x, y, R + 0.8, R + 0.5, {}), eyeColor); FH(blob(x, y + 0.2, R - 0.1, R - 0.2, {}), [16, 14, 20]); }
      else FH(blob(x, y, R, R, {}), INK);
      star(x - R * 0.3, y - R * 0.3, R * 0.62);
      FH(blob(x + R * 0.38, y + R * 0.4, R * 0.15, R * 0.15, {}), [255, 255, 255]);
    }
  } else if (eyes === 'crescent') { // ◠ 반달 눈웃음: 도톰한 반달 + 바깥 눈꼬리 살짝
    for (const s of [-1, 1]) {
      const x = ex(s), y = ey + 1;
      const upper = blob(x, y, 5.6 * es, 4.6 * es, {}), lower = blob(x, y + 2.6 * es, 5.9 * es, 4.4 * es, {});
      FH({ bbox: upper.bbox, inside: (px, py) => upper.inside(px, py) && !lower.inside(px, py) && py < y + 1.5 * es }, lineEye);
      if (kind !== 'bird') FH(stroke([[x + s * 4.6 * es, y - 1.2 * es], [x + s * 7 * es, y - 3 * es]], 0.8 * es), lineEye); // 눈꼬리
    }
  } else if (eyes === 'closed') { // ︶ ︶
    for (const s of [-1, 1]) FH(stroke([[ex(s) - 5 * es, ey - 1], [ex(s) - 2 * es, ey + 1.5 * es], [ex(s) + 2 * es, ey + 1.5 * es], [ex(s) + 5 * es, ey - 1]], 1.5 * es), lineEye);
  } else if (eyes === 'squint') { // > <
    for (const s of [-1, 1]) {
      const x = ex(s), d = -s;
      FH(stroke([[x - 4 * d * es, ey - 4 * es], [x + 4 * d * es, ey], [x - 4 * d * es, ey + 4 * es]], 1.6 * es), lineEye);
    }
  }

  // 하품할 때 눈꼬리에 맺힌 눈물
  if (tear) for (const s of [-1, 1]) FH(blob(ex(s) + s * 6, ey + 3, 1.6, 2.1, { n: 2.2 }), [150, 200, 240], 0.9);
  // 화난 눈썹: 안쪽 끝이 아래로 내려옴
  if (brows === 'angry') for (const s of [-1, 1]) {
    FH(stroke([[ex(s) - s * 4.5, ey - 8.5], [ex(s) + s * 5, ey - 12.5]], 1.25), kind === 'cat' ? C.eye : INK);
  }

  // ----- 코·입 -----
  if (kind === 'bird') {
    // 작은 부리. 입을 벌리면 위아래로 벌어짐
    const open = mouth === 'open';
    FH(polygon([[look - 3.4, -50.5], [look + 3.4, -50.5], [look, open ? -47.5 : -46]]), C.beak);
    if (open) FH(polygon([[look - 2.4, -46.5], [look + 2.4, -46.5], [look, -44]]), C.beak);
  } else {
    if (kind === 'cat') FH(polygon([[look - 3, -35.5], [look + 3, -35.5], [look, -33]]), C.earIn);
    else if (kind === 'rabbit') {
      FH(blob(look, -34.4, 2.8, 2, { n: 2.2 }), C.nose);
      FH(blob(look - 0.8, -35, 0.8, 0.5, {}), [255, 255, 255], 0.85);
    } else if (kind === 'quokka') {
      FH(blob(look, -35, 3.4, 2.6, { n: 2.3 }), INK);
      FH(blob(look - 1, -35.8, 1, 0.65, {}), [255, 255, 255], 0.85);
    } else if (kind === 'bear') {
      FH(blob(look, -34, 3.6, 2.6, { n: 2.3 }), INK);
      FH(blob(look - 1.1, -34.8, 1.1, 0.7, {}), [255, 255, 255], 0.85);
    } else { // 강아지: 크고 까만 코
      FH(blob(look, -35.5, 5, 3.6, { n: 2.3 }), INK);
      FH(blob(look - 1.6, -36.6, 1.5, 0.9, {}), [255, 255, 255], 0.85);
    }
    const mouthInk = kind === 'cat' ? C.eye : INK;
    const my = kind === 'bear' || kind === 'rabbit' ? 1.2 : kind === 'dog' ? 2.2 : 0;
    // 쿼카: 세상에서 가장 행복한 동물 → ω 대신 양끝이 올라간 큰 미소
    // 쿼카는 웃는 얼굴이 핵심이라 평소에도 입을 벌리고 활짝 웃음: 양끝이 올라간 입, 윗니 두 개, 작은 혀
    const w = kind === 'quokka' ? () => {
      FH(stroke([[look, -32.5], [look, -30.6]], 0.85), INK);
      const m = smoothPts([[look - 10, -32.5], [look - 5, -30.4], [look, -30], [look + 5, -30.4], [look + 10, -32.5],
        [look + 8, -27], [look + 4.5, -23], [look, -22], [look - 4.5, -23], [look - 8, -27]], 2, 1);
      const mouthShape = polygon(m);
      FH(mouthShape, [92, 44, 46]);
      FH(both(mouthShape, blob(look, -23.2, 5.4, 3.2, {})), [240, 128, 140]);
      for (const sd of [-1, 1]) FH(both(mouthShape, polygon([[look + sd * 0.3, -31], [look + sd * 3, -31], [look + sd * 2.8, -27], [look + sd * 0.4, -27]])), [255, 255, 255]);
      FH(sketchLine(m, { r: 0.8, rough: 0.2, seed: 21, boil, gaps: [[0.999, 0.001]] }), INK);
    } : () => FH(stroke([[look - 5, -31 + my], [look - 2.5, -28.5 + my], [look, -31 + my], [look + 2.5, -28.5 + my], [look + 5, -31 + my]], 1.15), mouthInk);
    if (mouth === 'tongue') { // 강아지: ω 입 아래로 혀를 쏙 내밀기
      const ty = -21.5 + my, tongue = B(look, ty, 7, 10, { phase: ph }); // 혀를 크게 (귀여움 포인트)
      part(FH, both(tongue.shape, { bbox: tongue.shape.bbox, inside: (x, y) => y > -28.5 + my }), C.tongue,
        tongue.pts.filter(([, y]) => y > -28 + my), { r: 1.2, rough: 0.25, seed: 15, boil, gaps: [[0.999, 0.001]] });
      FH(stroke([[look, ty - 6], [look, ty + 3.5]], 0.8), [210, 80, 105]);
      w();
    } else if (mouth === 'w') w();
    else if (mouth === 'open') { FH(blob(look, -29 + my, 4, 4.6, {}), INK); FH(blob(look, -27.6 + my, 2.4, 2, {}), [235, 110, 120]); }
    else if (mouth === 'small' && kind === 'quokka') FH(stroke([[look - 5, -31], [look - 2.5, -28.6], [look, -28.3], [look + 2.5, -28.6], [look + 5, -31]], 1.1), INK); // 자면서도 미소
    else if (mouth === 'small') FH(stroke([[look - 2, -30 + my], [look + 2, -30 + my]], 1.1), mouthInk);
    else if (mouth === 'yawn') { // 하품: 세로로 길게 벌린 입
      const o = B(look, -25 + my, 5.2, 6.8, { phase: ph });
      F(o.shape, [70, 40, 44]);
      F(both(o.shape, blob(look, -20.5 + my, 4.2, 3, {})), [235, 110, 130]);
      F(sketchLine(o.pts, { r: 0.8, rough: 0.2, seed: 18, boil, gaps: [[0.999, 0.001]] }), mouthInk);
    }
    else if (mouth === 'munch') { FH(blob(look, -29.3 + my, 2.6, 2.3, {}), INK); FH(blob(look, -28.6 + my, 1.5, 1.1, {}), [235, 110, 120]); } // 오물오물
    else if (mouth === 'lick') { // 혀를 살짝 내밀어 핥기 (앞발 쪽으로)
      w();
      const t = B(look + 5, -26.5 + my, 3.2, 4.4, { phase: ph });
      part(FH, t.shape, [240, 140, 160], t.pts, { r: 0.9, rough: 0.2, seed: 16, boil, gaps: [[0.999, 0.001]] });
    } else if (mouth === 'hiss') { // 하악: 크게 벌린 입 + 송곳니
      const o = B(look, -25.5 + my, 8.5, 7, { phase: ph });
      FH(o.shape, [44, 30, 38]);
      FH(both(o.shape, blob(look, -20.5 + my, 6.5, 4, {})), [235, 110, 130]);
      for (const s of [-1, 1]) FH(polygon([[look + s * 2.6, -31.8 + my], [look + s * 6.2, -31.2 + my], [look + s * 4.6, -25.6 + my]]), [255, 255, 255]);
      FH(sketchLine(o.pts, { r: 0.8, rough: 0.2, seed: 18, boil, gaps: [[0.999, 0.001]] }), mouthInk);
    }
  }

  if (kind === 'cat') for (const s of [-1, 1]) { // 수염
    FH(stroke([[s * 33 + look, -33], [s * 44 + look, -35]], 0.8), [190, 182, 196]);
    FH(stroke([[s * 33 + look, -29.5], [s * 44 + look, -28.5]], 0.8), [190, 182, 196]);
  }

  // ----- 몸 앞: 강아지 귀, 새 접은 날개·발, 앞발 -----
  if (kind === 'dog') {
    // 푸들의 늘어진 곱슬 귀. 신날 때(perk) 귀가 들썩이며 바깥으로 살짝 펄럭임.
    // 좌우 귀가 프레임마다 살짝 엇갈리게 움직여 들썩이는 느낌
    for (const s of [-1, 1]) {
      // 귀가 붙은 곳(머리 위쪽 안쪽)을 축으로 회전
      const pivot = [s * 25, -70];
      const base = curlPts(blobPts(s * 40, -46, 12, 23, {}), 2.6, 7);
      // 푸들 귀는 세우면 머리에 꼬리가 달린 것처럼 보여서, 신날 때도 늘어진 채로 바깥으로 살짝(최대 약 30°) 펄럭이기만 함
      const lift = perk > 0 ? 0.45 * (perk + s * 0.15 * Math.sin(boil * 1.7)) : 0;
      const sc = 1;
      const scaled = base.map(([x, y]) => [pivot[0] + (x - pivot[0]) * sc, pivot[1] + (y - pivot[1]) * sc]);
      const ear = rotPts(scaled, pivot, -s * lift);
      part(FH, polygon(ear), C.ear, ear, { seed: 30 + s, boil, gaps: [[s > 0 ? 0.08 : 0.55, 0.08]] });
    }
  }
  // 손에 든 물건 등 (앞발보다 뒤, 몸보다 앞). 로컬 좌표로 그림
  if (props) props({ F, part, B, ph, boil, C });
  if (kind === 'bird') {
    if (wings === null) for (const s of [-1, 1]) { // 접은 날개: 옆구리 아래쪽에 붙임
      const w = B(s * 35, -36, 8, 14, { wob, phase: ph + s });
      part(F, w.shape, C.blue, w.pts, { r: 1.7, seed: 40 + s, boil, gaps: [[s > 0 ? 0.2 : 0.3, 0.1]] });
      F(both(w.shape, blob(s * 35, -25, 9, 6)), C.blueDeep);
      // 겹쳐진 깃털 결
      for (const y of [-42, -34]) F(both(w.shape, stroke([[s * 29, y - 2], [s * 35, y + 2], [s * 41, y - 2]], 0.6)), C.blueLight);
    }
    // 새발: 다리 + 앞으로 세 발가락 + 뒤로 한 발가락
    const lift = feet || [0, 0];
    [-1, 1].forEach((s, i) => {
      const x = s * 10, top = by + bry - 4, foot = -2 + lift[i];
      const col = C.feet;
      F(stroke([[x, top], [x, foot]], 1.15), col);
      for (const [tx, ty] of [[-5, 1.5], [0.5, 2.6], [5.5, 1.2]]) F(stroke([[x, foot], [x + tx, foot + ty]], 1), col);
      F(stroke([[x, foot], [x - 2, foot - 2.2]], 0.9), col);
    });
  } else {
    // 걷기 발 (몸 아래로 살짝 보임)
    if (feet) for (const [fx, lift] of [[-18, feet[0]], [18, feet[1]]]) {
      const f = B(fx, -4 + lift, 9, 6, { wob, phase: ph + fx });
      part(F, f.shape, C.paw, f.pts, { r: 1.7, seed: fx, boil, gaps: [[0.62, 0.12]] });
    }
    // 앞발: 몸 앞에 모은 작은 손 / 들려 있을 때 늘어진 손 / 볼을 감싼 손
    const PAW = { front: [12, -12, 6.5, 5.2], dangle: [13, -7, 6, 5.8], cheeks: [22, -22, 6.5, 5.5] }[paws];
    // pawPos: 앞발 위치를 직접 지정 [[x, y, rx, ry] (왼쪽), [...] (오른쪽)]
    // arms: 팔을 쭉 뻗을 때 손 위치 [[x, y] (왼쪽), [...] (오른쪽)]. 어깨에서 손까지 털색 팔을 그리고 끝에 앞발
    if (arms) [-1, 1].forEach((s, i) => {
      const [hx, hy] = arms[i], sh = [s * 36, -36];
      const arm = tubePts([sh, [(sh[0] + hx) / 2 + s * 2, (sh[1] + hy) / 2], [hx, hy]], 6);
      part(F, polygon(arm), C.fur, arm, { r: 1.6, seed: 24 + s, boil, gaps: [[0.02, 0.06]] });
      const p = B(hx, hy, 6.5, 5.6, { wob, phase: ph + s * 2 });
      part(F, p.shape, C.paw, p.pts, { r: 1.5, rough: 0.35, seed: 7 + s, boil, gaps: [[s > 0 ? 0.78 : 0.6, 0.1]] });
    });
    else if (PAW || pawPos) [-1, 1].forEach((s, i) => {
      const [x, y, rx, ry] = pawPos ? pawPos[i] : [s * PAW[0], ...PAW.slice(1)];
      const p = B(x, y, rx, ry, { wob, phase: ph + s * 2 });
      part(F, p.shape, C.paw, p.pts, { r: 1.5, rough: 0.35, seed: 7 + s, boil, gaps: [[s > 0 ? 0.78 : 0.6, 0.1]] });
    });
  }
  if (afterPaws) afterPaws({ F, part, B, ph, boil, C });
}

function heart(px, x, y, s, a = 1, boil = 0) {
  const pts = heartPts(x, y, s);
  fill(px, SCREEN, polygon(pts), HEART, a);
  fill(px, SCREEN, sketchLine(pts, { r: 1.3, rough: 0.25, seed: 9, boil, gaps: [[0.97, 0.06]] }), INK, a);
}
// 열린 손그림 선 (Z 글자): 양 끝이 가늘고 굵기가 조금씩 변함
function openLine(pts, { r = 1.25, seed = 0, boil = 0, step = 0.8 } = {}) {
  const dense = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  dense.push(pts[pts.length - 1]);
  const L = dense.length;
  const rad = dense.map((_, j) => r * (1 + 0.2 * Math.sin(j * 0.7 + seed + boil)) * Math.min(1, 0.4 + (0.6 * Math.min(j, L - 1 - j)) / 4));
  const segs = [];
  for (let j = 0; j + 1 < L; j++) segs.push({ ax: dense[j][0], ay: dense[j][1], bx: dense[j + 1][0], by: dense[j + 1][1], ra: rad[j], rb: rad[j + 1] });
  return varStroke(segs);
}
function zz(px, x, y, s, a = 1, boil = 0) {
  fill(px, SCREEN, openLine([[x, y], [x + s, y], [x, y + s], [x + s, y + s]], { seed: 4, boil }), INK, a);
}
const deg = (d) => (d * Math.PI) / 180;
const frame = (draw) => { const px = Buffer.alloc(CW * CH * 4); draw(px); return px; };

// ---------- 상태별 이미지 ----------
const NAMES = { bear: '곰', cat: '검은 고양이', dog: '푸들', bird: '오목눈이', rabbit: '토끼', quokka: '쿼카' };

function makeSet(kind, outDir, clicks) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/\.(png|gif|webp|apng)$/i.test(f)) fs.unlinkSync(path.join(outDir, f));
  const write = (name, buf) => { fs.writeFileSync(path.join(outDir, name), buf); console.log(`${kind}/${name}`, buf.length, 'bytes'); };
  // 강아지: 클릭·걷기에서는 혀를 내밀고 있음 (작은 입만 그대로)
  const D = (o) => frame((px) => drawPet(px, kind, kind === 'dog' && o.tongue ? { ...o, mouth: o.mouth === 'small' ? 'small' : 'tongue' } : o));

  // 대기: 선만 살짝 일렁임
  write('idle.png', encodeAPNG([0, 1, 2].map((b) => D({ boil: b })), 220));

  // 걷기 (새는 깡충깡충)
  const walk = kind === 'bird'
    ? [[0, 0, 0], [-6, -3, -3], [-9, -4, -4], [-4, -2, -2]].map(([dy, f0, f1], i) => D({ boil: i, pose: { dy }, look: 3, feet: [f0, f1], tail: -dy * 0.03 }))
    : [[0, -5, 0, 0.1], [-2, -2, -2, 0.05], [0, 0, -5, -0.05], [-2, -2, -2, 0.05]].map(([dy, f0, f1, t], i) =>
      D({ boil: i, pose: { dy }, look: 4, feet: [f0, f1], tail: kind === 'dog' ? [0.25, 0, -0.25, 0][i] : t, tongue: true, perk: [0.3, 0.22, 0.3, 0.22][i] }));
  write('walk.png', encodeAPNG(walk, kind === 'bird' ? 110 : 140));

  clicks.forEach((name, i) => write(`click_${i + 1}.png`, CLICKS[name](kind, (o) => D({ tongue: true, ...o }))));

  // 잠자기: 눈 감고 숨쉬기 + Z
  write('sleep.png', encodeAPNG([0, 1, 2, 3].map((i) => frame((px) => {
    drawPet(px, kind, { boil: i, eyes: 'closed', mouth: 'small', pose: { sy: i % 2 ? 1.02 : 0.98, dy: i % 2 ? -1 : 0 }, tail: 0.25 });
    const zy = kind === 'bird' ? 30 : 40;
    zz(px, 90, zy - i * 4, 6 + i, 1, i);
    if (i >= 2) zz(px, 103, zy - 13 - (i - 2) * 4, 4 + (i - 2), 0.8, i);
  })), 450));

  // 들려 있을 때: 동그란 눈, 벌린 입, 늘어진 앞발 (새는 날개를 퍼덕임)
  write('drag.png', encodeAPNG([0, 1, 2].map((b) => D({
    boil: b, eyes: 'big', mouth: 'open', paws: 'dangle', pose: { sy: 1.05 }, tail: 0.35,
    ...(kind === 'bird' ? { wings: [0.35, -0.1, 0.2][b] } : {}), ...(kind === 'dog' ? { perk: 1.05 } : {}),
  })), 160));

  fs.writeFileSync(path.join(outDir, 'pet.json'), JSON.stringify({
    name: NAMES[kind], size: 128, speed: 80, facing: 'right', sleepAfterSec: 600,
  }, null, 2) + '\n');
}

// 클릭할 때 무작위로 하나씩 재생 (1회)
const CLICKS = {
  jump: (kind, D) => encodeAPNG([
    { pose: { dy: 4, sx: 1.08, sy: 0.9 }, eyes: 'squint' },
    { pose: { dy: -10, sx: 0.96, sy: 1.06 }, eyes: 'happy', tail: -0.2, perk: 1.0 },
    { pose: { dy: -20 }, eyes: 'happy', mouth: 'open', tail: -0.35, perk: 1.12 },
    { pose: { dy: -23 }, eyes: 'happy', mouth: 'open', tail: -0.4, perk: 1.18 },
    { pose: { dy: -16 }, eyes: 'happy', tail: -0.25, perk: 1.12 },
    { pose: { dy: -6, sx: 0.97, sy: 1.04 }, eyes: 'happy', perk: 1.02 },
    { pose: { dy: 4, sx: 1.1, sy: 0.88 }, eyes: 'squint' },
    {},
  ].map((o, i) => D({ boil: i, ...o, // 강아지는 귀가 신남을 보여주므로 점프를 낮게 (선 귀가 위쪽에서 잘리지 않게)
    pose: kind === 'dog' && o.pose ? { ...o.pose, dy: (o.pose.dy || 0) * 0.5 } : o.pose })), 70),
  // 몸은 그대로, 고개만 한쪽으로 갸웃 (궁금한 듯 동그란 눈)
  headTilt: (kind, D) => encodeAPNG([0, 8, 14, 16, 16, 16, 16, 14, 8, 0].map((d, i) =>
    D({ boil: i, headTilt: deg(d), eyes: d >= 14 ? 'big' : 'open', perk: kind === 'dog' && d >= 14 ? 0.5 : 0 })), 90),
  blush: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const mid = i > 0 && i < 7;
    const t = Math.sin((i / 7) * Math.PI);
    return D({ boil: i, eyes: mid ? 'squint' : 'open', paws: mid ? 'cheeks' : 'front', blush: 1 + 0.35 * t, pose: { sx: 1 + 0.04 * t, sy: 1 - 0.04 * t } });
  }), 90),
  tail: (kind, D) => encodeAPNG([0, 0.28, -0.25, 0.3, -0.25, 0.28, -0.15, 0].map((tail, i) =>
    D({ boil: i, tail: kind === 'dog' ? tail * 1.6 : tail, eyes: i === 0 || i === 7 ? 'open' : 'happy', pose: { dy: i % 2 ? -2 : 0 }, perk: i === 0 || i === 7 ? 0 : 1.0 + 0.1 * (i % 2) })), 90),
  heart: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7].map((i) => frame((px) => {
    drawPet(px, kind, { boil: i, eyes: i === 0 || i === 7 ? 'open' : 'happy', pose: { dy: i >= 1 && i <= 6 ? -2 : 0 }, tail: i % 2 ? 0.15 : -0.1 });
    if (i >= 1 && i <= 6) {
      const t = (i - 1) / 5;
      heart(px, 64, 40 - t * 14, 5.5 + t * 3.5, i === 6 ? 0.5 : 1, i);
      if (i >= 3) heart(px, 90, 44 - (t - 0.4) * 14, 3.5 + t * 2, i === 6 ? 0.4 : 0.9, i);
    }
  })), 90),
  // 새: 클릭하면 항상 날개가 보임
  flap: (kind, D) => encodeAPNG([0, 0.45, -0.15, 0.45, -0.15, 0.45, -0.1, 0].map((w, i) =>
    D({ boil: i, wings: w, eyes: i === 0 || i === 7 ? 'open' : 'happy', pose: { dy: -Math.abs(w) * 10 }, feet: [-1, -1], tail: w * 0.4 })), 75),
  birdJump: (kind, D) => encodeAPNG([
    { pose: { dy: 3, sx: 1.06, sy: 0.92 }, eyes: 'squint' }, // 웅크릴 때는 날개를 접음
    { pose: { dy: -10 }, eyes: 'happy', wings: 0.4, mouth: 'open' },
    { pose: { dy: -20 }, eyes: 'happy', wings: -0.1, mouth: 'open' },
    { pose: { dy: -24 }, eyes: 'happy', wings: 0.4, mouth: 'open' },
    { pose: { dy: -18 }, eyes: 'happy', wings: -0.1 },
    { pose: { dy: -8 }, eyes: 'happy', wings: 0.3 },
    { pose: { dy: 3, sx: 1.08, sy: 0.9 }, eyes: 'squint' },
    {},
  ].map((o, i) => D({ boil: i, ...o })), 75),
  birdHeart: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7].map((i) => frame((px) => {
    const mid = i >= 1 && i <= 6;
    drawPet(px, kind, { boil: i, eyes: mid ? 'happy' : 'open', wings: mid ? (i % 2 ? 0.3 : 0.05) : null, pose: { dy: mid ? -3 : 0 } });
    if (mid) {
      const t = (i - 1) / 5;
      heart(px, 64, 26 - t * 12, 5 + t * 3, i === 6 ? 0.5 : 1, i);
    }
  })), 90),
  // 쿼카: 두 앞발로 나뭇잎을 들고 오물오물. 한 입씩 줄어듦
  leaf: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const bite = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4][i], chew = i % 2 === 1;
    return D({ boil: i, eyes: i === 0 ? 'open' : 'crescent', mouth: chew ? 'munch' : 'w', blush: 1 + 0.1 * Math.min(bite, 2),
      pose: { sx: chew ? 1.03 : 1, sy: chew ? 0.98 : 1 }, pawPos: [[-10, -17, 5.6, 4.8], [11, -17, 5.6, 4.8]], props: (ctx) => leafProp(ctx, bite) });
  }), 120),
  // 곰: 꿀단지를 안고 앞발로 꿀을 찍어 할짝할짝
  honey: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const atMouth = [0, 0, 1, 1, 0, 1, 1, 0, 0, 0][i], lick = atMouth && i % 2 === 0, dip = !atMouth && i >= 1 && i <= 8;
    const hand = atMouth ? [13, -27] : dip ? [7, -24] : [12, -14];
    return D({ boil: i, eyes: i >= 8 ? 'happy' : i >= 1 ? 'closed' : 'open', mouth: lick ? 'lick' : 'w', blush: i >= 8 ? 1.2 : 1,
      pawPos: [[-17, -13, 6.5, 5.4], [hand[0], hand[1], 6.5, 5.4]],
      props: (ctx) => honeyPot(ctx),
      afterPaws: i >= 2 && i <= 7 ? ({ F }) => { F(blob(hand[0] + 1, hand[1] - 4, 3.6, 2.4, {}), [255, 192, 60]); F(blob(hand[0] + 3, hand[1] - 1, 1.3, 2.2, {}), [255, 192, 60]); } : null });
  }), 120),
  // 곰: 하품. 입을 크게 벌리고 한쪽 앞발을 입 옆에 갖다 댐, 눈꼬리에 눈물
  stretch: (kind, D) => {
    const P = (y) => [[-12, -12, 6.5, 5.2], [13, y, 6.5, 5.4]];
    return encodeAPNG([
      {}, { eyes: 'closed', mouth: 'small', pawPos: P(-17) },
      { eyes: 'closed', mouth: 'yawn', pawPos: P(-22), pose: { sy: 1.02 } },
      { eyes: 'closed', mouth: 'yawn', pawPos: P(-24), pose: { sy: 1.04 }, tear: true },
      { eyes: 'closed', mouth: 'yawn', pawPos: P(-24), pose: { sy: 1.05, dy: -1 }, tear: true },
      { eyes: 'closed', mouth: 'yawn', pawPos: P(-25), pose: { sy: 1.05, dy: -1 }, tear: true },
      { eyes: 'closed', mouth: 'yawn', pawPos: P(-24), pose: { sy: 1.04 }, tear: true },
      { eyes: 'closed', mouth: 'small', pawPos: P(-19), tear: true },
      { eyes: 'closed', mouth: 'w', pose: { sx: 1.03, sy: 0.97 } },
      { eyes: 'closed', mouth: 'w' }, {},
    ].map((o, i) => D({ boil: i, ...o })), 120);
  },
  // 고양이: 하악질. 눈은 평소 그대로 + 화난 눈썹, 귀를 옆으로 눕히고 꼬리털을 부풀림, 몸을 뒤로 살짝 젖힘
  hiss: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const mid = i >= 1 && i <= 6, open = i >= 2 && i <= 6;
    return D({ boil: i, brows: mid ? 'angry' : null, mouth: open ? 'hiss' : 'w', earsBack: mid ? 1 : 0, puff: mid ? 3 : 0, tail: mid ? -0.35 : 0,
      pose: mid ? { dx: -2 + (i % 2 ? 1 : -1) * 0.8, rot: deg(-4), sx: 1.04, sy: 1.05 } : {} });
  }), 100),
  // 고양이: 사냥 전 엉덩이 씰룩씰룩. 몸을 낮게 웅크리고 눈을 조금 크게 뜬 채 엉덩이를 좌우로 흔듦
  hunt: (kind, D) => encodeAPNG([null, 0, -9, 9, -9, 9, -10, 10, -10, 10, 0, null].map((r, i) => {
    const crouch = r !== null;
    return D({ boil: i, rump: r, eyes: crouch ? 'hunt' : 'open', mouth: crouch ? 'small' : 'w',
      pose: crouch ? { dy: 5, sx: 1.06, sy: 0.88 } : {} });
  }), 85),
  // 고양이: 그루밍. 한쪽 앞발을 입가로 들어 올려 혀로 핥음 (눈 감고)
  groom: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const mid = i >= 1 && i <= 8, lick = mid && i % 2 === 0;
    return D({ boil: i, eyes: mid ? 'closed' : 'open', mouth: lick ? 'lick' : 'w', tail: mid ? 0.12 * (i % 2 ? 1 : -1) : 0,
      pawPos: mid ? [[-12, -12, 6.5, 5.2], [14, lick ? -25 : -21, 7.2, 6.2]] : null, pose: { rot: mid ? deg(4) : 0 } });
  }), 110),
  // 고양이: 몸은 그대로 두고 얼굴만 오른쪽으로 기울여 부비부비 (반달 눈웃음)
  rub: (kind, D) => encodeAPNG([0, 9, 15, 10, 16, 10, 16, 10, 15, 0].map((d, i) =>
    D({ boil: i, headTilt: deg(d), eyes: d ? 'crescent' : 'open', blush: d ? 1.2 : 1, tail: d ? 0.12 * (i % 2 ? 1 : -1) : 0 })), 110),
  // 토끼: 두 앞발로 얼굴 닦기 (세수). 귀 뿌리 근처에서 볼까지 쓸어내리기를 두 번, 눈은 질끈
  wash: (kind, D) => {
    const PATH = [[21, -60], [26, -49], [28, -38], [27, -27]]; // 위 → 아래
    const seq = [null, 0, 1, 2, 3, 0, 1, 2, 3, null];
    return encodeAPNG(seq.map((k, i) => {
      if (k === null) return D({ boil: i });
      const [x, y] = PATH[k], [x2, y2] = PATH[Math.max(0, k - 1)]; // 오른발이 조금 늦게 따라 내려옴
      return D({ boil: i, eyes: 'squint', mouth: 'small', pawPos: [[-x, y, 6.4, 5.6], [x2, y2, 6.4, 5.6]],
        perk: k === 0 ? 0.6 : 0.2, pose: { sy: k === 0 ? 1.02 : 1, dy: k === 0 ? -1 : 0 } });
    }), 110);
  },
  // 강아지: 발라당 (등을 대고 누워 배를 보이고 네 발을 버둥버둥)
  // 구르는 중간 과정 없이 바로 뒤집힌 상태로 시작해서 버둥거린 뒤 바로 대기로 돌아감
  rollover: (kind, D) => encodeAPNG([176, 176, 176, 176, 176, 176, 176, 176].map((d, i) => {
    const up = d >= 160;
    // 뒤집혔을 때 네 발이 배 위로 쭉 올라와 버둥버둥 (로컬 y가 +일수록 화면 위)
    return D({ boil: i, belly: d >= 40, pose: { rot: deg(-d), dy: up ? -2 : d >= 100 ? -13 : d ? -6 : 0 }, eyes: up ? 'happy' : 'open',
      feet: d >= 100 ? (i % 2 ? [9, 5] : [5, 9]) : null, tail: up ? (i % 2 ? 0.3 : -0.3) : 0, perk: up ? 0.6 : 0,
      pawPos: up ? (i % 2 ? [[-8, 4, 6, 5.2], [8, 1, 6, 5.2]] : [[-8, 1, 6, 5.2], [8, 4, 6, 5.2]]) : null });
  }), 90),
  // 토끼: 앞발로 당근을 잡고 뇸뇸. 한 입씩 줄어듦
  carrot: (kind, D) => encodeAPNG([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const bite = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4][i], chew = i % 2 === 1;
    return D({ boil: i, eyes: i === 0 ? 'open' : 'crescent', mouth: chew ? 'munch' : 'w', blush: 1 + 0.12 * Math.min(bite, 2),
      pose: { sx: chew ? 1.03 : 1, sy: chew ? 0.98 : 1 }, pawPos: [[8, -21, 5.2, 4.6], [22, -12, 5.2, 4.6]], props: (ctx) => carrotProp(ctx, bite, i) });
  }), 120),
};

// 꿀단지: 몸 앞 아래쪽에 안고 있는 갈색 단지, 입구에 노란 꿀이 넘쳐 흐름
function honeyPot({ F, part, ph, boil }) {
  const pot = smoothPts([[-13, -20], [-16, -12], [-14, -3], [-8, 0], [8, 0], [14, -3], [16, -12], [13, -20]], 2, 1);
  part(F, polygon(pot), [190, 126, 76], pot, { r: 1.4, rough: 0.3, seed: 85, boil, gaps: [[0.97, 0.03]] });
  F(stroke([[-15, -9], [15, -9]], 0.9), [160, 100, 58]); // 단지 띠
  const rim = blobPts(0, -20, 13, 3.6, { phase: ph });
  part(F, polygon(rim), [255, 196, 64], rim, { r: 1.2, rough: 0.2, seed: 86, boil, gaps: [[0.99, 0.01]] });
  F(polygon(smoothPts([[-9, -20], [-8, -14], [-6.5, -12.5], [-5, -14], [-4, -19]], 2, 1)), [255, 196, 64]); // 흘러내린 꿀
}
// 나뭇잎: 세로로 든 초록 잎. 윗부분(입 쪽)부터 bite만큼 줄어듦
function leafProp({ F, part, boil }, bite) {
  const top = -32 + bite * 3.2, bottom = -8;
  const mid = (top + bottom) / 2, h = bottom - top;
  const leaf = smoothPts([[0, bottom], [-10, mid + h * 0.15], [-7, top + h * 0.2], bite ? [-3, top] : [0, top - 2], ...(bite ? [[0, top + 1.5], [3, top]] : []), [7, top + h * 0.2], [10, mid + h * 0.15]], 2, 1);
  part(F, polygon(leaf), [128, 196, 108], leaf, { r: 1.2, rough: 0.3, seed: 92, boil, gaps: [[0.5, 0.04]] });
  F(stroke([[0, bottom - 1], [0, top + 2]], 0.6), [92, 156, 80]); // 잎맥
  for (const t of [0.35, 0.6]) { const y = bottom - h * t; if (y > top + 2) for (const sd of [-1, 1]) F(stroke([[0, y], [sd * 4, y - 3]], 0.5), [92, 156, 80]); }
  F(stroke([[0, bottom], [1, bottom + 4]], 0.9), [92, 156, 80]); // 꼭지
}
// 당근: 끝(입 쪽)이 bite만큼 줄어듦. 밑동에 초록 잎
function carrotProp({ F, part, ph, boil }, bite, i) {
  const base = [31, -9], tip0 = [2, -27];
  const k = 1 - bite * 0.13;
  const tip = [base[0] + (tip0[0] - base[0]) * k, base[1] + (tip0[1] - base[1]) * k];
  const len = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
  const ux = (tip[0] - base[0]) / len, uy = (tip[1] - base[1]) / len, nx = -uy, ny = ux;
  const at = (t, w) => [base[0] + ux * len * t + nx * w, base[1] + uy * len * t + ny * w];
  for (const [a, l] of [[-0.8, 12], [-0.2, 14], [0.45, 11]]) { // 잎
    const c = Math.cos(a), sn = Math.sin(a), dx = -ux * c + uy * sn, dy = -uy * c - ux * sn;
    const leaf = smoothPts([[base[0], base[1]], [base[0] + dx * l * 0.5 - dy * 2.6, base[1] + dy * l * 0.5 + dx * 2.6], [base[0] + dx * l, base[1] + dy * l], [base[0] + dx * l * 0.5 + dy * 2.6, base[1] + dy * l * 0.5 - dx * 2.6]], 2, 1);
    part(F, polygon(leaf), [126, 196, 108], leaf, { r: 1.1, rough: 0.3, seed: 90 + l, boil, gaps: [[0.98, 0.03]] });
  }
  const tipW = bite ? 2.6 + bite * 0.5 : 0.8; // 베어 문 끝은 뭉툭하고 들쭉날쭉
  const body = smoothPts([at(0, 8), at(0.5, 6.4), at(1, tipW), ...(bite ? [at(1.03, tipW * 0.3), at(0.97, -tipW * 0.2)] : []), at(1, -tipW), at(0.5, -6.4), at(0, -8)], 2, 1);
  part(F, polygon(body), [250, 150, 70], body, { r: 1.3, rough: 0.3, seed: 95, boil, gaps: [[0.5, 0.04]] });
  for (const t of [0.25, 0.5, 0.72]) if (t < 0.95) F(stroke([at(t, -2.5), at(t + 0.04, 0.6)], 0.55), [214, 112, 44]); // 당근 결
  if (bite && i % 2 === 1) for (const [cx, cy] of [[-7, -24], [7, -33], [-4, -19]]) F(blob(cx, cy, 1.1, 1.1, {}), [250, 150, 70]); // 부스러기
}

if (require.main === module) {
makeSet('bear', path.join(ASSETS, 'pets', 'default'), ['jump', 'headTilt', 'blush', 'honey', 'stretch']);
makeSet('cat', path.join(ASSETS, 'pets', 'cat'), ['hiss', 'groom', 'hunt', 'heart', 'rub']);
makeSet('dog', path.join(ASSETS, 'pets', 'dog'), ['jump', 'tail', 'headTilt', 'rollover']);
makeSet('bird', path.join(ASSETS, 'pets', 'bird'), ['flap', 'birdJump', 'birdHeart', 'headTilt']);
makeSet('rabbit', path.join(ASSETS, 'pets', 'rabbit'), ['jump', 'blush', 'heart', 'carrot', 'wash']);
makeSet('quokka', path.join(ASSETS, 'pets', 'quokka'), ['jump', 'headTilt', 'blush', 'heart', 'leaf']);

// ---------- 앱 아이콘, 트레이 아이콘 ----------
// 크기마다 다시 그려야 작은 크기에서도 선명함. 곰이 128 캔버스에서 차지하는 영역(약 x 24~104, y 59~119)을 가운데에 맞춤
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const icons = ICON_SIZES.map((size) => {
  CW = size; CH = size;
  const scale = (size * 0.94) / 84;
  const icon = { scale, ox: size / 2 - scale * 64, oy: size / 2 - scale * 87 };
  return { size, png: encodePNG(frame((px) => drawPet(px, 'bear', { icon })), size, size) };
});
CW = W; CH = H;
fs.writeFileSync(path.join(ASSETS, 'icon.ico'), encodeICO(icons));
fs.writeFileSync(path.join(ASSETS, 'icon.png'), icons[icons.length - 1].png);
fs.writeFileSync(path.join(ASSETS, 'tray.png'), icons.find((i) => i.size === 128).png);
console.log('icon.ico', ICON_SIZES.join(','), '/ icon.png / tray.png');
}

module.exports = { drawPet, frame, heart, encodePNG, W, H };
