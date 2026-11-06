// 캐릭터 이미지를 프레임 단위로 풀어서 canvas에 직접 재생한다.
// GIF/APNG/WebP를 <img>로 띄우면 브라우저가 재생을 맡아 "언제 끝났는지"를 알 수 없기 때문.

const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d');

let anims = {};          // 상태 이름 -> { loop, variants: [{ file, frames: [{ bitmap, duration(ms), alpha }] }], last }
let size = 128;
let baseFacing = 'right';
let facing = 'right';
let currentState = 'idle';
let player = null;       // { name, anim, loop, idx, elapsed, ended }
let dirty = true;
let dpr = 0;
let layout = null;       // 마지막으로 그린 위치·배율 (클릭 판정에 사용)
let cursor = null;       // 창 기준 커서 위치 (창 밖이면 null)
let interactive = false; // false 이면 클릭이 뒤 창으로 통과
const HIT_ALPHA = 40;    // 이 값보다 불투명한 픽셀만 클릭 가능 (0~255)

const STATIC_ONE_SHOT_MS = 600; // 1회 재생 상태인데 정지 이미지 한 장뿐일 때 보여줄 시간
const ONE_SHOT_STATES = new Set(['click']);

// ---------- 디코딩 ----------
// 프레임마다 투명도(alpha) 값만 따로 저장해 두고 클릭 판정에 사용
function alphaMask(bitmap) {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const rgba = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const alpha = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return alpha;
}

async function decodeImage(bytes, mime, { boil = false, loop = true } = {}) {
  let frames = await decodeFrames(bytes, mime);
  if (boil && frames.length === 1) frames = await boilFrames(frames[0].bitmap, loop);
  for (const f of frames) f.alpha = alphaMask(f.bitmap);
  return frames;
}

// ---------- 정지 이미지 선 일렁임 ----------
// 정지 이미지 한 장을 아주 조금씩 다르게 휘게 한 3장으로 만들어 번갈아 보여줌 → 손그림 애니메이션처럼 선이 일렁임.
// 이미지 생성 AI는 같은 그림을 선만 다르게 여러 장 그리지 못하므로 앱이 대신 만듦.
// 픽셀을 부드러운 물결 모양 변위로 옮김 (128px 기준 최대 약 0.9px, 큰 이미지는 크기에 비례)
const BOIL_FRAMES = 3;
const BOIL_MS = 220;
async function boilFrames(bitmap, loop) {
  const w = bitmap.width, h = bitmap.height;
  const src = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  src.drawImage(bitmap, 0, 0);
  const s = src.getImageData(0, 0, w, h).data;
  const amp = 0.9 * Math.max(w, h) / 128;
  const out = [];
  for (let k = 0; k < BOIL_FRAMES; k++) {
    const p = k * 2.1;
    const img = new ImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const dx = amp * (0.6 * Math.sin(2 * Math.PI * (3 * v + 0.5 * u) + p) + 0.4 * Math.sin(2 * Math.PI * (5 * u + 4 * v) + p * 1.7));
        const dy = amp * (0.6 * Math.sin(2 * Math.PI * (3 * u - 0.4 * v) + p * 1.3 + 1) + 0.4 * Math.sin(2 * Math.PI * (4 * u - 5 * v) + p * 0.7 + 2));
        // 양선형 보간으로 원본에서 가져옴
        const sx = Math.min(w - 1.001, Math.max(0, x + dx)), sy = Math.min(h - 1.001, Math.max(0, y + dy));
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          d[o + c] = (s[i00 + c] * (1 - fx) + s[i10 + c] * fx) * (1 - fy) + (s[i01 + c] * (1 - fx) + s[i11 + c] * fx) * fy;
        }
      }
    }
    // 1회 재생 상태(클릭)는 3장을 합쳐 정지 이미지 한 장일 때와 같은 시간(600ms) 동안 보여줌
    out.push({ bitmap: await createImageBitmap(img), duration: loop ? BOIL_MS : STATIC_ONE_SHOT_MS / BOIL_FRAMES });
  }
  return out;
}

