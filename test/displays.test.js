// node test/displays.test.js
const assert = require('assert');
const { displayKey, resolveDisplay, fitInto, matchesDisplay, displayMenuLabel } = require('../src/displays');

const mk = (id, label, x, y, w, h, scale = 1, taskbar = 48) => ({
  id, label, scaleFactor: scale,
  bounds: { x, y, width: w, height: h },
  workArea: { x, y, width: w, height: h - taskbar },
  size: { width: w, height: h },
});

// 주 모니터 1920x1080 + 왼쪽에 음수 좌표 모니터 + 같은 모델 두 대
const main = mk(1, 'LG 27GL850', 0, 0, 1920, 1080);
const left = mk(2, 'DELL U2720Q', -1707, 0, 1707, 960, 1.5);   // 2560x1440 @150%
const right = mk(3, 'DELL U2720Q', 1920, 0, 1707, 960, 1.5);
const all = [main, left, right];
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('같은 위치·이름이면 그 모니터', () => {
  assert.strictEqual(resolveDisplay(displayKey(right), all).id, 3);
  assert.strictEqual(resolveDisplay(displayKey(left), all).id, 2);
});
t('id가 바뀌어도 이름·위치로 찾음', () => {
  const reconnected = [main, { ...right, id: 99 }];
  assert.strictEqual(resolveDisplay(displayKey(right), reconnected).id, 99);
});
t('위치가 바뀌어도 이름이 같으면 찾음', () => {
  const moved = [main, mk(5, 'DELL U2720Q', 0, -960, 1707, 960, 1.5)];
  assert.strictEqual(resolveDisplay(displayKey(right), moved).id, 5);
});
t('저장된 모니터가 빠지면 null (호출 쪽에서 주 모니터 사용)', () => {
  assert.strictEqual(resolveDisplay(displayKey(left), [main]), null);
});
t('이름 정보가 없으면 위치와 크기가 모두 같아야 함', () => {
  const a = mk(1, '', 0, 0, 1920, 1080), b = mk(2, '', 1920, 0, 1920, 1080);
  assert.strictEqual(resolveDisplay(displayKey(b), [a, b]).id, 2);
  assert.strictEqual(resolveDisplay(displayKey(b), [a]), null); // 크기만 같으면 인정 안 함
});
t('설정 없음 → null', () => assert.strictEqual(resolveDisplay(null, all), null));

t('모니터 안이면 위치 유지', () => assert.deepStrictEqual(fitInto({ x: 100, y: 100 }, 128, main), { x: 100, y: 100 }));
t('가장자리가 작업표시줄에 걸치면 안으로 밀어 넣음', () =>
  assert.deepStrictEqual(fitInto({ x: 1850, y: 980 }, 128, main), { x: 1792, y: 904 }));
t('다른 모니터에 있으면 대상 모니터 기본 위치로', () =>
  assert.deepStrictEqual(fitInto({ x: 2500, y: 300 }, 128, main), { x: 1752, y: 864 }));
t('음수 좌표 모니터', () => {
  assert.deepStrictEqual(fitInto({ x: -1000, y: 200 }, 128, left), { x: -1000, y: 200 });
  assert.deepStrictEqual(fitInto({ x: -1750, y: 200 }, 128, left), { x: -1707, y: 200 }); // 중심은 안, 왼쪽 가장자리만 밖
  assert.deepStrictEqual(fitInto({ x: 500, y: 200 }, 128, left), { x: -168, y: 744 });
});
t('위치 정보 없음 → 기본 위치', () => assert.deepStrictEqual(fitInto(null, 128, main), { x: 1752, y: 864 }));

t('메뉴 이름', () => {
  assert.strictEqual(displayMenuLabel(main, 0, 1), '1. LG 27GL850 (1920×1080, 100%, 주 모니터)');
  assert.strictEqual(displayMenuLabel(left, 1, 1), '2. DELL U2720Q (2560×1440, 150%)'); // 1707 * 1.5 = 2560.5 → 2560
});
// 아래 값은 실제 Windows 로그(Chrome, S27R65 모니터 x=1920)에서 가져옴
const s27 = mk(4, 'S27R65', 1920, 0, 1920, 1080);
t('전체 화면: 모니터와 크기가 같으면 true (최대화 상태에서 F11/유튜브 전체 화면 포함)', () => {
  assert.strictEqual(matchesDisplay({ x: 1920, y: 0, width: 1920, height: 1080 }, s27.bounds), true);
  assert.strictEqual(matchesDisplay({ x: -1707, y: 0, width: 1707, height: 960 }, left.bounds), true);
  assert.strictEqual(matchesDisplay({ x: -1, y: -1, width: 1922, height: 1082 }, main.bounds), true); // 1px 오차 허용
});
t('전체 화면: 최대화 창은 false (작업표시줄이 없는 모니터에서 테두리 8px 바깥까지 덮어도)', () => {
  assert.strictEqual(matchesDisplay({ x: 1912, y: -8, width: 1936, height: 1096 }, s27.bounds), false);
  assert.strictEqual(matchesDisplay({ x: -8, y: -8, width: 1936, height: 1048 }, main.bounds), false); // 작업표시줄 있는 모니터
});
t('전체 화면: 일부만 덮으면 false', () => {
  assert.strictEqual(matchesDisplay({ x: 22, y: 58, width: 1760, height: 939 }, main.bounds), false);
  assert.strictEqual(matchesDisplay({ x: 3280, y: 749, width: 128, height: 128 }, s27.bounds), false); // 곰 창 자신
});
console.log(`\n${n} passed`);
