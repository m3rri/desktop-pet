// 남은 시간 알림 문구 (더블클릭 3번 중 1번). Electron 의존 없음 (test/countdown.test.js)
//
// 설정 { mode, workEnd, deadline, deadlineKind, notify }
//   mode: 'work'     매일 퇴근 시각(workEnd, "HH:MM")까지 남은 시간
//         'deadline' 마감 날짜·시각(deadline, "YYYY-MM-DDTHH:MM")까지, 남은 날에 따라 하루 단위로 (직장인이 아닌 경우)
//                    deadlineKind: 마감 종류 (시험·과제·원고 등). 말풍선 문구에 들어감
//         'off'      알리지 않음
//   notify: 정해진 시점(ALERT_MINUTES)이 되면 더블클릭하지 않아도 먼저 알려줌

const HOUR = 3600 * 1000, MIN = 60 * 1000;

// 퇴근까지 5시간 이상 남았으면 캐릭터 공통으로 정색
const COLD = ['퇴근은 꿈도 꾸지마', '일 안 해?', '아직 한참 남았어. 일해'];
const AFTER_WORK = ['퇴근 시간이야! 얼른 집에 가 🏃', '퇴근 시간 지났어! 아직도 일해? 😮'];

// 5시간 미만부터는 남은 시간을 짧게 + 단계마다 다른 이모지 하나
// 단계: 4시간 초과 / 4시간 이하 / 3시간 이하 / 2시간 이하 / 1시간 이하 / 30분 이하
const STEPS = [4 * HOUR, 3 * HOUR, 2 * HOUR, HOUR, 30 * MIN];
const WORK_EMOJI = ['😐', '🙂', '😊', '😆', '🤩', '🥳'];     // 퇴근이 가까울수록 신남

// 마감 종류. noun은 문구에 들어가는 말 (모두 받침으로 끝나서 "은"을 씀), todo는 "이제 슬슬 ○○"
const DEADLINE_KINDS = {
  exam: { label: '시험', noun: '시험', todo: '공부해야지', past: '시험 끝! 수고했어 🎉' },
  assignment: { label: '과제', noun: '과제 마감', todo: '해야지', past: '과제 마감 지났어…! 😱' },
  manuscript: { label: '원고', noun: '원고 마감', todo: '써야지', past: '원고 마감 지났어…! 😱' },
  project: { label: '프로젝트', noun: '프로젝트 마감', todo: '해야지', past: '프로젝트 마감 지났어…! 😱' },
  other: { label: '기타', noun: '마감', todo: '해야지', past: '마감 지났어…! 😱' },
};
const DEFAULT_KIND = 'exam';

// 마감: 남은 날(오늘과 마감일의 달력 날짜 차이)에 따라
//   2주 이상: 여유 / 1주 이상: 이제 슬슬 + 남은 일수 / 1주 미만: 남은 일수 + 시간
//   하루 전: 남은 시간 / 당일: 시간 + 분 + 초 / 지남
const RELAXED = [(k) => `${k.noun}? 아직 한참 남았지~ 🌿`, () => '여유롭다~ 커피 한 잔 할까? ☕', (k) => `${k.noun}은 아직 먼 얘기야 😌`];
const NUDGE = [
  (k, d) => `이제 슬슬 ${k.todo}? ${k.noun}까지 ${d}일 남았어 📝`,
  (k, d) => `슬슬 시작해 볼까? ${k.noun}까지 ${d}일 남았어 ✏️`,
  (k, d) => `${k.noun}까지 ${d}일! 이제 슬슬 ${k.todo}? 📝`,
];

function step(remaining) {
  return STEPS.filter((t) => remaining <= t).length;
}

// 3시간 5분 9초 / 25분 3초 / 42초
function shortTime(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h > 0) return `${h}시간 ${m}분 ${s}초`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

function parseWorkEnd(workEnd, now) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(workEnd || '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0); // 오늘 퇴근 시각 (내 PC 시간대 기준)
  return d;
}

// "YYYY-MM-DDTHH:MM" → { day: 마감일 0시, end: 마감 시각 } (내 PC 시간대). 시각이 없으면 그날 밤 12시
function parseDeadline(deadline) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(deadline || '');
  if (!m) return null;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(day.getTime()) || day.getDate() !== Number(m[3])) return null;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return null;
  const end = m[4] === undefined
    ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(m[4]), Number(m[5]));
  return { day, end };
}