async function decodeFrames(bytes, mime) {
  if ('ImageDecoder' in window) {
    try {
      const decoder = new ImageDecoder({ data: bytes, type: mime });
      await decoder.tracks.ready; // 트랙 정보(프레임 수 등)가 준비될 때까지 대기
      await decoder.completed;    // 전체 데이터를 읽어야 GIF 프레임 수가 확정됨
      const count = decoder.tracks.selectedTrack.frameCount;
      const frames = [];
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        const us = image.duration; // 마이크로초. 정지 이미지는 null, 지연 0인 GIF는 0
        frames.push({ bitmap: await createImageBitmap(image), duration: us ? Math.max(us / 1000, 20) : 100 });
        image.close();
      }
      decoder.close();
      if (frames.length) return frames;
    } catch (e) {
      console.warn('ImageDecoder 실패, 정지 이미지로 대체:', mime, e);
    }
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  return [{ bitmap, duration: Infinity }];
}

// ---------- 재생 ----------
// 이미지가 여러 개인 상태는 무작위로 하나 고름. 같은 이미지가 연달아 나오지 않게 직전 것은 제외
function pickVariant(state) {
  const n = state.variants.length;
  let i = Math.floor(Math.random() * n);
  if (n > 1 && i === state.last) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
  state.last = i;
  return state.variants[i];
}

function play(name) {
  const state = anims[name] || anims.idle; // 이미지가 없는 상태는 idle로 대체
  if (!state) return;
  player = {
    name,
    anim: pickVariant(state),
    loop: anims[name] ? anims[name].loop : !ONE_SHOT_STATES.has(name),
    idx: 0,
    elapsed: 0,
    ended: false,
  };
  dirty = true;
}

function frameDuration(p) {
  if (p.anim.frames.length === 1) return p.loop ? Infinity : STATIC_ONE_SHOT_MS;
  return p.anim.frames[p.idx].duration;
}

function advance(dt) {
  const p = player;
  if (!p || p.ended) return;
  p.elapsed += dt;
  let d;
  while (!p.ended && p.elapsed >= (d = frameDuration(p))) {
    p.elapsed -= d;
    if (p.idx + 1 < p.anim.frames.length) {
      p.idx++;
      dirty = true;
    } else if (p.loop) {
      if (p.idx !== 0) { p.idx = 0; dirty = true; }
    } else {
      p.ended = true; // 마지막 프레임에서 멈추고 메인 프로세스에 알림
      window.pet.animEnd(p.name);
    }
  }
}

// ---------- 그리기 ----------
function resizeCanvasIfNeeded() {
  const ratio = window.devicePixelRatio || 1;
  if (ratio === dpr) return;
  dpr = ratio; // 모니터 배율이 바뀌면 선명도를 위해 canvas 해상도를 다시 맞춤
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  dirty = true;
}

function draw() {
  dirty = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!player) return;
  const bmp = player.anim.frames[player.idx].bitmap;
  // 비율 유지, 하단 중앙 정렬: 상태마다 이미지 크기가 달라도 발 위치가 고정됨
  const scale = Math.min(canvas.width / bmp.width, canvas.height / bmp.height);
  const w = bmp.width * scale, h = bmp.height * scale;
  const flipped = facing !== baseFacing;
  if (flipped) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(bmp, (canvas.width - w) / 2, canvas.height - h, w, h);
  layout = { scale, x: (canvas.width - w) / 2, y: canvas.height - h, flipped };
  updateInteractive(); // 프레임이 바뀌면 커서 아래 픽셀도 바뀜
}

// ---------- 투명 영역 클릭 통과 ----------
// 커서 위치(창 기준, DIP)가 현재 프레임의 불투명한 픽셀 위인지
function hitTest(pos) {
  if (!pos || !player || !layout) return false;
  const frame = player.anim.frames[player.idx];
  let cx = pos.x * dpr;
  const cy = pos.y * dpr;
  if (layout.flipped) cx = canvas.width - cx;
  const ix = Math.floor((cx - layout.x) / layout.scale);
  const iy = Math.floor((cy - layout.y) / layout.scale);
  const { width, height } = frame.bitmap;
  // 주변 1픽셀까지 확인해 가는 선이나 가장자리도 잡기 쉽게
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = ix + dx, y = iy + dy;
      if (x >= 0 && y >= 0 && x < width && y < height && frame.alpha[y * width + x] > HIT_ALPHA) return true;
    }
  }
  return false;
}

