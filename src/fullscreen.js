// Windows에서 전체 화면 앱(게임, 영상 플레이어, 브라우저 F11 등)이 맨 앞에 있는지 확인한다.
// Electron에는 이 기능이 없어서 user32.dll 함수를 koffi(FFI 라이브러리)로 직접 호출한다.
const { screen } = require('electron');
const { matchesDisplay } = require('./displays');

// 바탕화면·작업표시줄은 모니터 크기와 같지만 전체 화면 앱이 아님
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

// 반환값: () => 전체 화면 앱이 덮고 있는 모니터의 id (없으면 null).
// Windows가 아니거나 koffi를 불러오지 못하면 null을 반환해 기능을 끔
function createFullscreenDetector(log) {
  if (process.platform !== 'win32') return null;
  let api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    api = {
      GetForegroundWindow: user32.func('void *GetForegroundWindow()'),
      GetWindowRect: user32.func('int GetWindowRect(void *hWnd, _Out_ RECT *rect)'),
      IsWindowVisible: user32.func('int IsWindowVisible(void *hWnd)'),
      GetClassNameW: user32.func('int GetClassNameW(void *hWnd, void *buf, int maxCount)'),
    };
    // 진단용: Windows가 판단한 "방해 금지" 상태 (2=전체 화면 앱, 3=D3D 전체 화면, 4=프레젠테이션)
    const shell32 = koffi.load('shell32.dll');
    api.SHQueryUserNotificationState = shell32.func('long SHQueryUserNotificationState(_Out_ int *state)');
    api.address = koffi.address;
  } catch (e) {
    log('fullscreen detector unavailable:', e.message);
    return null;
  }

  log('fullscreen detector ready');
  const classBuf = Buffer.alloc(512);
  let lastDiag = '';

  // 맨 앞 창이 바뀌거나 판정 결과가 바뀔 때만 판정 근거를 로그에 남김 (창이 움직일 때마다 남기지 않음)
  function diag(info) {
    const key = JSON.stringify([info.hwnd, info.cls, info.isFullscreen]);
    if (key === lastDiag) return;
    lastDiag = key;
    const st = [0];
    try { api.SHQueryUserNotificationState(st); } catch (_) { st[0] = -1; }
    log('fullscreen diag:', JSON.stringify(info), `quns=${st[0]}`);
  }

  return function fullscreenDisplayId() {
    try {
      const hwnd = api.GetForegroundWindow();
      if (!hwnd) { diag({ hwnd: null }); return null; }
      const info = { hwnd: String(api.address(hwnd)) };
      info.visible = api.IsWindowVisible(hwnd);
      const len = api.GetClassNameW(hwnd, classBuf, 256);
      info.cls = classBuf.toString('utf16le', 0, len * 2);
      const r = {};
      info.rectOk = api.GetWindowRect(hwnd, r);
      info.raw = r;
      info.visible = !!info.visible; info.rectOk = !!info.rectOk;
      // 최대화 여부(IsZoomed)는 보지 않음: Chrome은 최대화한 채로 전체 화면에 들어가면 계속 최대화로 표시됨
      if (!info.visible || SHELL_CLASSES.has(info.cls) || !info.rectOk) { info.isFullscreen = false; diag(info); return null; }
      // GetWindowRect는 실제 픽셀 좌표 → Electron 좌표(DIP)로 변환해 모니터와 비교
      const rect = screen.screenToDipRect(null, { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
      const display = screen.getDisplayMatching(rect);
      info.dip = rect;
      info.display = { id: display.id, label: display.label, bounds: display.bounds };
      info.isFullscreen = matchesDisplay(rect, display.bounds);
      diag(info);
      return info.isFullscreen ? display.id : null;
    } catch (e) {
      log('fullscreen check failed:', e.message);
      return null;
    }
  };
}

module.exports = { createFullscreenDetector };
