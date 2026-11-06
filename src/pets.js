// 캐릭터 폴더 찾기·불러오기. Electron에 의존하지 않아 node로 테스트할 수 있음.
const fs = require('fs');
const path = require('path');

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
const BASE_DEFAULTS = { size: 128, speed: 80, sleepAfterSec: 600 };

// 상태 하나에 이미지를 여러 개 둘 수 있음: click.gif, click_2.gif, click_jump.webp ...
// "상태이름.확장자" 또는 "상태이름_아무거나.확장자". 그 상태가 될 때마다 하나를 무작위로 고름
function findStateFiles(dir, name) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return []; }
  const pattern = new RegExp(`^${name}(_[^.]+)?(${Object.keys(IMAGE_TYPES).map((e) => '\\' + e).join('|')})$`, 'i');
  return entries
    .filter((f) => pattern.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) // click_2 < click_10
    .map((f) => path.join(dir, f));
}

const hasIdle = (dir) => !!dir && findStateFiles(dir, 'idle').length > 0;

function readPetConfig(dir, log = () => {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'pet.json'), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') log(`pet.json 읽기 실패(${dir}), 기본값 사용:`, e.message);
    return {};
  }
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// 고를 수 있는 캐릭터 목록
//   내장: builtinRoot 아래 폴더들 (default가 맨 앞)
//   사용자: userPetDir(%APPDATA%\desktop-pet\pet), 설정에서 추가한 폴더들
// 추가한 폴더가 지워졌거나 idle 이미지가 없으면 missing=true 로 표시 (선택 불가, 목록에서 제거만 가능).
// 폴더는 있는데 idle 이미지가 아직 없으면 empty=true (새 캐릭터 폴더를 막 만든 상태)
function listPets({ builtinRoot, userPetDir, extraDirs = [], log }) {
  const pets = [];
  let builtins = [];
  try { builtins = fs.readdirSync(builtinRoot); } catch (_) { /* 없음 */ }
  // 기본 제공 캐릭터 순서: 곰, 고양이, 강아지, 토끼, 오목눈이 (그 밖의 폴더는 이름순으로 뒤에)
  const ORDER = ['default', 'cat', 'dog', 'rabbit', 'quokka', 'bird'];
  const rank = (n) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length);
  builtins.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const name of builtins) {
    const dir = path.join(builtinRoot, name);
    if (!hasIdle(dir)) continue;
    pets.push({ id: `builtin:${name}`, dir, name: readPetConfig(dir, log).name || name, builtin: true, removable: false });
  }
  if (hasIdle(userPetDir)) {
    pets.push({ id: `folder:${userPetDir}`, dir: userPetDir, name: readPetConfig(userPetDir, log).name || '내 캐릭터', builtin: false, removable: false });
  }
  for (const dir of extraDirs) {
    if (pets.some((p) => samePath(p.dir, dir))) continue;
    const ok = hasIdle(dir);
    pets.push({
      id: `folder:${dir}`, dir, builtin: false, removable: true, missing: !ok, empty: !ok && fs.existsSync(dir),
      name: (ok && readPetConfig(dir, log).name) || path.basename(dir),
    });
  }
  return pets;
}

// 설정값(캐릭터 id)으로 고를 캐릭터. 설정이 없으면 사용자 폴더 → 기본 곰 순서
function choosePet(pets, petId) {
  const usable = pets.filter((p) => !p.missing);
  return (petId && usable.find((p) => p.id === petId))
    || usable.find((p) => !p.builtin && !p.removable) // %APPDATA%\desktop-pet\pet (예전 방식 호환)
    || usable.find((p) => p.id === 'builtin:default')
    || usable[0]
    || null;
}

// 크기·속도·잠드는 시간: 설정에서 직접 정한 값(null이 아니면) > pet.json > 기본값
function effectiveValues(base, overrides = {}) {
  const pick = (k) => (overrides[k] ?? base[k]);
  return { size: pick('size'), speed: pick('speed'), sleepAfterSec: pick('sleepAfterSec') };
}

function loadPetFromDir(dir, { id = `folder:${dir}`, log = () => {} } = {}) {
  const conf = readPetConfig(dir, log);
  const states = {};
  for (const [name, def] of Object.entries(STATE_DEFAULTS)) {
    const files = findStateFiles(dir, name);
    if (files.length === 0) continue; // 없는 상태는 렌더러에서 idle 이미지로 대체
    states[name] = {
      ...def,
      ...((conf.states && conf.states[name]) || {}),
      variants: files.map((file) => ({
        file: path.basename(file),
        mime: IMAGE_TYPES[path.extname(file).toLowerCase()],
        data: fs.readFileSync(file),
      })),
    };
  }
  if (!states.idle) throw new Error(`idle 이미지가 없음: ${dir}`);
  const num = (v, min) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : undefined);
  return {
    id,
    dir,
    name: conf.name || path.basename(dir),
    facing: conf.facing === 'left' ? 'left' : 'right', // 원본 이미지가 바라보는 방향
    // pet.json 값. 0은 "안 움직임"/"안 잠"이므로 || 대신 ?? 로 기본값 적용
    base: {
      size: num(conf.size, 16) ?? BASE_DEFAULTS.size,
      speed: num(conf.speed, 0) ?? BASE_DEFAULTS.speed,
      sleepAfterSec: num(conf.sleepAfterSec, 0) ?? BASE_DEFAULTS.sleepAfterSec,
    },
    states,
  };
}

// 미리보기용: 대표(idle) 이미지 첫 파일
function previewOf(dir) {
  const file = findStateFiles(dir, 'idle')[0];
  if (!file) return null;
  return { mime: IMAGE_TYPES[path.extname(file).toLowerCase()], data: fs.readFileSync(file) };
}

module.exports = {
  STATE_DEFAULTS, IMAGE_TYPES, BASE_DEFAULTS,
  findStateFiles, hasIdle, listPets, choosePet, effectiveValues, loadPetFromDir, previewOf,
};