function updateInteractive() {
  if (down) return; // 누르거나 드래그하는 동안은 바꾸지 않음
  const hit = hitTest(cursor);
  if (hit === interactive) return;
  interactive = hit;
  window.pet.setInteractive(hit);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(1000, now - last); // 창을 숨겼다 다시 보이면 큰 값이 들어오므로 제한
  last = now;
  window.pet.frame(); // 메인 프로세스가 이 시점에 창 위치를 계산 (화면 갱신 주기에 맞춘 이동)
  resizeCanvasIfNeeded();
  advance(dt);
  if (dirty) draw();
  requestAnimationFrame(loop);
}

// ---------- 마우스 ----------
// 4px 이상 움직이면 드래그, 아니면 클릭
let down = null;
let dragging = false;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId); // 커서가 창 밖으로 나가도 pointerup을 받기 위함
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
});

canvas.addEventListener('pointermove', (e) => {
  if (!down || dragging) return;
  if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
    dragging = true;
    window.pet.dragStart(); // 이후 이동은 메인 프로세스가 커서를 따라가며 처리
  }
});

function endPointer(isCancel) {
  if (!down) return;
  if (dragging) window.pet.dragEnd();
  else if (!isCancel) window.pet.click();
  down = null;
  dragging = false;
  updateInteractive();
}
canvas.addEventListener('pointerup', () => endPointer(false));
canvas.addEventListener('pointercancel', () => endPointer(true));

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.menu();
});

// ---------- 트레이 아이콘 ----------
// 대표 이미지 첫 프레임을 16px·32px PNG로 만들어 메인 프로세스에 보냄 (원본이 GIF·WebP여도 됨)
function sendTrayIcon() {
  const bmp = anims.idle && anims.idle.variants[0].frames[0].bitmap;
  if (!bmp) return;
  const make = (px) => {
    const c = document.createElement('canvas');
    c.width = px; c.height = px;
    const g = c.getContext('2d');
    const s = Math.min(px / bmp.width, px / bmp.height);
    g.drawImage(bmp, (px - bmp.width * s) / 2, (px - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    return c.toDataURL('image/png');
  };
  window.pet.setTrayIcon({ x1: make(16), x2: make(32) });
}

// ---------- 시작 / 캐릭터 교체 ----------
window.pet.onState((state) => { currentState = state; play(state); });
window.pet.onFacing((f) => { facing = f; dirty = true; });
window.pet.onCursor((pos) => { cursor = pos; updateInteractive(); });
window.pet.onResize((s) => { size = s; dpr = 0; dirty = true; }); // dpr=0 → 다음 프레임에 canvas 해상도 다시 맞춤
window.pet.onReload(() => loadPet());

let loadSeq = 0;
let started = false;
async function loadPet() {
  const seq = ++loadSeq; // 연달아 바꾸면 마지막 요청만 반영
  const data = await window.pet.load();
  const next = {};
  await Promise.all(Object.entries(data.states).map(async ([name, s]) => {
    const variants = [];
    for (const v of s.variants) {
      try {
        variants.push({ file: v.file, frames: await decodeImage(v.data, v.mime, { boil: data.boilStatic, loop: s.loop }) });
      } catch (e) {
        console.warn('이미지를 읽지 못해 건너뜀:', v.file, e); // 깨진 파일 하나 때문에 상태 전체가 빠지지 않게
      }
    }
    if (variants.length) next[name] = { loop: s.loop, variants, last: -1 };
  }));
  if (seq !== loadSeq) return;
  if (!next.idle) { console.error('idle 이미지를 하나도 읽지 못함'); return; }

  // 다 읽은 뒤에 한 번에 교체 (읽는 동안에는 이전 캐릭터를 계속 보여줌)
  anims = next;
  size = data.size;
  baseFacing = data.baseFacing;
  facing = data.facing;
  currentState = data.state;
  dpr = 0;
  play(currentState);
  sendTrayIcon();
  if (!started) { started = true; requestAnimationFrame(loop); }
}

loadPet();
