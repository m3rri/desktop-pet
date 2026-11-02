const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const ASSETS = path.join(__dirname, '..', 'assets');
const TRAY_ICON = path.join(ASSETS, 'tray.png');
const DEFAULT_PET_DIR = path.join(ASSETS, 'pets', 'default');
const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+P';
const TICK_MS = 33;      // 이동 계산 주기 (~30fps)
const DRAG_TICK_MS = 16; // 드래그 중 커서 추적 주기 (~60fps)

// 상태 이름 = 이미지 파일 이름. loop=false 인 상태는 1회 재생 후 idle로 돌아감
const STATE_DEFAULTS = {
  idle: { loop: true },
  walk: { loop: true },
  click: { loop: false },
  sleep: { loop: true },
  drag: { loop: true },
};
// .apng 도 내부적으로는 PNG 이므로 image/png 로 디코딩
const IMAGE_TYPES = { '.png': 'image/png', '.apng': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

let win = null;
let tray = null;
let pet = null;
let quitting = false;

// ---------- 로그 (%APPDATA%\desktop-pet\main.log) ----------
function log(...args) {
  const line = `[${new Date().toISOString()}] pid=${process.pid} ${args.join(' ')}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), line); } catch (_) { /* 무시 */ }
}

// ---------- 캐릭터 불러오기 ----------
// 사용자 폴더(%APPDATA%\desktop-pet\pet)에 idle 이미지가 있으면 그것을, 없으면 기본 캐릭터를 사용
function petDirCandidates() {
  return [path.join(app.getPath('userData'), 'pet'), DEFAULT_PET_DIR];
}

function findStateFile(dir, name) {
  for (const ext of Object.keys(IMAGE_TYPES)) {
    const file = path.join(dir, name + ext);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function loadPet() {
  for (const dir of petDirCandidates()) {
    if (!findStateFile(dir, 'idle')) continue;

    let conf = {};
    try {
      conf = JSON.parse(fs.readFileSync(path.join(dir, 'pet.json'), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') log('pet.json 읽기 실패, 기본값 사용:', e.message);
    }

    const states = {};
    for (const [name, def] of Object.entries(STATE_DEFAULTS)) {
      const file = findStateFile(dir, name);
      if (!file) continue; // 없는 상태는 렌더러에서 idle 이미지로 대체
      states[name] = {
        ...def,
        ...((conf.states && conf.states[name]) || {}),
        mime: IMAGE_TYPES[path.extname(file).toLowerCase()],
        data: fs.readFileSync(file),
      };
    }
    log('pet loaded:', dir, `[${Object.keys(states).join(', ')}]`);
    return {
      dir,
      name: conf.name || path.basename(dir),
      size: conf.size || 128,
      speed: conf.speed || 80,                  // px/초
      facing: conf.facing === 'left' ? 'left' : 'right', // 원본 이미지가 바라보는 방향
      sleepAfterSec: conf.sleepAfterSec ?? 600, // 입력이 없으면 잠드는 시간
      states,
    };
  }
  throw new Error('idle 이미지가 있는 캐릭터 폴더를 찾을 수 없음');
}

// ---------- 위치 저장/복원 ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadPosition() {
  const s = pet.size;
  try {
    const { x, y } = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // 저장된 위치가 현재 연결된 모니터 안에 있을 때만 사용 (모니터를 뺀 경우 대비)
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      x >= a.x && y >= a.y && x + s <= a.x + a.width && y + s <= a.y + a.height);
    if (visible) return { x, y };
  } catch (_) { /* 첫 실행이거나 파일이 깨진 경우 */ }

  const a = screen.getPrimaryDisplay().workArea; // 기본값: 주 모니터 오른쪽 아래
  return { x: a.x + a.width - s - 40, y: a.y + a.height - s - 40 };
}

function savePosition() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ x, y })); } catch (e) { log('save position failed:', e.message); }
}

// ---------- 행동 (상태 전환 + 이동) ----------
const behavior = {
  state: 'idle',
  facing: 'right',
  x: 0, y: 0,          // 창 위치 (소수점까지 유지해야 느린 속도에서도 부드럽게 움직임)
  target: null,
  nextMoveAt: 0,
  lastTick: Date.now(),
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  dragTimer: null,
};

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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
}

// 현재 모니터 작업 영역 안에서, 지금 위치 근처의 임의 지점
function pickTarget() {
  const a = screen.getDisplayMatching(win.getBounds()).workArea;
  const s = pet.size;
  return {
    x: clamp(behavior.x + rand(-400, 400), a.x, a.x + a.width - s),
    y: clamp(behavior.y + rand(-250, 250), a.y, a.y + a.height - s),
  };
}

function tick() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - behavior.lastTick) / 1000);
  behavior.lastTick = now;
  if (!win || win.isDestroyed() || !win.isVisible() || behavior.dragging) return;

  // 잠자기: OS 기준으로 키보드·마우스 입력이 없던 시간
  const idleSec = powerMonitor.getSystemIdleTime();
  if (behavior.state === 'sleep') {
    if (idleSec < 1) { setState('idle'); scheduleNextMove(); }
    return;
  }
  if (idleSec >= pet.sleepAfterSec && behavior.state !== 'click') {
    setState('sleep');
    return;
  }

  if (behavior.state === 'click') return; // 렌더러가 재생 종료를 알려줄 때까지 대기

  if (behavior.state === 'idle' && now >= behavior.nextMoveAt) {
    behavior.target = pickTarget();
    setState('walk');
  }

  if (behavior.state === 'walk') {
    const dx = behavior.target.x - behavior.x;
    const dy = behavior.target.y - behavior.y;
    const dist = Math.hypot(dx, dy);
    const step = pet.speed * dt;
    if (Math.abs(dx) > 1) setFacing(dx < 0 ? 'left' : 'right');
    if (dist <= step) {
      behavior.x = behavior.target.x; behavior.y = behavior.target.y;
      setState('idle');
      scheduleNextMove();
    } else {
      behavior.x += (dx / dist) * step;
      behavior.y += (dy / dist) * step;
    }
    moveWindow(behavior.x, behavior.y);
  }
}

// ---------- 렌더러와 통신 ----------
function registerIpc() {
  // 렌더러가 시작할 때 캐릭터 이미지와 현재 상태를 요청
  ipcMain.handle('pet:load', () => ({
    size: pet.size,
    baseFacing: pet.facing,
    facing: behavior.facing,
    state: behavior.state,
    states: Object.fromEntries(Object.entries(pet.states)
      .map(([name, s]) => [name, { loop: s.loop, mime: s.mime, data: s.data }])),
  }));

  ipcMain.on('pet:click', () => {
    if (behavior.dragging) return;
    setState('click', { force: true }); // 재생 중에 다시 클릭하면 처음부터
  });

  ipcMain.on('pet:anim-end', (_e, state) => {
    if (state === 'click' && behavior.state === 'click') {
      setState('idle');
      scheduleNextMove();
    }
  });

  // 드래그: 렌더러 좌표 대신 OS 커서 위치를 직접 따라감 (창이 움직이는 동안 렌더러 좌표가 흔들리는 문제 방지)
  ipcMain.on('pet:drag-start', () => {
    if (!win || win.isDestroyed()) return;
    syncPositionFromWindow();
    const c = screen.getCursorScreenPoint();
    behavior.dragging = true;
    behavior.dragOffset = { x: c.x - behavior.x, y: c.y - behavior.y };
    setState('drag');
    clearInterval(behavior.dragTimer);
    behavior.dragTimer = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const p = screen.getCursorScreenPoint();
      behavior.x = p.x - behavior.dragOffset.x;
      behavior.y = p.y - behavior.dragOffset.y;
      moveWindow(behavior.x, behavior.y);
    }, DRAG_TICK_MS);
  });

  ipcMain.on('pet:drag-end', () => {
    clearInterval(behavior.dragTimer);
    behavior.dragTimer = null;
    if (!behavior.dragging) return;
    behavior.dragging = false;
    setState('idle');
    scheduleNextMove();
    savePosition();
  });

  ipcMain.on('pet:menu', () => {
    if (win && !win.isDestroyed()) buildMenu().popup({ window: win });
  });
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
    },
  });
  // 'screen-saver' 레벨이어야 다른 항상 위 창(작업표시줄 등)보다도 위에 뜸
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'index.html'));
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

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.showInactive(); // 다른 창의 포커스를 뺏지 않고 표시
    syncPositionFromWindow();
    behavior.lastTick = Date.now();
  }
  updateTrayMenu();
}

// ---------- 메뉴 (트레이 우클릭, 이미지 우클릭 공용) ----------
function buildMenu() {
  const visible = win && !win.isDestroyed() && win.isVisible();
  return Menu.buildFromTemplate([
    { label: visible ? `숨기기 (${TOGGLE_SHORTCUT})` : `보이기 (${TOGGLE_SHORTCUT})`, click: toggleWindow },
    { type: 'separator' },
    { label: '종료', click: quitApp },
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
  updateTrayMenu();
}

// ---------- 종료 ----------
function quitApp() {
  if (quitting) return;
  quitting = true;
  log('quit requested');
  savePosition();
  clearInterval(behavior.dragTimer);
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
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
    try {
      pet = loadPet();
    } catch (e) {
      log('pet load failed:', e.message);
      app.exit(1);
      return;
    }
    registerIpc();
    createWindow();
    createTray();
    scheduleNextMove();
    setInterval(tick, TICK_MS);
    if (!globalShortcut.register(TOGGLE_SHORTCUT, toggleWindow)) {
      log(`shortcut register failed: ${TOGGLE_SHORTCUT}`);
    }
  });

  app.on('will-quit', () => { globalShortcut.unregisterAll(); log('will-quit'); });
  // 리스너를 등록해 두면 창이 모두 닫혀도 앱이 자동 종료되지 않음 (트레이로 계속 실행)
  app.on('window-all-closed', () => {});
}
