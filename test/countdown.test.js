// node test/countdown.test.js
const assert = require('assert');
const { COLD, AFTER_WORK, countdownMessage, dueAlert, validateCountdown, shortTime } = require('../src/countdown');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const at = (h, m, s = 0) => new Date(2026, 10, 10, h, m, s);
const work = { mode: 'work', workEnd: '18:00' };
const first = () => 0;

t('남은 시간 짧게', () => {
  assert.strictEqual(shortTime((4 * 3600 + 59 * 60 + 59) * 1000), '4시간 59분 59초');
  assert.strictEqual(shortTime((25 * 60 + 3) * 1000), '25분 3초');
  assert.strictEqual(shortTime(42 * 1000), '42초');
  assert.strictEqual(shortTime(1500), '2초'); // 남은 초는 올림
});

t('퇴근: 5시간 이상 남으면 정색 (공통 3가지 중 무작위)', () => {
  assert.ok(COLD.includes(countdownMessage(work, at(9, 0))));
  assert.ok(COLD.includes(countdownMessage(work, at(13, 0)))); // 정확히 5시간
  assert.strictEqual(new Set([0, 0.4, 0.9].map((r) => countdownMessage(work, at(9, 0), () => r))).size, 3);
});

t('퇴근: 5시간 미만부터 남은 시간 + 단계별 이모지', () => {
  assert.strictEqual(countdownMessage(work, at(13, 0, 1)), '퇴근까지 4시간 59분 59초 😐');
  assert.strictEqual(countdownMessage(work, at(14, 0)), '퇴근까지 4시간 0분 0초 🙂');
  assert.strictEqual(countdownMessage(work, at(15, 30)), '퇴근까지 2시간 30분 0초 😊');
  assert.strictEqual(countdownMessage(work, at(16, 0)), '퇴근까지 2시간 0분 0초 😆');
  assert.strictEqual(countdownMessage(work, at(17, 0)), '퇴근까지 1시간 0분 0초 🤩');
  assert.strictEqual(countdownMessage(work, at(17, 45, 30)), '퇴근까지 14분 30초 🥳');
});

t('퇴근: 퇴근 시각이 지났으면 퇴근하라고', () => {
  assert.ok(AFTER_WORK.includes(countdownMessage(work, at(18, 0))));
  assert.ok(AFTER_WORK.includes(countdownMessage(work, at(21, 10), first)));
});

t('마감: 남은 날에 따라 하루 단위, 마감 시각까지', () => {
  const dl = (d, kind = 'other') => ({ mode: 'deadline', deadline: d, deadlineKind: kind });
  const now = at(14, 0); // 11월 10일 오후 2시
  const relaxed = ['마감? 아직 한참 남았지~ 🌿', '여유롭다~ 커피 한 잔 할까? ☕', '마감은 아직 먼 얘기야 😌'];
  assert.ok(relaxed.includes(countdownMessage(dl('2026-11-24T16:00'), now)));          // 14일 → 여유
  assert.match(countdownMessage(dl('2026-11-23T16:00'), now), /마감까지 13일/);        // 13일 → 슬슬 + 남은 일수
  assert.strictEqual(countdownMessage(dl('2026-11-17T16:00'), now, first), '이제 슬슬 해야지? 마감까지 7일 남았어 📝');
  assert.strictEqual(countdownMessage(dl('2026-11-16T16:00'), now), '마감까지 6일 2시간 남았어 😯'); // 1주 미만 → 일수 + 시간
  assert.strictEqual(countdownMessage(dl('2026-11-12T10:00'), now), '마감까지 1일 20시간 남았어 😯'); // 달력으로 2일 전
  assert.strictEqual(countdownMessage(dl('2026-11-11T16:00'), now), '마감까지 26시간 남았어 😰');    // 하루 전 → 시간
  assert.strictEqual(countdownMessage(dl('2026-11-11T00:30'), at(23, 50)), '마감까지 40분 0초 남았어 😰');
  assert.strictEqual(countdownMessage(dl('2026-11-10T16:00'), at(13, 30, 15)), '오늘 마감! 2시간 29분 45초 남았어 🔥'); // 당일
  assert.strictEqual(countdownMessage(dl('2026-11-10T16:00'), at(16, 0)), '마감 지났어…! 😱');         // 당일 마감 시각 지남
  assert.strictEqual(countdownMessage(dl('2026-11-10'), at(23, 0)), '오늘 마감! 1시간 0분 0초 남았어 🔥'); // 시각이 없으면 밤 12시
});

