// 캐릭터 이미지를 프레임 단위로 풀어서 canvas에 직접 재생한다.
// GIF/APNG/WebP를 <img>로 띄우면 브라우저가 재생을 맡아 "언제 끝났는지"를 알 수 없기 때문.

const canvas = document.getElementById('pet');
const ctx = canvas.getContext('2d');

const anims = {};        // 상태 이름 -> { loop, frames: [{ bitmap, duration(ms) }] }
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

async function decodeImage(bytes, mime) {
  const frames = await decodeFrames(bytes, mime);
  for (const f of frames) f.alpha = alphaMask(f.bitmap);
  return frames;
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
function play(name) {
  const anim = anims[name] || anims.idle; // 이미지가 없는 상태는 idle로 대체
  if (!anim) return;
  player = {
    name,
    anim,
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

// ---------- 시작 ----------
window.pet.onState((state) => { currentState = state; play(state); });
window.pet.onFacing((f) => { facing = f; dirty = true; });
window.pet.onCursor((pos) => { cursor = pos; updateInteractive(); });

(async () => {
  const data = await window.pet.load();
  size = data.size;
  baseFacing = data.baseFacing;
  facing = data.facing;
  currentState = data.state;

  await Promise.all(Object.entries(data.states).map(async ([name, s]) => {
    anims[name] = { loop: s.loop, frames: await decodeImage(s.data, s.mime) };
  }));

  play(currentState); // 불러오는 동안 바뀐 상태 반영
  requestAnimationFrame(loop);
})();
