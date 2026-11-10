// 밥그릇 창. 가득·반쯤·빈 그릇 이미지(APNG, 선이 살짝 일렁임) 중 하나를 보여줌.
// 그릇이 그려진 부분만 클릭·드래그되고 투명한 부분은 뒤 창으로 통과 (캐릭터 창과 같은 방식: 메인이 커서 위치를 보내 줌).
// 더블클릭하면 메인에 알림: 음식이 있으면 캐릭터가 먹으러 오고, 빈 그릇이면 채움
const imgs = { 2: document.getElementById('full'), 1: document.getElementById('half'), 0: document.getElementById('empty') };
const masks = {};   // level -> { w, h, alpha }
let level = 2;
let interactive = false;
const HIT_ALPHA = 40;

function maskOf(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0); // APNG는 첫 프레임 기준 (프레임마다 선만 조금 흔들림)
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  return { w: c.width, h: c.height, alpha };
}

function showLevel(l) {
  level = l;
  for (const [k, img] of Object.entries(imgs)) img.hidden = Number(k) !== level;
}

async function load() {
  const r = await window.bowl.load();
  await Promise.all([[2, r.images.full], [1, r.images.half], [0, r.images.empty]].map(([l, im]) => new Promise((done) => {
    const img = imgs[l];
    img.onload = () => { masks[l] = maskOf(img); done(); };
    img.onerror = () => done();
    img.src = URL.createObjectURL(new Blob([im.data], { type: im.mime }));
  })));
  showLevel(r.level);
}

function setInteractive(v) {
  if (v === interactive) return;
  interactive = v;
  window.bowl.setInteractive(v);
}

// 메인이 보내 주는 창 기준 커서 위치로, 그 자리 픽셀이 불투명한지 판정
window.bowl.onCursor((pos) => {
  if (dragging) return;
  const m = masks[level];
  if (!pos || !m) { setInteractive(false); return; }
  const x = Math.floor((pos.x / window.innerWidth) * m.w), y = Math.floor((pos.y / window.innerHeight) * m.h);
  setInteractive(x >= 0 && y >= 0 && x < m.w && y < m.h && m.alpha[y * m.w + x] > HIT_ALPHA);
});

// 4px 넘게 움직이면 드래그 (이동은 메인이 커서를 따라가며 처리)
let down = null, dragging = false;
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.target.setPointerCapture(e.pointerId);
  down = { x: e.screenX, y: e.screenY };
});
document.addEventListener('pointermove', (e) => {
  if (!down || dragging) return;
  if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) { dragging = true; window.bowl.dragStart(); }
});
// 더블클릭은 DOM dblclick 이벤트 대신 직접 판정 (캐릭터 창과 같은 방식).
// 클릭 통과 창(setIgnoreMouseEvents)을 오가는 Windows 환경에서 dblclick 이벤트가 오지 않는 경우가 있었음
const DBL_MS = 450, DBL_DIST = 8;
let lastClick = null; // { x, y, at }
function endPointer(e, isCancel) {
  if (!down) return;
  if (dragging) { window.bowl.dragEnd(); lastClick = null; }
  else if (!isCancel && e.button === 0) {
    const now = Date.now();
    if (lastClick && now - lastClick.at <= DBL_MS && Math.hypot(e.screenX - lastClick.x, e.screenY - lastClick.y) <= DBL_DIST) {
      lastClick = null;
      window.bowl.dblclick();
    } else {
      lastClick = { x: e.screenX, y: e.screenY, at: now };
    }
  }
  down = null; dragging = false;
}
// 메뉴·설정 창 등으로 포커스가 넘어가면서 pointerup을 못 받으면 누른 상태가 남아 다음 클릭이 꼬이므로 초기화
function resetPointer() {
  if (dragging) window.bowl.dragEnd();
  down = null; dragging = false; lastClick = null;
}
window.addEventListener('blur', resetPointer);
document.addEventListener('lostpointercapture', () => { if (down && !dragging) down = null; });
document.addEventListener('pointerup', (e) => endPointer(e, false));
document.addEventListener('pointercancel', (e) => endPointer(e, true));
document.addEventListener('contextmenu', (e) => { e.preventDefault(); window.bowl.menu(); }); // 캐릭터와 같은 메뉴 + 그릇에서 할 일

window.bowl.onLevel(showLevel);
window.bowl.onReload(load);
load();