// 오늘부터 마감일까지 달력으로 며칠 (오늘이 마감일이면 0, 지났으면 음수)
function daysUntil(day, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((day - today) / (24 * HOUR)); // 서머타임이 있는 시간대도 반올림으로 맞춤
}

const pick = (list, rand) => list[Math.floor(rand() * list.length) % list.length];

// 알릴 문구. 꺼져 있거나 설정이 비어 있으면 null (평소 대사를 씀)
function countdownMessage(cfg, now = new Date(), rand = Math.random) {
  if (!cfg) return null;
  if (cfg.mode === 'work') {
    const end = parseWorkEnd(cfg.workEnd, now);
    if (!end) return null;
    const left = end - now;
    if (left <= 0) return pick(AFTER_WORK, rand);
    if (left >= 5 * HOUR) return pick(COLD, rand);
    return `퇴근까지 ${shortTime(left)} ${WORK_EMOJI[step(left)]}`;
  }
  if (cfg.mode === 'deadline') {
    const dl = parseDeadline(cfg.deadline);
    if (!dl) return null;
    const k = DEADLINE_KINDS[cfg.deadlineKind] || DEADLINE_KINDS[DEFAULT_KIND];
    const days = daysUntil(dl.day, now);
    const left = dl.end - now;
    if (left <= 0) return k.past;
    if (days >= 14) return pick(RELAXED, rand)(k);
    if (days >= 7) return pick(NUDGE, rand)(k, days);
    if (days >= 2) return `${k.noun}까지 ${Math.floor(left / (24 * HOUR))}일 ${Math.floor((left % (24 * HOUR)) / HOUR)}시간 남았어 😯`;
    if (days === 1) return `${k.noun}까지 ${left >= HOUR ? `${Math.floor(left / HOUR)}시간` : shortTime(left)} 남았어 😰`;
    return `오늘 ${k.noun}! ${shortTime(left)} 남았어 🔥`;
  }
  return null;
}

// ---------- 먼저 알려주기 ----------
// 더블클릭하지 않아도 이 시점이 되면 캐릭터가 먼저 말함 (분 단위, 0 = 퇴근·마감 시각)
const ALERT_MINUTES = { work: [60, 30, 10, 0], deadline: [24 * 60, 60, 10, 0] };

// 지금 기준 퇴근·마감 시각. 알림이 꺼져 있거나 값이 없으면 null
function targetTime(cfg, now = new Date()) {
  if (!cfg) return null;
  if (cfg.mode === 'work') return parseWorkEnd(cfg.workEnd, now);
  if (cfg.mode === 'deadline') { const dl = parseDeadline(cfg.deadline); return dl ? dl.end : null; }
  return null;
}

// 지난 확인(prev) 뒤로 지금(now)까지 사이에 알릴 시점이 지나갔으면 그중 가장 늦은 것. 없으면 null.
// prev를 앱 시작 시각으로 두면 시작하자마자 지난 알림이 한꺼번에 뜨지 않음
function dueAlert(cfg, prev, now) {
  if (!cfg || cfg.notify === false) return null;
  const end = targetTime(cfg, now);
  const list = ALERT_MINUTES[cfg.mode];
  if (!end || !list) return null;
  let due = null;
  for (const min of list) {
    const at = end.getTime() - min * MIN;
    if (at > prev.getTime() && at <= now.getTime() && (!due || at > due.at)) due = { at, minutes: min, key: `${cfg.mode}|${end.getTime()}|${min}` };
  }
  return due;
}

// 설정 화면에서 받은 값 검사. 잘못된 값이면 오류 문구
function validateCountdown(c) {
  if (!c || !['work', 'deadline', 'off'].includes(c.mode)) return '알림 기준을 골라 주세요.';
  if (c.workEnd !== undefined && c.workEnd !== null && !parseWorkEnd(c.workEnd, new Date())) return '퇴근 시간을 확인해 주세요.';
  if (c.deadline !== undefined && c.deadline !== null && c.deadline !== '' && !parseDeadline(c.deadline)) return '마감 날짜와 시각을 확인해 주세요.';
  if (c.deadlineKind !== undefined && !DEADLINE_KINDS[c.deadlineKind]) return '마감 종류를 골라 주세요.';
  if (c.notify !== undefined && typeof c.notify !== 'boolean') return '먼저 알려주기 값이 올바르지 않습니다.';
  return null;
}

module.exports = { COLD, AFTER_WORK, WORK_EMOJI, DEADLINE_KINDS, DEFAULT_KIND, ALERT_MINUTES, countdownMessage, targetTime, dueAlert, validateCountdown, shortTime };
