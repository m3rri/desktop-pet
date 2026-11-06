const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen, ipcMain, powerMonitor, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { clamp, displayKey, resolveDisplay, fitInto, displayMenuLabel } = require('./displays');
const { createFullscreenDetector } = require('./fullscreen');

// 설정·로그 폴더를 %APPDATA%\desktop-pet 으로 고정.
// 설치판은 productName("Desktop Pet")이 앱 이름이 되어 폴더가 %APPDATA%\Desktop Pet 으로 바뀌므로,
// zip판에서 쓰던 설정을 그대로 이어 쓰도록 이름을 따로 지정. 단일 실행 잠금보다 먼저 해야 함
app.setPath('userData', path.join(app.getPath('appData'), 'desktop-pet'));
const { listPets, choosePet, effectiveValues, loadPetFromDir, previewOf, hasIdle } = require('./pets');

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
};

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
  cursorInside: false,
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

  // 잠자기: OS 기준으로 키보드·마우스 입력이 없던 시간
  const idleSec = powerMonitor.getSystemIdleTime();
  if (behavior.state === 'sleep') {
    if (idleSec < 1) { setState('idle'); scheduleNextMove(); }
    return;
  }
  if (pet.sleepAfterSec > 0 && idleSec >= pet.sleepAfterSec && behavior.state !== 'click') { // 0 = 안 잠
    setState('sleep');
    return;
  }

  if (behavior.state === 'click') return; // 렌더러가 재생 종료를 알려줄 때까지 대기

  if (behavior.state === 'idle' && now >= behavior.nextMoveAt && pet.speed > 0) { // 0 = 안 움직임
    behavior.target = pickTarget();
    setState('walk');
  }

  if (behavior.state === 'walk') {
    const dx = behavior.target.x - behavior.x;
    const dy = behavior.target.y - behavior.y;
    const dist = Math.hypot(dx, dy);
    const step = pet.speed * dt;
    if (Math.abs(dx) > 1) setFacing(dx < 0 ? 'left' : 'right');
    if (dist <= step || step <= 0) {
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
    setState('click', { force: true }); // 재생 중에 다시 클릭하면 처음부터
  });

  ipcMain.on('pet:anim-end', (_e, state) => {
    if (state === 'click' && behavior.state === 'click') {
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
    win.hide();
  }
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

function buildMenu() {
  const visible = win && !win.isDestroyed() && win.isVisible();
  const label = shortcutLabel(registeredShortcut || settings.shortcut);
  return Menu.buildFromTemplate([
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
    { type: 'separator' },
    { label: '설정…', click: openSettings },
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
    createTray();
    screen.on('display-added', () => onDisplaysChanged('added'));
    screen.on('display-removed', () => onDisplaysChanged('removed'));
    screen.on('display-metrics-changed', (_e, _d, changed) => onDisplaysChanged(`metrics:${changed.join(',')}`));
    scheduleNextMove();
    setInterval(() => {
      if (Date.now() - behavior.lastFrameAt > FRAME_TIMEOUT_MS) tick();
    }, FALLBACK_TICK_MS);
    fullscreenDisplayId = createFullscreenDetector(log);
    if (fullscreenDisplayId) setInterval(checkFullscreen, FULLSCREEN_CHECK_MS);
    if (!setShortcut(settings.shortcut) && settings.shortcut !== DEFAULT_SHORTCUT) setShortcut(DEFAULT_SHORTCUT);
    updateTrayMenu();
  });

  app.on('will-quit', () => { globalShortcut.unregisterAll(); log('will-quit'); });
  // 리스너를 등록해 두면 창이 모두 닫혀도 앱이 자동 종료되지 않음 (트레이로 계속 실행)
  app.on('window-all-closed', () => {});
}
