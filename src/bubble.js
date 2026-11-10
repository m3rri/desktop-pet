// 말풍선 창. 글자는 이미지가 아니라 HTML 글자로 그림 (퇴근 시간처럼 매번 바뀌는 문구를 보여주기 위해).
// 테두리는 캐릭터와 같은 손그림 느낌: 굵기가 조금씩 변하고, 군데군데 끊기고, 선이 살짝 흔들리며 프레임마다 일렁임.
//
// 순서: 메인이 문구를 보냄(bubble:show) → 글자 크기를 재서 창 크기를 알려줌(bubble:size)
//       → 메인이 창을 캐릭터 위에 놓고 꼬리 위치를 알려줌(bubble:tail) → 그림

const canvas = document.getElementById('bubble');
const ctx = canvas.getContext('2d');
const textEl = document.getElementById('text');

const INK = '#3e2c26';
const MAX_TEXT_W = 360; // 이보다 길면 줄바꿈 (남은 시간 문구가 이모지까지 한 줄에 들어가는 폭)
const PAD_X = 16, PAD_Y = 8;
const MARGIN = 5;       // 흔들린 테두리가 창 밖으로 잘리지 않게 둘레에 남기는 여백
const TAIL_H = 13;      // 아래로 튀어나온 꼬리 길이
const BOIL_MS = 220;

let box = null;         // { w, h } 말풍선 몸통 크기 (꼬리 제외)
let tailX = null;       // 꼬리 끝 x (창 기준)
let boil = 0;
let boilTimer = null;

// ---------- 손그림 외곽선 ----------
// 몸통(둥근 사각형) 둘레를 시계 방향으로 따라가며 점을 찍고, 아래쪽 변 가운데에 꼬리를 끼워 넣음
function outlinePoints(w, h, tx) {
  const x0 = MARGIN, y0 = MARGIN, x1 = MARGIN + w, y1 = MARGIN + h;
  const r = Math.min(h / 2, 22);
  const pts = [];
  const line = (ax, ay, bx, by) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 2));
    for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  };
  const arc = (cx, cy, a0, a1) => {
    const n = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / 2));
    for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  };
  const P = Math.PI;
  line(x0 + r, y0, x1 - r, y0);
  arc(x1 - r, y0 + r, -P / 2, 0);
  line(x1, y0 + r, x1, y1 - r);
  arc(x1 - r, y1 - r, 0, P / 2);
  // 꼬리: 몸통 아래 변에서 살짝 왼쪽으로 기울어 아래로 뾰족하게
  const tb = Math.max(x0 + r + 2, Math.min(x1 - r - 12, tx - 4)); // 꼬리 뿌리 (둥근 모서리에 걸리지 않게)
  line(x1 - r, y1, tb + 11, y1);
  line(tb + 11, y1, tx - 1, y1 + TAIL_H);
  line(tx - 1, y1 + TAIL_H, tb - 1, y1);
  line(tb - 1, y1, x0 + r, y1);
  arc(x0 + r, y1 - r, P / 2, P);
  line(x0, y1 - r, x0, y0 + r);
  arc(x0 + r, y0 + r, P, P * 1.5);
  return pts;
}

// 점마다 바깥쪽(법선) 방향으로 흔들기. 느린 물결(선이 곧지 않게) + 잔떨림(펜 느낌), boil마다 모양이 달라짐
function jitter(pts, b) {
  const N = pts.length;
  return pts.map(([x, y], i) => {
    const [ax, ay] = pts[(i - 1 + N) % N], [bx, by] = pts[(i + 1) % N];
    let nx = by - ay, ny = -(bx - ax);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const d = 0.9 * Math.sin(i * 0.045 + b * 2.1) + 0.45 * Math.sin(i * 0.31 + b * 1.9) + 0.25 * Math.sin(i * 0.77 - b * 1.3);
    return [x + nx * d, y + ny * d];
  });
}

const GAPS = [[0.14, 0.022], [0.58, 0.016], [0.86, 0.012]]; // 선이 끊기는 곳 (둘레 비율, 길이)
function inGap(t) { return GAPS.some(([s, l]) => t >= s && t < s + l); }
function gapDist(t) { return Math.min(...GAPS.map(([s, l]) => Math.min(Math.abs(t - s), Math.abs(t - s - l)))); }

function draw() {
  if (!box || tailX === null) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = box.w + MARGIN * 2, ch = box.h + TAIL_H + MARGIN * 2;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const pts = jitter(outlinePoints(box.w, box.h, tailX), boil);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  // 짧은 선분마다 굵기를 바꿔 그림. 끊긴 곳 가까이에서는 가늘어짐
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    if (inGap(t)) continue;
    const taper = Math.min(1, 0.5 + gapDist(t) * 60);
    ctx.lineWidth = 3.1 * (1 + 0.16 * Math.sin(i * 0.37 + boil * 0.9) + 0.06 * Math.sin(i * 1.1)) * taper;
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % N];
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
}

function startBoil() {
  clearInterval(boilTimer);
  boilTimer = setInterval(() => { boil = (boil + 1) % 3; draw(); }, BOIL_MS);
}

// ---------- 메인 프로세스와 통신 ----------
let showSeq = 0; // 폰트를 기다리는 동안 새 문구가 오면 이전 문구는 버림
window.bubble.onShow(async (text) => {
  const seq = ++showSeq;
  tailX = null;
  textEl.textContent = text;
  textEl.style.maxWidth = `${MAX_TEXT_W}px`;
  textEl.style.left = `${MARGIN + PAD_X}px`;
  textEl.style.top = `${MARGIN + PAD_Y}px`;
  // 폰트를 다 불러온 뒤에 재야 글자 크기가 정확함 (못 불러와도 대체 글꼴로 진행)
  try { await document.fonts.load("21px 'Gaegu'", text); } catch (_) { /* 대체 글꼴 */ }
  if (seq !== showSeq) return;
  const r = textEl.getBoundingClientRect();
  box = { w: Math.ceil(r.width) + PAD_X * 2, h: Math.ceil(r.height) + PAD_Y * 2 };
  window.bubble.size({ width: box.w + MARGIN * 2, height: box.h + TAIL_H + MARGIN * 2 });
});

window.bubble.onTail((x) => {
  tailX = x;
  draw();
  startBoil();
});

window.bubble.onHide(() => clearInterval(boilTimer));
