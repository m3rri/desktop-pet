// node test/pets.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findStateFiles, listPets, choosePet, effectiveValues, loadPetFromDir, loadBowlImages } = require('../src/pets');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pets-test-'));
const mk = (dir, files, conf) => {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  if (conf) fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(conf));
  return dir;
};
const builtinRoot = path.join(tmp, 'builtin');
mk(path.join(builtinRoot, 'default'), ['idle.png', 'click.gif', 'click_2.png'], { name: '곰' });
mk(path.join(builtinRoot, 'cat'), ['idle.png'], { name: '검은 고양이', size: 0, speed: 0, sleepAfterSec: 0 });
mk(path.join(builtinRoot, 'broken'), ['walk.png']); // idle 없음 → 목록에서 제외
const userPetDir = mk(path.join(tmp, 'user', 'pet'), ['idle.webp'], { name: '내 고양이' });
const extra = mk(path.join(tmp, 'extra'), ['idle.gif']);
const gone = path.join(tmp, 'gone');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('파일 이름 규칙', () => {
  const dir = mk(path.join(tmp, 'names'), ['click.gif', 'click_2.png', 'CLICK_10.GIF', 'clicker.png', 'click.jpg', 'click_2.png.bak']);
  assert.deepStrictEqual(findStateFiles(dir, 'click').map((f) => path.basename(f)), ['click_2.png', 'CLICK_10.GIF', 'click.gif']);
});

const pets = listPets({ builtinRoot, userPetDir, extraDirs: [extra, gone, userPetDir] });
t('목록: 내장(default 먼저) → 사용자 폴더 → 추가 폴더, 중복 제거', () => {
  assert.deepStrictEqual(pets.map((p) => p.id), ['builtin:default', 'builtin:cat', `folder:${userPetDir}`, `folder:${extra}`, `folder:${gone}`]);
  assert.deepStrictEqual(pets.map((p) => p.name), ['곰', '검은 고양이', '내 고양이', 'extra', 'gone']);
});
t('목록: 이미지를 아직 안 넣은 폴더는 empty (선택 불가)', () => {
  const emptyDir = path.join(tmp, 'empty-new');
  fs.mkdirSync(emptyDir);
  const list = listPets({ builtinRoot, userPetDir, extraDirs: [emptyDir, gone] });
  const e = list.find((p) => p.dir === emptyDir), g = list.find((p) => p.dir === gone);
  assert.deepStrictEqual([e.missing, e.empty, g.missing, g.empty], [true, true, true, false]);
  assert.notStrictEqual(choosePet(list, `folder:${emptyDir}`).dir, emptyDir);
});
t('목록: 지워진 폴더는 missing, 추가 폴더만 제거 가능', () => {
  assert.strictEqual(pets.find((p) => p.dir === gone).missing, true);
  assert.deepStrictEqual(pets.map((p) => p.removable), [false, false, false, true, true]);
});
t('선택: 설정한 캐릭터', () => assert.strictEqual(choosePet(pets, 'builtin:cat').id, 'builtin:cat'));
t('선택: 설정 없으면 %APPDATA%\\pet 폴더 (예전 방식)', () => assert.strictEqual(choosePet(pets, null).dir, userPetDir));
t('선택: 사용자 폴더도 없으면 곰', () => {
  const only = listPets({ builtinRoot, userPetDir: path.join(tmp, 'none') });
  assert.strictEqual(choosePet(only, null).id, 'builtin:default');
});
t('선택: 설정한 폴더가 지워졌으면 기본 순서로', () => assert.strictEqual(choosePet(pets, `folder:${gone}`).dir, userPetDir));

t('불러오기: 상태별 이미지, 없는 상태는 빠짐', () => {
  const p = loadPetFromDir(path.join(builtinRoot, 'default'), { id: 'builtin:default' });
  assert.deepStrictEqual(Object.keys(p.states), ['idle', 'click']);
  assert.deepStrictEqual(p.states.click.variants.map((v) => v.file), ['click_2.png', 'click.gif']);
  assert.strictEqual(p.states.click.loop, false);
  assert.deepStrictEqual(p.base, { size: 128, speed: 80, sleepAfterSec: 600 });
});
t('불러오기: pet.json의 0은 그대로 (안 움직임/안 잠), 너무 작은 크기는 기본값', () => {
  const p = loadPetFromDir(path.join(builtinRoot, 'cat'));
  assert.deepStrictEqual(p.base, { size: 128, speed: 0, sleepAfterSec: 0 });
});
t('불러오기: idle 없으면 오류', () => assert.throws(() => loadPetFromDir(path.join(builtinRoot, 'broken'))));

t('설정값 우선, null이면 pet.json 값', () => {
  const base = { size: 128, speed: 80, sleepAfterSec: 600 };
  assert.deepStrictEqual(effectiveValues(base, { size: 200, speed: null, sleepAfterSec: 0 }), { size: 200, speed: 80, sleepAfterSec: 0 });
  assert.deepStrictEqual(effectiveValues(base, {}), base);
});

t('더블클릭: dblclick 이미지와 pet.json 대사 (문자열이 아니거나 빈 대사는 제외)', () => {
  const dir = mk(path.join(tmp, 'talk'), ['idle.png', 'dblclick_1.png', 'dblclick_2.png'], { phrases: ['안녕', '  ', 3, ' 반가워 '] });
  const loaded = loadPetFromDir(dir);
  assert.strictEqual(loaded.states.dblclick.loop, false);
  assert.strictEqual(loaded.states.dblclick.variants.length, 2);
  assert.deepStrictEqual(loaded.phrases, ['안녕', '반가워']);
  assert.deepStrictEqual(loadPetFromDir(mk(path.join(tmp, 'quiet'), ['idle.png'])).phrases, []);
});

t('밥그릇: eat 상태(반복)와 그릇 이미지 3장, 하나라도 없으면 null', () => {
  const dir = mk(path.join(tmp, 'bowl'), ['idle.png', 'eat.png', 'bowl_full.png', 'bowl_half.png', 'bowl_empty.png']);
  assert.strictEqual(loadPetFromDir(dir).states.eat.loop, true);
  assert.deepStrictEqual(Object.keys(loadBowlImages(dir)), ['full', 'half', 'empty']);
  assert.strictEqual(loadPetFromDir(dir).states.bowl, undefined); // bowl_*.png 는 상태 이미지가 아님
  assert.strictEqual(loadBowlImages(mk(path.join(tmp, 'bowl2'), ['idle.png', 'bowl_full.png'])), null);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} passed`);
