const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen, ipcMain, powerMonitor, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { clamp, displayKey, resolveDisplay, fitInto, displayMenuLabel } = require('./displays');
const { createFullscreenDetector } = require('./fullscreen');
const { countdownMessage, dueAlert, validateCountdown } = require('./countdown');

// 설정·로그 폴더를 %APPDATA%\desktop-pet 으로 고정.
// 설치판은 productName("Desktop Pet")이 앱 이름이 되어 폴더가 %APPDATA%\Desktop Pet 으로 바뀌므로,
// zip판에서 쓰던 설정을 그대로 이어 쓰도록 이름을 따로 지정. 단일 실행 잠금보다 먼저 해야 함
app.setPath('userData', path.join(app.getPath('appData'), 'desktop-pet'));
const { listPets, choosePet, effectiveValues, loadPetFromDir, previewOf, hasIdle, loadBowlImages } = require('./pets');

const ASSETS = path.join(__dirname, '..', 'assets');
const TRAY_ICON = path.join(ASSETS, 'tray.png');
const BUILTIN_PETS = path.join(ASSETS, 'pets');
const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+P';
const shortcutLabel = (acc) => acc.replace('CommandOrControl', 'Ctrl');
// 이동은 렌더러가 화면을 그릴 때마다(requestAnimationFrame) 보내는 'pet:frame' 신호에 맞춰 계산.
// setInterval은 Windows 타이머 정밀도(약 15.6ms, 배터리 모드에서 더 불규칙)에 묶여 움직임이 끊겨 보였음.
// 렌더러 신호가 끊기면(창이 가려져 그리기가 멈춘 경우 등) 아래 주기로 대신 계산
const FALLBACK_TICK_MS = 100;
const FRAME_TIMEOUT_MS = 200;
const FULLSCREEN_CHECK_MS = 1000;

let win = null;
let tray = null;
let settingsWin = null;
let bubbleWin = null;    // 말풍선 창 (캐릭터 창과 따로 띄워 캐릭터 위에 붙여 다님)
let bowlWin = null;      // 밥그릇 창 (화면에 고정, 드래그로 옮김)
let pet = null;          // 지금 캐릭터 (pets.js loadPetFromDir 결과 + size/speed/sleepAfterSec 실제 적용값)
let quitting = false;
let settings = {
  display: null,           // 표시할 모니터 식별 정보. null 이면 자동(지금 있는 모니터)
  hideOnFullscreen: true,  // 전체 화면 앱이 같은 모니터에 있으면 숨김
  pet: null,               // 캐릭터 id ('builtin:default', 'builtin:cat', 'folder:<경로>'). null 이면 기본 순서
  petFolders: [],          // 설정 화면에서 추가한 캐릭터 폴더
  size: null,              // 아래 셋은 null 이면 캐릭터의 pet.json 값
  speed: null,
  sleepAfterSec: null,
  shortcut: DEFAULT_SHORTCUT,
  boilStatic: true,        // 정지 이미지 외곽선을 손그림처럼 일렁이게 (렌더러가 휘게 한 3장을 번갈아 보여줌)
  // 남은 시간 알림 (더블클릭 3번 중 1번). mode: 'work' 매일 퇴근 시각 / 'deadline' 마감 날짜·시각(YYYY-MM-DDTHH:MM) / 'off'
  // deadlineKind: 마감 종류 (exam 시험, assignment 과제, manuscript 원고, project 프로젝트, other 기타)
  // notify: 정해진 시점(퇴근 1시간·30분·10분 전·정각 / 마감 하루·1시간·10분 전·정각)에 더블클릭하지 않아도 먼저 알려줌
  countdown: { mode: 'work', workEnd: '18:00', deadline: null, deadlineKind: 'exam', notify: true },
  // 밥그릇: show 보이기, x·y 창 위치(null이면 화면 오른쪽 아래), level 남은 음식 (2 가득 / 1 반쯤 / 0 빈 그릇)
  bowl: { show: true, x: null, y: null, level: 2 },
};
const DEFAULT_COUNTDOWN = { ...settings.countdown };
const DEFAULT_BOWL = { ...settings.bowl };

// 보이기/숨기기: 사용자가 숨긴 것과 전체 화면 때문에 자동으로 숨긴 것을 따로 관리
const visibility = {
  userHidden: false,
  autoHidden: false,
  // 전체 화면 중에 사용자가 직접 다시 보이게 했으면, 그 전체 화면이 끝날 때까지 자동 숨김 안 함
  autoHideSuppressed: false,
};
let fullscreenDisplayId = null; // 전체 화면 감지 함수. Windows가 아니거나 감지를 못 쓰면 null

