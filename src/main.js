const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const IMAGE_PATH = path.join(__dirname, '..', 'assets', 'pet.png');
const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+P';
const WINDOW_SIZE = { width: 128, height: 128 };

let win = null;
let tray = null;

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

  let saveTimer = null;
  win.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 300);
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.showInactive(); // 다른 창의 포커스를 뺏지 않고 표시
  updateTrayMenu();
}

// ---------- 트레이 ----------
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: win && win.isVisible() ? `숨기기 (${TOGGLE_SHORTCUT})` : `보이기 (${TOGGLE_SHORTCUT})`, click: toggleWindow },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(IMAGE_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Desktop Pet');
  tray.on('click', toggleWindow);
  updateTrayMenu();
}

// ---------- 앱 수명 주기 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // 이미 실행 중이면 두 번째 실행은 바로 종료
} else {
  app.whenReady().then(() => {
    createWindow();
    createTray();
    if (!globalShortcut.register(TOGGLE_SHORTCUT, toggleWindow)) {
      console.warn(`단축키 등록 실패: ${TOGGLE_SHORTCUT} (다른 프로그램이 사용 중일 수 있음)`);
    }
  });

  app.on('before-quit', savePosition);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // 창을 숨겨도 트레이로 계속 실행되도록 기본 종료 동작을 막음
  app.on('window-all-closed', (e) => e.preventDefault());
}
