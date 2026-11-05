// 설정 창. 값을 바꾸면 바로 메인 프로세스에 보내 적용·저장하고, 메인이 보내 주는 상태로 화면을 다시 그림
// (메뉴에서 바꾸거나 곰을 다른 모니터로 끌어 놓는 등 설정 창 밖에서 바뀐 값도 반영됨)
const api = window.settingsApi;
const $ = (id) => document.getElementById(id);
let state = null;

// ---------- 공통 ----------
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

async function set(key, value) {
  const r = await api.set(key, value);
  if (!r.ok) { toast(r.error); render(await api.get()); } // 실패하면 원래 값으로 되돌려 그림
}

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function minutes(sec) {
  if (sec === 0) return '안 잠';
  if (sec < 60) return `${sec}초`;
  return sec % 60 ? `${(sec / 60).toFixed(1)}분` : `${sec / 60}분`;
}

// ---------- 캐릭터 ----------
const thumbCache = new Map(); // 캐릭터 id -> blob URL (다시 그릴 때마다 애니메이션이 처음부터 시작되지 않게)
function thumbUrl(p) {
  if (!p.preview) return null;
  const key = `${p.id}|${p.preview.data.length}`;
  if (!thumbCache.has(key)) thumbCache.set(key, URL.createObjectURL(new Blob([p.preview.data], { type: p.preview.mime })));
  return thumbCache.get(key);
}

function renderPets() {
  const box = $('pets');
  box.replaceChildren();
  for (const p of state.pets) {
    const el = document.createElement('div');
    el.className = 'pet' + (p.id === state.petId ? ' selected' : '') + (p.missing ? ' missing' : '');
    el.title = p.builtin ? p.name : p.dir;
    const url = thumbUrl(p);
    if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; el.append(img); }
    else { const ph = document.createElement('div'); ph.style.height = '76px'; el.append(ph); }
    const name = document.createElement('div'); name.className = 'name'; name.textContent = p.name;
    const tag = document.createElement('div'); tag.className = 'tag';
    tag.textContent = p.missing ? '폴더를 찾을 수 없음' : p.builtin ? '기본 제공' : '내 폴더';
    el.append(name, tag);
    if (!p.missing) el.addEventListener('click', () => { if (p.id !== state.petId) set('pet', p.id); });
    if (p.removable) {
      const rm = document.createElement('button');
      rm.className = 'remove'; rm.textContent = '×'; rm.title = '목록에서 제거 (폴더는 지우지 않음)';
      rm.addEventListener('click', async (e) => {
        e.stopPropagation();
        const r = await api.removeFolder(p.id);
        if (!r.ok) toast(r.error);
      });
      el.append(rm);
    }
    box.append(el);
  }
  const add = document.createElement('div');
  add.className = 'pet add';
  add.innerHTML = '<div class="plus">+</div><div class="name">폴더 추가</div>';
  add.title = 'idle 이미지가 들어 있는 폴더를 고르세요';
  add.addEventListener('click', async () => {
    const r = await api.addFolder();
    if (!r.ok) toast(r.error);
  });
  box.append(add);

  const current = state.pets.find((p) => p.id === state.petId);
  $('open-pet-folder').disabled = !current || current.builtin;
}

$('reload').addEventListener('click', async () => {
  const r = await api.reloadPet();
  if (!r.ok) toast(r.error);
});
$('open-pet-folder').addEventListener('click', async () => {
  const r = await api.openFolder('pet');
  if (!r.ok) toast(r.error);
});

// ---------- 크기·속도·잠들기 ----------
function bindRange(key, format) {
  const input = $(key), out = $(`${key}-out`), reset = $(`${key}-reset`);
  const send = debounce((v) => set(key, v), 120);
  input.addEventListener('input', () => { out.textContent = format(Number(input.value)); send(Number(input.value)); });
  reset.addEventListener('click', () => set(key, null));
  return () => {
    if (document.activeElement !== input) input.value = state.values[key]; // 드래그 중에는 건드리지 않음
    out.textContent = format(Number(input.value));
    reset.hidden = state.overrides[key] === null;
  };
}
const renderSize = bindRange('size', (v) => `${v}px`);
const renderSpeed = bindRange('speed', (v) => (v === 0 ? '제자리' : `${v}px/초`));

