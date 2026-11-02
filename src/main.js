const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const IMAGE_PATH = path.join(__dirname, '..', 'assets', 'pet.png');
const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+P';
const WINDOW_SIZE = { width: 128, height: 128 };

let win = null;
let tray = null;
let quitting = false;

// ---------- 로그 (%APPDATA%\desktop-pet\main.log) ----------
function log(...args) {
  const line = `[${new Date().toISOString()}] pid=${process.pid} ${args.join(' ')}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'), line); } catch (_) { /* 무시 */ }
}

// ---------- 위치 저장/복원 ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadPosition() {
  try {
    const { x, y } = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // 저장된 위치가 현재 연결된 모니터 안에 있을 때만 사용 (모니터를 뺀 경우 대비)
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      x >= a.x && y >= a.y &&
      x + WINDOW_SIZE.width <= a.x + a.width &&
      y + WINDOW_SIZE.height <= a.y + a.height);
    if (visible) return { x, y };
  } catch (_) { /* 첫 실행이거나 파일이 깨진 경우 */ }

  // 기본값: 주 모니터 오른쪽 아래
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - WINDOW_SIZE.width - 40, y: a.y + a.height - WINDOW_SIZE.height - 40 };
}

function savePosition() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ x, y })); } catch (e) { console.error(e); }
}

// ---------- 창 ----------
function createWindow() {
  const { x, y } = loadPosition();
  win = new BrowserWindow({
    ...WINDOW_SIZE,
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

  // 이미지 우클릭: Windows 기본 창 메뉴(이동/닫기 등) 대신 앱 메뉴 표시
  win.on('system-context-menu', (e) => {
    e.preventDefault();
    buildMenu().popup({ window: win });
  });
  // Alt+F4 등으로 창을 닫으면 앱 전체를 종료 (창만 닫히고 프로세스가 남는 것 방지)
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitApp();
  });

  let saveTimer = null;
  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 300);
  });
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else win.showInactive(); // 다른 창의 포커스를 뺏지 않고 표시
  updateTrayMenu();
}

// ---------- 트레이 ----------
// 트레이 우클릭 메뉴와 이미지 우클릭 메뉴에서 같이 사용
function buildMenu() {
  const visible = win && !win.isDestroyed() && win.isVisible();
  return Menu.buildFromTemplate([
    { label: visible ? `숨기기 (${TOGGLE_SHORTCUT})` : `보이기 (${TOGGLE_SHORTCUT})`, click: toggleWindow },
    { type: 'separator' },
    { label: '종료', click: quitApp },
  ]);
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(IMAGE_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Desktop Pet');
  tray.on('click', toggleWindow);
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
    if (win && !win.isDestroyed()) { win.showInactive(); updateTrayMenu(); }
  });

  app.whenReady().then(() => {
    log('start', `v${app.getVersion()}`);
    createWindow();
    createTray();
    if (!globalShortcut.register(TOGGLE_SHORTCUT, toggleWindow)) {
      log(`shortcut register failed: ${TOGGLE_SHORTCUT}`);
    }
  });

  app.on('will-quit', () => { globalShortcut.unregisterAll(); log('will-quit'); });
  // 리스너를 등록해 두면 창이 모두 닫혀도 앱이 자동 종료되지 않음 (트레이로 계속 실행)
  app.on('window-all-closed', () => {});
}