// ---------- 로그 (%APPDATA%\desktop-pet\main.log) ----------
function log(...args) {
  const line = `[${new Date().toISOString()}] pid=${process.pid} ${args.join(' ')}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), line); } catch (_) { /* 무시 */ }
}

// ---------- 캐릭터 불러오기 ----------
const userPetDir = () => path.join(app.getPath('userData'), 'pet');

function availablePets() {
  return listPets({ builtinRoot: BUILTIN_PETS, userPetDir: userPetDir(), extraDirs: settings.petFolders, log });
}

// 설정에서 고른 캐릭터를 불러옴. 불러오지 못하면 기본 순서(사용자 폴더 → 곰)로 다시 시도
function loadCurrentPet() {
  const pets = availablePets();
  const tried = new Set();
  for (let choice = choosePet(pets, settings.pet); choice && !tried.has(choice.id); choice = choosePet(pets.filter((p) => !tried.has(p.id)), null)) {
    tried.add(choice.id);
    try {
      const loaded = loadPetFromDir(choice.dir, { id: choice.id, log });
      loaded.name = choice.name;
      Object.assign(loaded, effectiveValues(loaded.base, settings));
      loaded.bowl = loadBowlImages(choice.dir) || loadBowlImages(path.join(ASSETS, 'bowl')); // 캐릭터 밥그릇이 없으면 기본(사료)
      log('pet loaded:', choice.id, Object.entries(loaded.states).map(([n, st]) => `${n}(${st.variants.map((v) => v.file).join(',')})`).join(' '));
      return loaded;
    } catch (e) {
      log('pet load failed:', choice.id, e.message);
    }
  }
  throw new Error('idle 이미지가 있는 캐릭터 폴더를 찾을 수 없음');
}

// ---------- 설정 (%APPDATA%\desktop-pet\settings.json) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
    settings.countdown = { ...DEFAULT_COUNTDOWN, ...(settings.countdown || {}) }; // 예전 설정 파일에는 없음
    settings.bowl = { ...DEFAULT_BOWL, ...(settings.bowl || {}) };
  } catch (e) {
    if (e.code !== 'ENOENT') log('settings 읽기 실패, 기본값 사용:', e.message);
  }
}

function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { log('save settings failed:', e.message); }
}

// ---------- 모니터 ----------
// 고정 모니터가 설정되어 있으면 그 모니터, 연결되어 있지 않으면 주 모니터.
// 설정은 지우지 않으므로 모니터를 다시 연결하면 원래 모니터로 돌아감
function fixedDisplay() {
  if (!settings.display) return null;
  return resolveDisplay(settings.display, screen.getAllDisplays()) || screen.getPrimaryDisplay();
}

// 캐릭터가 머물 모니터: 고정 모니터, 또는 자동이면 창이 지금 있는 모니터
function activeDisplay() {
  return fixedDisplay() || screen.getDisplayMatching(win.getBounds());
}

// 창을 대상 모니터 안으로 맞추고, 걷는 중이었으면 멈춤 (목표 지점이 다른 모니터일 수 있음)
function ensureOnDisplay(display) {
  if (!win || win.isDestroyed()) return;
  syncPositionFromWindow();
  const p = fitInto({ x: behavior.x, y: behavior.y }, pet.size, display);
  if (Math.round(p.x) !== Math.round(behavior.x) || Math.round(p.y) !== Math.round(behavior.y)) {
    behavior.x = p.x; behavior.y = p.y;
    moveWindow(p.x, p.y);
  }
  if (behavior.state === 'walk') { setState('idle'); scheduleNextMove(); }
}

function setDisplaySetting(display) {
  settings.display = display ? displayKey(display) : null;
  saveSettings();
  log('display setting:', display ? `${display.label} ${JSON.stringify(display.bounds)}` : 'auto');
  ensureOnDisplay(activeDisplay());
  updateTrayMenu();
  notifySettingsChanged();
}

// 모니터 연결·해제·해상도/배율 변경. 이벤트가 연달아 오므로 마지막 이벤트 후 한 번만 처리
let displayChangeTimer = null;
function onDisplaysChanged(reason) {
  clearTimeout(displayChangeTimer);
  displayChangeTimer = setTimeout(() => {
    log('displays changed:', reason, screen.getAllDisplays().map((d) => `${d.label}${JSON.stringify(d.bounds)}`).join(' '));
    ensureOnDisplay(activeDisplay());
    if (bowlWin && !bowlWin.isDestroyed()) { // 그릇이 있던 모니터를 빼면 보이는 곳으로
      const b = bowlStartBounds();
      bowlWin.setBounds(b);
    }
    updateTrayMenu();
    notifySettingsChanged();
  }, 500);
}

// ---------- 위치 저장/복원 ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadPosition() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (_) { /* 첫 실행이거나 파일이 깨진 경우 */ }
  const s = pet.size;
  const display = fixedDisplay()
    || (saved ? screen.getDisplayNearestPoint({ x: Math.round(saved.x + s / 2), y: Math.round(saved.y + s / 2) }) : null)
    || screen.getPrimaryDisplay();
  return fitInto(saved, s, display); // 모니터 밖이면 그 모니터의 오른쪽 아래
}

function savePosition() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ x, y })); } catch (e) { log('save position failed:', e.message); }
}

// 캐릭터 크기가 바뀌면 발 위치(하단 중앙)를 고정한 채 창 크기를 바꿈
function resizePetWindow(oldSize) {
  if (!win || win.isDestroyed() || oldSize === pet.size) return;
  syncPositionFromWindow();
  behavior.x += (oldSize - pet.size) / 2;
  behavior.y += oldSize - pet.size;
  moveWindow(behavior.x, behavior.y);
  ensureOnDisplay(activeDisplay());
  sendToPet('pet:resize', pet.size);
  resizeBowl();
}

// 크기·속도·잠드는 시간 다시 계산 (이미지는 다시 읽지 않음)
function applyPetValues() {
  const oldSize = pet.size;
  Object.assign(pet, effectiveValues(pet.base, settings));
  resizePetWindow(oldSize);
}

// 캐릭터 교체 또는 같은 폴더 다시 불러오기 (재시작 없이)
function reloadPet() {
  const oldSize = pet.size;
  pet = loadCurrentPet();
  resizePetWindow(oldSize);
  if (tray) tray.setToolTip(`Desktop Pet - ${pet.name}`);
  sendToPet('pet:reload'); // 렌더러가 pet:load로 이미지를 다시 받아 디코딩
  hideBubble();
  cancelEat();
  if (bowlWin && !bowlWin.isDestroyed()) bowlWin.webContents.send('bowl:reload'); // 캐릭터마다 음식이 다름
  if (behavior.state === 'walk') { setState('idle'); scheduleNextMove(); }
}

// ---------- 행동 (상태 전환 + 이동) ----------
const behavior = {
  state: 'idle',
  facing: 'right',
  x: 0, y: 0,          // 창 위치 (소수점까지 유지해야 느린 속도에서도 부드럽게 움직임)
  target: null,
  nextMoveAt: 0,
  lastTick: Date.now(),
  lastFrameAt: 0,
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  mission: null,       // 'eat' 밥 먹으러 가는 중 / 'eating' 먹는 중
  cursorInside: false,
  talkUntil: 0,        // 말풍선을 띄운 동안은 걷기 시작하지 않음
};

const rand = (min, max) => min + Math.random() * (max - min);

function sendToPet(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setState(state, { force = false } = {}) {
  if (behavior.state === state && !force) return;
  behavior.state = state;
  sendToPet('pet:state', state);
}

function setFacing(facing) {
  if (behavior.facing === facing) return;
  behavior.facing = facing;
  sendToPet('pet:facing', facing);
}

function scheduleNextMove() {
  behavior.nextMoveAt = Date.now() + rand(2000, 6000);
}

function syncPositionFromWindow() {
  const [x, y] = win.getPosition();
  behavior.x = x; behavior.y = y;
}

// 창 크기를 함께 지정: DPI 배율이 다른 모니터로 넘어갈 때 창 크기가 변하는 문제 방지
function moveWindow(x, y) {
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: pet.size, height: pet.size });
  if (bubble.visible) positionBubble();
}

// ---------- 말풍선 (더블클릭) ----------
// 글자는 이미지가 아니라 bubble.html에서 글자로 그림 (나중에 퇴근 시간 알림처럼 매번 바뀌는 문구를 쓰기 위해)
const DEFAULT_PHRASES = ['안녕!', '오늘도 수고했어', '쉬엄쉬엄 해', '물 한 잔 마시자', '기지개 한 번 켜자', '뭐 해?'];
const bubble = { visible: false, width: 0, height: 0, tailX: null, hideTimer: null, ms: 0, lastPhrase: null, talkCount: 0,
  text: '', live: null, liveTimer: null }; // live: 남은 시간 문구면 { r } (떠 있는 동안 1초마다 다시 계산. r은 무작위 문구를 고정하는 값)

function createBubbleWindow() {
  bubbleWin = new BrowserWindow({
    width: 10, height: 10, show: false,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, alwaysOnTop: true,
    focusable: false, // 말풍선이 떠도 다른 창의 포커스를 뺏지 않음
    webPreferences: {
      preload: path.join(__dirname, 'bubble-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  bubbleWin.setIgnoreMouseEvents(true); // 말풍선은 클릭이 항상 뒤로 통과
  bubbleWin.loadFile(path.join(__dirname, 'bubble.html'));
}

// 캐릭터 머리 위에 말풍선 꼬리 끝이 오도록. 화면 밖으로 나가면 안쪽으로 밀고 꼬리 위치로 캐릭터를 가리킴
function positionBubble() {
  if (!bubbleWin || bubbleWin.isDestroyed() || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  const a = activeDisplay().workArea;
  const cx = b.x + b.width / 2;
  const tipY = b.y + Math.round(pet.size * 0.4); // 128 캔버스 기준 캐릭터 머리 윗부분 근처
  const x = Math.round(clamp(cx - bubble.width / 2, a.x, a.x + a.width - bubble.width));
  const y = Math.round(Math.max(a.y, tipY - bubble.height));
  const tailX = Math.round(clamp(cx - x, 24, bubble.width - 24));
  bubbleWin.setBounds({ x, y, width: bubble.width, height: bubble.height });
  if (tailX !== bubble.tailX) {
    bubble.tailX = tailX;
    bubbleWin.webContents.send('bubble:tail', tailX);
  }
}

function stopLive() {
  clearInterval(bubble.liveTimer);
  bubble.liveTimer = null;
}

// 남은 시간 문구는 말풍선이 떠 있는 동안 1초마다 다시 계산해서, 바뀌면(초가 줄어들면) 글자만 바꿈
function startLive() {
  stopLive();
  if (!bubble.live) return;
  bubble.liveTimer = setInterval(() => {
    const text = countdownMessage(settings.countdown, new Date(), () => bubble.live.r);
    if (!text || text === bubble.text || !bubbleWin || bubbleWin.isDestroyed()) return;
    bubble.text = text;
    bubbleWin.webContents.send('bubble:update', text);
  }, 1000);
}

function showBubble(text, ms, live = null) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  clearTimeout(bubble.hideTimer);
  stopLive();
  bubble.live = live;
  bubble.text = text;
  bubble.ms = ms;
  bubble.tailX = null;
  bubbleWin.webContents.send('bubble:show', text); // 크기를 재서 bubble:size로 알려주면 그때 띄움
}

function hideBubble() {
  clearTimeout(bubble.hideTimer);
  stopLive();
  bubble.live = null;
  if (!bubble.visible) return;
  bubble.visible = false;
  behavior.talkUntil = 0;
  if (bubbleWin && !bubbleWin.isDestroyed()) {
    bubbleWin.webContents.send('bubble:hide');
    bubbleWin.hide();
  }
}

// 캐릭터 pet.json의 phrases에서 무작위 (직전과 같은 대사는 피함)
function pickPhrase() {
  const list = pet.phrases && pet.phrases.length ? pet.phrases : DEFAULT_PHRASES;
  const pool = list.length > 1 ? list.filter((p) => p !== bubble.lastPhrase) : list;
  const text = pool[Math.floor(Math.random() * pool.length)];
  bubble.lastPhrase = text;
  return text;
}

// 더블클릭: 걷거나 자던 중이면 멈추고 대사를 말함. 캐릭터에 dblclick 이미지가 있으면 그 동작도 재생.
// 3번째 더블클릭마다 퇴근(또는 마감)까지 남은 시간을 알려줌. 알림을 끄면 항상 평소 대사
function talk() {
  bubble.talkCount += 1;
  const r = Math.random();
  const countdown = bubble.talkCount % 3 === 0 ? countdownMessage(settings.countdown, new Date(), () => r) : null;
  const text = countdown || pickPhrase();
  const ms = clamp(2000 + text.length * 100, 2500, 6000); // 긴 문장은 오래 보여줌
  behavior.talkUntil = Date.now() + ms;
  if (pet.states.dblclick) setState('dblclick', { force: true });
  else if (behavior.state !== 'idle') setState('idle');
  showBubble(text, ms, countdown ? { r } : null);
}

// ---------- 먼저 알려주기 (퇴근·마감 시점) ----------
// 1초마다 지난 확인 이후 알릴 시점이 지나갔는지 봄 (늦게 확인하면 "퇴근까지 9분 56초"처럼 딱 떨어지지 않음). 앱을 켠 시각부터 세므로 켜자마자 지난 알림이 뜨지 않음.
// 절전에서 깨어나는 등으로 알릴 시점이 5분 넘게 지났으면 알리지 않음 (늦게 뜨면 의미가 없음)
const ALERT_CHECK_MS = 1000;
const ALERT_LATE_MS = 5 * 60 * 1000;
const ALERT_SHOW_MS = 8000;
const alerts = { prev: new Date(), fired: new Set() };

function checkAlerts() {
  const now = new Date();
  const due = dueAlert(settings.countdown, alerts.prev, now);
  alerts.prev = now;
  if (!due || alerts.fired.has(due.key) || now - due.at > ALERT_LATE_MS) return;
  alerts.fired.add(due.key);
  if (!win || win.isDestroyed() || !win.isVisible() || behavior.dragging) { log('alert skipped (hidden or dragging):', due.key); return; }
  const r = Math.random();
  const text = countdownMessage(settings.countdown, now, () => r);
  if (!text) return;
  log('alert:', due.key, text);
  if (!behavior.mission) setState('click', { force: true }); // 눈에 띄게 클릭 동작 하나를 재생하면서 말함 (밥 먹으러 가거나 먹는 중이면 그대로)
  behavior.talkUntil = Date.now() + ALERT_SHOW_MS;
  showBubble(text, ALERT_SHOW_MS, { r });
}

// 머물 모니터의 작업 영역 안에서, 지금 위치 근처의 임의 지점
function pickTarget() {
  const a = activeDisplay().workArea;
  const s = pet.size;
  return {
    x: clamp(behavior.x + rand(-400, 400), a.x, a.x + a.width - s),
    y: clamp(behavior.y + rand(-250, 250), a.y, a.y + a.height - s),
  };
}

// 드래그 중: 렌더러 좌표 대신 OS 커서 위치를 직접 따라감 (창이 움직이는 동안 렌더러 좌표가 흔들리는 문제 방지)
function followCursor() {
  const p = screen.getCursorScreenPoint();
  behavior.x = p.x - behavior.dragOffset.x;
  behavior.y = p.y - behavior.dragOffset.y;
  moveWindow(behavior.x, behavior.y);
}

// 커서가 창 위에 있으면 창 기준 좌표를 렌더러에 보냄 (투명 영역 클릭 통과 판정용).
// 창이 걸어서 커서 아래로 들어온 경우처럼 마우스가 안 움직여도 판정해야 해서 매 프레임 확인
function updateCursor() {
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const rel = { x: c.x - b.x, y: c.y - b.y };
  const inside = rel.x >= 0 && rel.y >= 0 && rel.x < b.width && rel.y < b.height;
  if (inside || behavior.cursorInside) sendToPet('pet:cursor', inside ? rel : null);
  behavior.cursorInside = inside;
}

function tick() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - behavior.lastTick) / 1000);
  behavior.lastTick = now;
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  if (behavior.dragging) { followCursor(); return; }
  updateCursor();
  updateBowlCursor();

  // 잠자기: OS 기준으로 키보드·마우스 입력이 없던 시간
  const idleSec = powerMonitor.getSystemIdleTime();
  if (behavior.state === 'sleep') {
    if (idleSec < 1) { setState('idle'); scheduleNextMove(); }
    return;
  }
  const busy = behavior.state === 'click' || behavior.state === 'dblclick' || behavior.state === 'eat' || !!behavior.mission;
  if (pet.sleepAfterSec > 0 && idleSec >= pet.sleepAfterSec && !busy && now >= behavior.talkUntil) { // 0 = 안 잠
    setState('sleep');
    return;
  }

  if (busy && behavior.mission !== 'eat') return; // 렌더러가 재생 종료를 알려줄 때까지 대기 (밥 먹으러 가는 중이면 계속 걸음)

  if (behavior.state === 'idle' && now >= behavior.nextMoveAt && now >= behavior.talkUntil && pet.speed > 0) { // 0 = 안 움직임
    behavior.target = pickTarget();
    setState('walk');
  }

  if (behavior.state === 'walk') {
    if (behavior.mission === 'eat') behavior.target = eatSpot(); // 가는 도중에 그릇을 옮겨도 따라감
    const dx = behavior.target.x - behavior.x;
    const dy = behavior.target.y - behavior.y;
    const dist = Math.hypot(dx, dy);
    const step = (behavior.mission === 'eat' ? (pet.speed > 0 ? pet.speed : 80) * EAT_SPEED : pet.speed) * dt; // 제자리 설정이어도 밥은 먹으러 옴
    if (Math.abs(dx) > 1) setFacing(dx < 0 ? 'left' : 'right');
    if (dist <= step || step <= 0) {
      behavior.x = behavior.target.x; behavior.y = behavior.target.y;
      if (behavior.mission === 'eat') { moveWindow(behavior.x, behavior.y); arriveEat(); return; }
      setState('idle');
      scheduleNextMove();
    } else {
      behavior.x += (dx / dist) * step;
      behavior.y += (dy / dist) * step;
    }
    moveWindow(behavior.x, behavior.y);
  }
}

// ---------- 밥그릇 ----------
// 캐릭터와 별개인 투명 창. 이미지는 112x72 (캐릭터 128 기준)라 캐릭터 크기 설정에 맞춰 같이 커지고 작아짐.
// 더블클릭: 음식이 있으면 캐릭터가 평소보다 5% 빠르게 걸어와서 먹음 / 빈 그릇이면 다시 채움
const BOWL_IMG = { w: 112, h: 72 };
const BOWL_FEET_Y = 44;      // 먹을 때 캐릭터 발이 오는 높이 (그릇 이미지 기준). 아래쪽 몸은 그릇에 가려짐
const EAT_SPEED = 1.05;      // 밥 먹으러 갈 때 속도 배율 (묘하게 빠르게)
const EAT_MS = 5000;         // 먹는 시간. 절반이 지나면 반쯤, 다 먹으면 빈 그릇
const EAT_PHRASES = ['냠냠 잘 먹었다! 😋', '배불러~ 😊', '맛있었어! 또 줘'];
const bowlDrag = { active: false, offset: { x: 0, y: 0 }, timer: null, interactive: false };
let eatTimers = [];

const bowlScale = () => pet.size / 128;
const bowlSize = () => ({ width: Math.round(BOWL_IMG.w * bowlScale()), height: Math.round(BOWL_IMG.h * bowlScale()) });

// 저장된 위치가 없거나 연결된 모니터 밖이면 캐릭터가 있는 모니터의 오른쪽 아래
function bowlStartBounds() {
  const { width, height } = bowlSize();
  const { x, y } = settings.bowl;
  if (x !== null && y !== null) {
    const onScreen = screen.getAllDisplays().some((d) => x + width / 2 >= d.bounds.x && x + width / 2 < d.bounds.x + d.bounds.width && y + height / 2 >= d.bounds.y && y + height / 2 < d.bounds.y + d.bounds.height);
    if (onScreen) return { x, y, width, height };
  }
  const a = (win && !win.isDestroyed() ? activeDisplay() : screen.getPrimaryDisplay()).workArea;
  return { x: a.x + a.width - width - 40, y: a.y + a.height - height - 20, width, height };
}

function createBowlWindow() {
  if (bowlWin && !bowlWin.isDestroyed()) return;
  bowlWin = new BrowserWindow({
    ...bowlStartBounds(), show: false,
    transparent: true, frame: false, resizable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true,
    // focusable: false로 두면 설정 창을 열었다 닫은 뒤 그릇이 클릭·드래그를 받지 못했음 (Windows).
    // 캐릭터 창처럼 포커스를 받을 수 있게 두고, 띄울 때만 showInactive로 다른 창의 포커스를 뺏지 않음
    webPreferences: { preload: path.join(__dirname, 'bowl-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  bowlWin.setAlwaysOnTop(true, 'screen-saver');
  bowlWin.setIgnoreMouseEvents(true, { forward: true }); // 그릇이 그려진 곳에 커서가 오면 렌더러가 해제
  bowlWin.loadFile(path.join(__dirname, 'bowl.html'));
  bowlWin.once('ready-to-show', applyBowlVisibility);
  bowlWin.on('closed', () => { bowlWin = null; });
}

function applyBowlVisibility() {
  if (!bowlWin || bowlWin.isDestroyed()) return;
  const show = settings.bowl.show && win && !win.isDestroyed() && win.isVisible();
  if (show && !bowlWin.isVisible()) bowlWin.showInactive();
  else if (!show && bowlWin.isVisible()) bowlWin.hide();
}

// 캐릭터 크기가 바뀌면 그릇도 아래 가운데를 고정한 채 크기를 바꿈
function resizeBowl() {
  if (!bowlWin || bowlWin.isDestroyed()) return;
  const b = bowlWin.getBounds(), { width, height } = bowlSize();
  if (b.width === width && b.height === height) return;
  bowlWin.setBounds({ x: Math.round(b.x + (b.width - width) / 2), y: b.y + b.height - height, width, height });
}

function setBowlLevel(level) {
  settings.bowl.level = level;
  saveSettings();
  if (bowlWin && !bowlWin.isDestroyed()) bowlWin.webContents.send('bowl:level', level);
}

// 먹을 때 캐릭터 창 위치: 그릇 가운데 뒤에 서서 발이 그릇 안쪽 높이에 오게
function eatSpot() {
  const b = bowlWin.getBounds(), k = bowlScale();
  return { x: b.x + b.width / 2 - pet.size / 2, y: b.y + BOWL_FEET_Y * k - 118 * k };
}

function startEat() {
  if (!bowlWin || behavior.dragging || behavior.mission) return;
  // 표시할 모니터를 고정해 두었으면 다른 모니터의 그릇까지는 가지 않음
  const fixed = fixedDisplay();
  if (fixed && screen.getDisplayMatching(bowlWin.getBounds()).id !== fixed.id) {
    showBubble('밥그릇이 너무 멀어 😢', 3000);
    return;
  }
  hideBubble();
  behavior.mission = 'eat';
  behavior.target = eatSpot();
  setState('walk');
  log('eat: go to bowl');
}

function arriveEat() {
  behavior.mission = 'eating';
  setState(pet.states.eat ? 'eat' : 'idle');
  if (bowlWin && !bowlWin.isDestroyed()) bowlWin.moveTop(); // 그릇이 캐릭터 앞에 오게
  eatTimers = [
    setTimeout(() => setBowlLevel(1), EAT_MS / 2),
    setTimeout(() => {
      setBowlLevel(0);
      behavior.mission = null;
      setState('idle');
      scheduleNextMove();
      const text = EAT_PHRASES[Math.floor(Math.random() * EAT_PHRASES.length)];
      behavior.talkUntil = Date.now() + 2500;
      showBubble(text, 2500);
      log('eat: done');
    }, EAT_MS),
  ];
}

// 밥그릇 더블클릭·우클릭 메뉴: 빈 그릇이면 다시 채우고, 음식이 있으면 캐릭터를 부름
function bowlAction() {
  if (settings.bowl.level === 0) { setBowlLevel(2); log('bowl: refill'); return; }
  startEat();
}

// 끌거나 클릭하는 등으로 밥 먹기를 그만둠. 먹던 음식은 그대로
function cancelEat() {
  eatTimers.forEach(clearTimeout);
  eatTimers = [];
  if (!behavior.mission) return;
  const wasEating = behavior.mission === 'eating';
  behavior.mission = null;
  if (wasEating && behavior.state === 'eat') { setState('idle'); scheduleNextMove(); }
}

// 다른 창(설정 창 등)이 포커스를 가져갔다 돌아오면 클릭 통과 상태가 풀리거나 꼬이는 경우가 있어서 다시 적용.
// 렌더러도 지금 커서 위치로 다시 판정하게 커서 정보를 한 번 새로 보냄
function resyncMouseWindows() {
  if (bowlWin && !bowlWin.isDestroyed()) {
    bowlWin.setIgnoreMouseEvents(!bowlDrag.interactive, { forward: true });
    bowlDrag.cursorInside = true; // 다음 updateBowlCursor에서 커서가 밖이어도 null을 한 번 보냄
  }
  behavior.cursorInside = true;
  log('mouse windows resynced');
}

// 밥그릇 위 커서 위치를 렌더러에 보냄 (투명 영역 클릭 통과 판정용)
function updateBowlCursor() {
  if (!bowlWin || bowlWin.isDestroyed() || !bowlWin.isVisible() || bowlDrag.active) return;
  const c = screen.getCursorScreenPoint(), b = bowlWin.getBounds();
  const rel = { x: c.x - b.x, y: c.y - b.y };
  const inside = rel.x >= 0 && rel.y >= 0 && rel.x < b.width && rel.y < b.height;
  if (inside || bowlDrag.cursorInside) bowlWin.webContents.send('bowl:cursor', inside ? rel : null);
  bowlDrag.cursorInside = inside;
}

// ---------- 렌더러와 통신 ----------
function registerIpc() {
  // 렌더러가 시작할 때 캐릭터 이미지와 현재 상태를 요청
  ipcMain.handle('pet:load', () => ({
    id: pet.id,
    boilStatic: settings.boilStatic,
    size: pet.size,
    baseFacing: pet.facing,
    facing: behavior.facing,
    state: behavior.state,
    states: Object.fromEntries(Object.entries(pet.states)
      .map(([name, s]) => [name, {
        loop: s.loop,
        variants: s.variants.map((v) => ({ file: v.file, mime: v.mime, data: v.data })),
      }])),
  }));

  ipcMain.on('pet:click', () => {
    if (behavior.dragging) return;
    cancelEat();
    setState('click', { force: true }); // 재생 중에 다시 클릭하면 처음부터
  });

  ipcMain.on('pet:dblclick', () => {
    if (behavior.dragging) return;
    cancelEat();
    talk();
  });

  // 말풍선 창이 글자 크기를 재서 알려주면 캐릭터 위에 띄우고, 정한 시간 뒤에 숨김
  ipcMain.on('bubble:size', (_e, { width, height }) => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    bubble.width = Math.ceil(width);
    bubble.height = Math.ceil(height);
    bubble.visible = true;
    positionBubble();
    if (!bubbleWin.isVisible()) bubbleWin.showInactive();
    bubble.hideTimer = setTimeout(hideBubble, bubble.ms);
    startLive();
  });

  // ---------- 밥그릇 창 ----------
  ipcMain.handle('bowl:load', () => ({ images: pet.bowl, level: settings.bowl.level }));
  ipcMain.on('bowl:set-interactive', (_e, v) => {
    bowlDrag.interactive = !!v;
    if (bowlWin && !bowlWin.isDestroyed()) bowlWin.setIgnoreMouseEvents(!v, { forward: true });
  });
  ipcMain.on('bowl:drag-start', () => {
    if (!bowlWin || bowlWin.isDestroyed()) return;
    const c = screen.getCursorScreenPoint(), b = bowlWin.getBounds();
    bowlDrag.active = true;
    bowlDrag.offset = { x: c.x - b.x, y: c.y - b.y };
    clearInterval(bowlDrag.timer);
    bowlDrag.timer = setInterval(() => { // 렌더러 좌표 대신 OS 커서를 따라감 (캐릭터 드래그와 같은 이유)
      const p = screen.getCursorScreenPoint(), { width, height } = bowlSize();
      bowlWin.setBounds({ x: p.x - bowlDrag.offset.x, y: p.y - bowlDrag.offset.y, width, height });
    }, 16);
  });
  ipcMain.on('bowl:drag-end', () => {
    clearInterval(bowlDrag.timer);
    bowlDrag.active = false;
    if (!bowlWin || bowlWin.isDestroyed()) return;
    const b = bowlWin.getBounds();
    settings.bowl.x = b.x; settings.bowl.y = b.y;
    saveSettings();
    if (behavior.mission === 'eating') cancelEat(); // 먹는 중에 그릇을 치우면 그만 먹음
  });
  ipcMain.on('bowl:dblclick', () => { log('bowl: dblclick (level', settings.bowl.level + ')'); bowlAction(); });
  ipcMain.on('bowl:menu', () => {
    if (bowlWin && !bowlWin.isDestroyed()) buildBowlMenu().popup({ window: bowlWin });
  });

  // 남은 시간 문구가 바뀌어 글자 폭이 달라지면 창 크기·위치만 다시 맞춤 (숨김 타이머는 그대로)
  ipcMain.on('bubble:resize', (_e, { width, height }) => {
    if (!bubble.visible) return;
    bubble.width = Math.ceil(width);
    bubble.height = Math.ceil(height);
    positionBubble();
  });

  ipcMain.on('pet:anim-end', (_e, state) => {
    if ((state === 'click' || state === 'dblclick') && behavior.state === state) {
      setState('idle');
      scheduleNextMove();
    }
  });

  // 렌더러가 한 프레임 그릴 때마다 호출됨 (이동·드래그 계산 시점)
  ipcMain.on('pet:frame', () => {
    behavior.lastFrameAt = Date.now();
    tick();
  });

  // 투명 영역 클릭 통과: 렌더러가 커서 아래 픽셀이 불투명한지 판정해서 알려줌.
  // forward: true 이면 클릭은 통과시키면서 마우스 이동 이벤트는 계속 받음
  ipcMain.on('pet:set-interactive', (_e, interactive) => {
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  // 드래그 시작: 이후 프레임마다 tick()에서 커서를 따라감
  ipcMain.on('pet:drag-start', () => {
    if (!win || win.isDestroyed()) return;
    syncPositionFromWindow();
    const c = screen.getCursorScreenPoint();
    cancelEat();
    behavior.dragging = true;
    behavior.dragOffset = { x: c.x - behavior.x, y: c.y - behavior.y };
    setState('drag');
  });

  ipcMain.on('pet:drag-end', () => {
    if (!behavior.dragging) return;
    behavior.dragging = false;
    setState('idle');
    scheduleNextMove();
    // 고정 모니터 설정 중에 다른 모니터로 끌어다 놓으면, 놓은 모니터로 설정을 바꿈
    const dropped = screen.getDisplayMatching(win.getBounds());
    if (settings.display && dropped.id !== activeDisplay().id) setDisplaySetting(dropped);
    else ensureOnDisplay(activeDisplay()); // 화면 가장자리 밖으로 걸친 경우 안으로
    savePosition();
  });

  ipcMain.on('pet:menu', () => {
    if (win && !win.isDestroyed()) buildMenu().popup({ window: win });
  });

  // 렌더러가 대표 이미지 첫 프레임으로 만든 트레이 아이콘 (16px, 32px). 원본이 GIF·WebP여도 쓸 수 있게
  ipcMain.on('pet:tray-icon', (_e, { x1, x2 }) => {
    if (!tray) return;
    const icon = nativeImage.createEmpty();
    icon.addRepresentation({ scaleFactor: 1, dataURL: x1 });
    icon.addRepresentation({ scaleFactor: 2, dataURL: x2 });
    tray.setImage(icon);
  });

  registerSettingsIpc();
}

// ---------- 창 ----------
function createWindow() {
  const { x, y } = loadPosition();
  win = new BrowserWindow({
    width: pet.size,
    height: pet.size,
    x, y,
    transparent: true,     // 배경 투명
    frame: false,          // 테두리·제목 표시줄 없음
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,     // 작업표시줄에 안 보이게
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 포커스가 없어도 프레임 신호가 느려지지 않게
    },
  });
  // 'screen-saver' 레벨이어야 다른 항상 위 창(작업표시줄 등)보다도 위에 뜸
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'index.html'));
  win.setIgnoreMouseEvents(true, { forward: true }); // 시작은 클릭 통과. 커서가 이미지 위에 오면 렌더러가 해제
  syncPositionFromWindow();

  // Alt+F4 등으로 창을 닫으면 앱 전체를 종료 (창만 닫히고 프로세스가 남는 것 방지)
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitApp();
  });

  // 이동이 멈추고 1초 뒤 위치 저장
  let saveTimer = null;
  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 1000);
  });
}

function applyVisibility() {
  if (!win || win.isDestroyed()) return;
  const shouldShow = !visibility.userHidden && !visibility.autoHidden;
  if (shouldShow && !win.isVisible()) {
    win.showInactive(); // 다른 창의 포커스를 뺏지 않고 표시
    syncPositionFromWindow();
    behavior.lastTick = Date.now();
  } else if (!shouldShow && win.isVisible()) {
    hideBubble();
    cancelEat();
    win.hide();
  }
  applyBowlVisibility();
  updateTrayMenu();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    visibility.userHidden = true;
  } else {
    visibility.userHidden = false;
    if (visibility.autoHidden) { // 전체 화면 중이라도 사용자가 원하면 보여줌
      visibility.autoHidden = false;
      visibility.autoHideSuppressed = true;
    }
  }
  applyVisibility();
}

// ---------- 전체 화면 앱 감지 ----------
function checkFullscreen() {
  if (!fullscreenDisplayId || !win || win.isDestroyed()) return;
  const fsId = settings.hideOnFullscreen ? fullscreenDisplayId() : null;
  const active = activeDisplay();
  const covered = fsId !== null && fsId === active.id; // 캐릭터가 있는 모니터만 확인
  if (fsId !== null && !covered && fsId !== checkFullscreen.lastOther) log(`fullscreen on other display ${fsId} (pet on ${active.id})`);
  checkFullscreen.lastOther = covered ? null : fsId;
  if (!covered) visibility.autoHideSuppressed = false;
  const autoHidden = covered && !visibility.autoHideSuppressed;
  if (autoHidden !== visibility.autoHidden) {
    log(autoHidden ? 'fullscreen app detected -> hide' : 'fullscreen app gone -> show');
    visibility.autoHidden = autoHidden;
    applyVisibility();
  }
}

// ---------- 단축키 ----------
let registeredShortcut = null;

// 새 단축키 등록. 다른 프로그램이 쓰고 있어 실패하면 원래 단축키로 되돌리고 false
function setShortcut(acc) {
  if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
  let ok = false;
  try { ok = globalShortcut.register(acc, toggleWindow); } catch (e) { log('invalid shortcut:', acc, e.message); }
  if (ok) {
    registeredShortcut = acc;
    return true;
  }
  log(`shortcut register failed: ${acc}`);
  if (registeredShortcut && registeredShortcut !== acc) globalShortcut.register(registeredShortcut, toggleWindow);
  return false;
}

// ---------- 설정 변경 (설정 화면, 메뉴 공용) ----------
// 바꾼 즉시 적용하고 저장. 실패하면 { ok: false, error } (설정 화면이 메시지로 보여줌)
function applySetting(key, value) {
  switch (key) {
    case 'pet': {
      const target = availablePets().find((p) => p.id === value && !p.missing);
      if (!target) return { ok: false, error: '캐릭터 폴더를 찾을 수 없습니다.' };
      const prev = settings.pet;
      settings.pet = value;
      try { reloadPet(); } catch (e) { settings.pet = prev; return { ok: false, error: e.message }; }
      break;
    }
    case 'size':
    case 'speed':
    case 'sleepAfterSec':
      settings[key] = value === null ? null : Number(value);
      applyPetValues();
      break;
    case 'shortcut':
      if (!setShortcut(value)) return { ok: false, error: `${shortcutLabel(value)}는 다른 프로그램이 쓰고 있거나 쓸 수 없는 조합입니다.` };
      settings.shortcut = value;
      break;
    case 'display': {
      if (value === null) { setDisplaySetting(null); break; }
      const d = screen.getAllDisplays().find((x) => x.id === value);
      if (!d) return { ok: false, error: '모니터를 찾을 수 없습니다.' };
      setDisplaySetting(d);
      break;
    }
    case 'countdown': {
      const next = { ...settings.countdown, ...value };
      const error = validateCountdown(next);
      if (error) return { ok: false, error };
      settings.countdown = next;
      break;
    }
    case 'bowlShow':
      settings.bowl.show = !!value;
      if (!value) cancelEat();
      applyBowlVisibility();
      break;
    case 'boilStatic':
      settings.boilStatic = !!value;
      reloadPet(); // 렌더러가 이미지를 다시 디코딩하며 적용
      break;
    case 'hideOnFullscreen':
      settings.hideOnFullscreen = !!value;
      checkFullscreen();
      break;
    case 'autoStart':
      if (!app.isPackaged) return { ok: false, error: '빌드한 exe에서만 설정할 수 있습니다.' };
      app.setLoginItemSettings({ openAtLogin: !!value });
      log('auto start:', !!value);
      break;
    default:
      return { ok: false, error: `알 수 없는 설정: ${key}` };
  }
  saveSettings();
  updateTrayMenu();
  notifySettingsChanged();
  return { ok: true };
}

// ---------- 설정 화면 ----------
function settingsState() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const fixed = settings.display ? resolveDisplay(settings.display, displays) : null;
  return {
    version: app.getVersion(),
    pets: availablePets().map((p) => ({
      id: p.id, name: p.name, builtin: p.builtin, removable: p.removable, missing: !!p.missing, empty: !!p.empty, dir: p.dir,
      preview: p.missing ? null : previewOf(p.dir),
    })),
    petId: pet.id,
    base: pet.base,                                       // pet.json 값 (기본값으로 되돌릴 때 표시)
    values: { size: pet.size, speed: pet.speed, sleepAfterSec: pet.sleepAfterSec },
    overrides: { size: settings.size, speed: settings.speed, sleepAfterSec: settings.sleepAfterSec },
    displays: displays.map((d, i) => ({ id: d.id, label: displayMenuLabel(d, i, primaryId) })),
    displayId: fixed ? fixed.id : null,
    displayMissing: settings.display && !fixed ? (settings.display.label || '설정한 모니터') : null,
    shortcut: settings.shortcut,
    shortcutLabel: shortcutLabel(settings.shortcut),
    hideOnFullscreen: settings.hideOnFullscreen,
    boilStatic: settings.boilStatic,
    countdown: settings.countdown,
    bowlShow: settings.bowl.show,
    fullscreenAvailable: !!fullscreenDisplayId,
    autoStart: { available: app.isPackaged, enabled: app.isPackaged && app.getLoginItemSettings().openAtLogin },
  };
}

function notifySettingsChanged() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:changed', settingsState());
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 500,
    height: 660,
    minWidth: 420,
    minHeight: 400,
    title: 'Desktop Pet 설정',
    icon: nativeImage.createFromPath(TRAY_ICON),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.removeMenu();
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
    resyncMouseWindows();
    if (registeredShortcut === null && settings.shortcut) setShortcut(settings.shortcut); // 단축키 입력 중에 닫은 경우
  });
}

function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => settingsState());
  ipcMain.handle('settings:set', (_e, key, value) => applySetting(key, value));

  // 단축키를 입력받는 동안에는 기존 단축키를 잠시 해제 (등록된 조합은 설정 창에 키 입력이 오지 않음)
  ipcMain.handle('settings:pause-shortcut', () => {
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  });
  ipcMain.handle('settings:resume-shortcut', () => {
    if (!registeredShortcut) setShortcut(settings.shortcut);
  });

  ipcMain.handle('settings:add-folder', async () => {
    const r = await dialog.showOpenDialog(settingsWin, {
      title: '캐릭터 폴더 선택 (idle 이미지가 있는 폴더)',
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: true, canceled: true };
    const dir = r.filePaths[0];
    if (!hasIdle(dir)) return { ok: false, error: '이 폴더에는 idle 이미지(idle.png, idle.gif 등)가 없습니다.' };
    const existing = availablePets().find((p) => path.resolve(p.dir).toLowerCase() === path.resolve(dir).toLowerCase());
    if (!existing) settings.petFolders.push(dir);
    return applySetting('pet', existing ? existing.id : `folder:${dir}`);
  });

  // 새 캐릭터 폴더: %APPDATA%\desktop-pet\pets\새 캐릭터 (N) 을 만들고 탐색기로 열어 줌.
  // 목록에 바로 추가되며, idle 이미지를 넣기 전까지는 "이미지를 넣어 주세요"로 표시되고 선택할 수 없음
  ipcMain.handle('settings:create-pet-folder', () => {
    const root = path.join(app.getPath('userData'), 'pets');
    let name = '새 캐릭터';
    for (let n = 2; fs.existsSync(path.join(root, name)); n++) name = `새 캐릭터 ${n}`;
    const dir = path.join(root, name);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify({ name, size: 128, speed: 80, facing: 'right', sleepAfterSec: 600 }, null, 2) + '\n');
    } catch (e) {
      return { ok: false, error: `폴더를 만들지 못했습니다: ${e.message}` };
    }
    log('pet folder created:', dir);
    settings.petFolders.push(dir);
    saveSettings();
    shell.openPath(dir);
    updateTrayMenu();
    notifySettingsChanged();
    return { ok: true, dir };
  });

  ipcMain.handle('settings:remove-folder', (_e, id) => {
    const target = availablePets().find((p) => p.id === id && p.removable);
    if (!target) return { ok: false, error: '목록에서 제거할 수 없는 캐릭터입니다.' };
    settings.petFolders = settings.petFolders.filter((d) => `folder:${d}` !== id);
    if (settings.pet === id) { settings.pet = null; reloadPet(); }
    saveSettings();
    updateTrayMenu();
    notifySettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:reload-pet', () => {
    try { reloadPet(); } catch (e) { return { ok: false, error: e.message }; }
    notifySettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:open-folder', (_e, which) => {
    const dir = which === 'userData' ? app.getPath('userData') : pet.dir;
    // 내장 캐릭터는 app.asar 안에 있어 탐색기로 열 수 없음
    if (dir.includes('app.asar')) return { ok: false, error: '기본 제공 캐릭터는 폴더를 열 수 없습니다.' };
    shell.openPath(dir);
    return { ok: true };
  });
}

// ---------- 메뉴 (트레이 우클릭, 이미지 우클릭 공용) ----------
function buildDisplayMenu() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const fixed = settings.display ? resolveDisplay(settings.display, displays) : null;
  const items = [
    { label: '자동 (지금 있는 모니터)', type: 'radio', checked: !settings.display, click: () => setDisplaySetting(null) },
    { type: 'separator' },
    ...displays.map((d, i) => ({
      label: displayMenuLabel(d, i, primaryId),
      type: 'radio',
      checked: !!fixed && fixed.id === d.id,
      click: () => setDisplaySetting(d),
    })),
  ];
  // 설정한 모니터가 빠져 있으면, 설정은 유지된 채 주 모니터에 표시 중임을 보여줌
  if (settings.display && !fixed) {
    items.push({ type: 'separator' }, {
      label: `${settings.display.label || '설정한 모니터'} (연결 안 됨 - 주 모니터에 표시 중)`,
      type: 'radio', checked: true, enabled: false,
    });
  }
  return items;
}

function buildPetMenu() {
  return availablePets().filter((p) => !p.missing).map((p) => ({
    label: p.builtin ? p.name : `${p.name} (폴더)`,
    type: 'radio',
    checked: pet && pet.id === p.id,
    click: () => applySetting('pet', p.id),
  }));
}

// 캐릭터 우클릭·트레이·밥그릇 우클릭이 같이 쓰는 메뉴 항목
function menuItems() {
  const visible = win && !win.isDestroyed() && win.isVisible();
  const label = shortcutLabel(registeredShortcut || settings.shortcut);
  return [
    { label: visible ? `숨기기 (${label})` : `보이기 (${label})`, click: toggleWindow },
    { label: '캐릭터', submenu: buildPetMenu() },
    { label: '표시할 모니터', submenu: buildDisplayMenu() },
    {
      label: '전체 화면 앱 실행 중에는 숨기기',
      type: 'checkbox',
      checked: settings.hideOnFullscreen,
      enabled: !!fullscreenDisplayId,
      click: (item) => applySetting('hideOnFullscreen', item.checked),
    },
    app.isPackaged
      ? { label: 'Windows 시작 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (item) => applySetting('autoStart', item.checked) }
      : { label: 'Windows 시작 시 자동 실행 (빌드한 exe에서만)', enabled: false },
    { label: '밥그릇 보이기', type: 'checkbox', checked: settings.bowl.show, click: (item) => applySetting('bowlShow', item.checked) },
    { type: 'separator' },
    { label: '설정…', click: openSettings },
    { label: '종료', click: quitApp },
  ];
}

function buildMenu() {
  return Menu.buildFromTemplate(menuItems());
}

// 밥그릇 우클릭: 그릇에서 할 일을 맨 위에 두고 나머지는 캐릭터 메뉴와 같음 (캐릭터는 돌아다녀서 우클릭하기 어려울 때)
function buildBowlMenu() {
  const empty = settings.bowl.level === 0;
  return Menu.buildFromTemplate([
    { label: empty ? '밥그릇 채우기' : '밥 먹으러 오게 하기', enabled: empty || !behavior.mission, click: bowlAction },
    { type: 'separator' },
    ...menuItems(),
  ]);
}

function updateTrayMenu() {
  if (tray) tray.setContextMenu(buildMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(`Desktop Pet - ${pet.name}`);
  tray.on('click', toggleWindow);
  tray.on('double-click', openSettings);
  updateTrayMenu();
}

// ---------- 종료 ----------
function quitApp() {
  if (quitting) return;
  quitting = true;
  log('quit requested');
  savePosition();
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy();
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.destroy();
  if (bowlWin && !bowlWin.isDestroyed()) bowlWin.destroy();
  if (win && !win.isDestroyed()) win.destroy();
  app.quit();
  // app.quit()으로 프로세스가 끝나지 않는 경우를 대비해 강제 종료
  setTimeout(() => { log('force exit'); app.exit(0); }, 1500).unref();
}

// ---------- 앱 수명 주기 ----------
if (!app.requestSingleInstanceLock()) {
  // 이미 실행 중인 프로세스가 있으면 그쪽에 알리고(second-instance) 이 프로세스는 종료
  log('another instance is running -> exit');
  app.quit();
} else {
  // 이미 실행 중일 때 exe를 다시 실행하면, 숨겨진 창을 다시 보여줌
  app.on('second-instance', () => {
    log('second-instance -> show window');
    if (win && !win.isDestroyed() && !win.isVisible()) toggleWindow();
  });

  app.whenReady().then(() => {
    log('start', `v${app.getVersion()}`);
    loadSettings();
    try {
      pet = loadCurrentPet();
    } catch (e) {
      log('pet load failed:', e.message);
      app.exit(1);
      return;
    }
    registerIpc();
    createWindow();
    createBubbleWindow();
    createBowlWindow();
    createTray();
    screen.on('display-added', () => onDisplaysChanged('added'));
    screen.on('display-removed', () => onDisplaysChanged('removed'));
    screen.on('display-metrics-changed', (_e, _d, changed) => onDisplaysChanged(`metrics:${changed.join(',')}`));
    scheduleNextMove();
    setInterval(() => {
      if (Date.now() - behavior.lastFrameAt > FRAME_TIMEOUT_MS) tick();
    }, FALLBACK_TICK_MS);
    setInterval(checkAlerts, ALERT_CHECK_MS);
    fullscreenDisplayId = createFullscreenDetector(log);
    if (fullscreenDisplayId) setInterval(checkFullscreen, FULLSCREEN_CHECK_MS);
    if (!setShortcut(settings.shortcut) && settings.shortcut !== DEFAULT_SHORTCUT) setShortcut(DEFAULT_SHORTCUT);
    updateTrayMenu();
  });

  app.on('will-quit', () => { globalShortcut.unregisterAll(); log('will-quit'); });
  // 리스너를 등록해 두면 창이 모두 닫혀도 앱이 자동 종료되지 않음 (트레이로 계속 실행)
  app.on('window-all-closed', () => {});
}