const SLEEP_CHOICES = [0, 60, 300, 600, 1800, 3600];
$('sleep').addEventListener('change', (e) => set('sleepAfterSec', e.target.value === 'default' ? null : Number(e.target.value)));
function renderSleep() {
  const sel = $('sleep');
  const choices = [...SLEEP_CHOICES];
  if (state.overrides.sleepAfterSec !== null && !choices.includes(state.overrides.sleepAfterSec)) choices.push(state.overrides.sleepAfterSec);
  sel.replaceChildren(
    new Option(`캐릭터 기본값 (${minutes(state.base.sleepAfterSec)})`, 'default'),
    ...choices.sort((a, b) => a - b).map((s) => new Option(minutes(s), String(s))),
  );
  sel.value = state.overrides.sleepAfterSec === null ? 'default' : String(state.overrides.sleepAfterSec);
}

// ---------- 화면 ----------
$('display').addEventListener('change', (e) => { if (e.target.value !== 'missing') set('display', e.target.value === 'auto' ? null : Number(e.target.value)); });
function renderDisplay() {
  const sel = $('display');
  const opts = [new Option('자동 (지금 있는 모니터)', 'auto'), ...state.displays.map((d) => new Option(d.label, String(d.id)))];
  if (state.displayMissing) { const o = new Option(`${state.displayMissing} (연결 안 됨)`, 'missing'); o.disabled = true; opts.push(o); }
  sel.replaceChildren(...opts);
  sel.value = state.displayMissing ? 'missing' : state.displayId === null ? 'auto' : String(state.displayId);
}

$('fullscreen').addEventListener('change', (e) => set('hideOnFullscreen', e.target.checked));
$('autostart').addEventListener('change', (e) => set('autoStart', e.target.checked));

// ---------- 단축키 입력 ----------
const KEY_NAMES = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};
// KeyboardEvent → Electron 단축키 문자열 (예: "Ctrl+Alt+P"). 아직 조합이 덜 됐으면 null
function toAccelerator(e) {
  let key = null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(e.code))) key = m[1];
  else if ((m = /^Digit(\d)$/.exec(e.code))) key = m[1];
  else if ((m = /^Numpad(\d)$/.exec(e.code))) key = `num${m[1]}`;
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  else if (KEY_NAMES[e.code]) key = KEY_NAMES[e.code];
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const preview = [...mods, key || '…'].join('+');
  if (!key) return { preview, acc: null };
  // 다른 입력을 방해하지 않도록 Ctrl/Alt/Win 중 하나는 있어야 함 (F 키는 단독 허용)
  const ok = /^F\d+$/.test(key) || e.ctrlKey || e.altKey || e.metaKey;
  return { preview, acc: ok ? [...mods, key].join('+') : null };
}

let recording = false;
async function startRecording() {
  recording = true;
  await api.pauseShortcut();
  $('shortcut').classList.add('recording');
  $('shortcut').textContent = '키 조합 입력…';
  $('shortcut-hint').textContent = 'Esc를 누르면 취소합니다';
}
async function stopRecording() {
  if (!recording) return;
  recording = false;
  $('shortcut').classList.remove('recording');
  $('shortcut-hint').textContent = '누른 뒤 원하는 키 조합을 입력하세요';
  await api.resumeShortcut();
  render(await api.get());
}
$('shortcut').addEventListener('click', () => (recording ? stopRecording() : startRecording()));
$('shortcut').addEventListener('blur', () => stopRecording());
window.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.code === 'Escape') { stopRecording(); return; }
  const { preview, acc } = toAccelerator(e);
  $('shortcut').textContent = preview;
  if (!acc) return;
  recording = false; // 결과가 올 때까지 추가 입력 무시
  const r = await api.set('shortcut', acc);
  if (!r.ok) toast(r.error);
  recording = true;
  stopRecording();
}, true);

// ---------- 전체 그리기 ----------
function render(s) {
  state = s;
  renderPets();
  renderSize();
  renderSpeed();
  renderSleep();
  renderDisplay();
  $('fullscreen').checked = state.hideOnFullscreen;
  $('fullscreen').disabled = !state.fullscreenAvailable;
  $('fullscreen-hint').textContent = state.fullscreenAvailable ? '게임, 영상, 브라우저 F11 등' : 'Windows에서만 쓸 수 있습니다';
  $('autostart').checked = state.autoStart.enabled;
  $('autostart').disabled = !state.autoStart.available;
  $('autostart-hint').textContent = state.autoStart.available ? '' : '빌드한 exe에서만 설정할 수 있습니다';
  if (!recording) $('shortcut').textContent = state.shortcutLabel;
  $('version').textContent = `Desktop Pet v${state.version}`;
}

$('open-userdata').addEventListener('click', () => api.openFolder('userData'));
api.onChanged((s) => { if (!recording) render(s); });
api.get().then(render);