t('마감 종류: 시험(기본)·과제·원고 문구', () => {
  const now = at(14, 0);
  assert.strictEqual(countdownMessage({ mode: 'deadline', deadline: '2026-11-17T09:00' }, now, first), '이제 슬슬 공부해야지? 시험까지 7일 남았어 📝');
  assert.strictEqual(countdownMessage({ mode: 'deadline', deadline: '2026-11-10T16:00', deadlineKind: 'exam' }, now), '오늘 시험! 2시간 0분 0초 남았어 🔥');
  assert.strictEqual(countdownMessage({ mode: 'deadline', deadline: '2026-11-10T09:00', deadlineKind: 'exam' }, now), '시험 끝! 수고했어 🎉');
  assert.strictEqual(countdownMessage({ mode: 'deadline', deadline: '2026-11-13T16:00', deadlineKind: 'assignment' }, now), '과제 마감까지 3일 2시간 남았어 😯');
  assert.strictEqual(countdownMessage({ mode: 'deadline', deadline: '2026-11-20T16:00', deadlineKind: 'manuscript' }, now, first), '이제 슬슬 써야지? 원고 마감까지 10일 남았어 📝');
});

t('꺼져 있거나 값이 없으면 null (평소 대사)', () => {
  assert.strictEqual(countdownMessage({ mode: 'off', workEnd: '18:00' }, at(17, 0)), null);
  assert.strictEqual(countdownMessage({ mode: 'deadline', deadline: null }, at(17, 0)), null);
  assert.strictEqual(countdownMessage(null, at(17, 0)), null);
});

t('먼저 알려주기: 퇴근 1시간·30분·10분 전과 퇴근 시각', () => {
  const due = (p, n, cfg = work) => { const d = dueAlert(cfg, p, n); return d && d.minutes; };
  assert.strictEqual(due(at(16, 59, 55), at(17, 0, 0)), 60);
  assert.strictEqual(due(at(17, 29, 58), at(17, 30, 3)), 30);
  assert.strictEqual(due(at(17, 49, 59), at(17, 50, 0)), 10);
  assert.strictEqual(due(at(17, 59, 59), at(18, 0, 1)), 0);
  assert.strictEqual(due(at(17, 0, 1), at(17, 29, 59)), null);         // 사이에 알릴 시점이 없음
  assert.strictEqual(due(at(17, 25), at(18, 5)), 0);                    // 잠들었다 깨는 등으로 여러 개를 건너뛰면 가장 늦은 것 하나만
  assert.notStrictEqual(dueAlert(work, at(16, 59, 55), at(17, 0)).key, dueAlert(work, at(17, 29, 58), at(17, 30)).key);
  assert.strictEqual(due(at(16, 59, 55), at(17, 0), { ...work, notify: false }), null);
  assert.strictEqual(due(at(16, 59, 55), at(17, 0), { mode: 'off', workEnd: '18:00' }), null);
});

t('먼저 알려주기: 마감 하루·1시간·10분 전과 마감 시각', () => {
  const dl = { mode: 'deadline', deadline: '2026-11-11T16:00', deadlineKind: 'exam' };
  const due = (p, n) => { const d = dueAlert(dl, p, n); return d && d.minutes; };
  assert.strictEqual(due(at(15, 59, 58), at(16, 0, 2)), 24 * 60);
  assert.strictEqual(due(new Date(2026, 10, 11, 14, 59, 59), new Date(2026, 10, 11, 15, 0, 0)), 60);
  assert.strictEqual(due(new Date(2026, 10, 11, 15, 59, 59), new Date(2026, 10, 11, 16, 0, 0)), 0);
});

t('설정값 검사', () => {
  assert.strictEqual(validateCountdown({ mode: 'work', workEnd: '18:30' }), null);
  assert.strictEqual(validateCountdown({ mode: 'deadline', deadline: '2026-12-24T16:00', deadlineKind: 'exam' }), null);
  assert.ok(validateCountdown({ mode: 'deadline', deadline: '2026-02-30T16:00' }));
  assert.ok(validateCountdown({ mode: 'deadline', deadline: '2026-12-24T24:00' }));
  assert.ok(validateCountdown({ mode: 'deadline', deadlineKind: 'party' }));
  assert.ok(validateCountdown({ mode: 'work', workEnd: '25:00' }));
  assert.ok(validateCountdown({ mode: 'deadline', deadline: '내일' }));
  assert.ok(validateCountdown({ mode: 'later' }));
  assert.ok(validateCountdown({ mode: 'work', notify: 'yes' }));
});

console.log(`\n${n} passed`);
