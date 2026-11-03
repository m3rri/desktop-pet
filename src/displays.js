// 모니터 식별과 배치 계산. Electron에 의존하지 않는 순수 함수만 두어 node로 테스트할 수 있게 함.
// display 객체는 Electron screen API의 Display 형태: { id, label, bounds, workArea, size, scaleFactor }

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 설정 파일에 저장할 모니터 식별 정보.
// Display.id 는 케이블을 다시 꽂거나 도킹을 바꾸면 달라질 수 있어 저장하지 않음.
function displayKey(d) {
  return {
    label: d.label || '',
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.size.width,
    height: d.size.height,
  };
}

// 저장된 식별 정보와 가장 잘 맞는 모니터를 찾음. 확신할 수 없으면 null.
//   이름 일치 +4, 위치 일치 +2, 크기 일치 +1 → 3점 이상만 인정
//   (이름이 같거나, 이름 정보가 없을 때 위치와 크기가 모두 같아야 함)
//   같은 모델 모니터가 두 대면 이름이 같으므로 위치·크기 점수로 구분됨
function resolveDisplay(saved, displays) {
  if (!saved) return null;
  let best = null;
  let bestScore = 0;
  for (const d of displays) {
    let score = 0;
    if (saved.label && d.label === saved.label) score += 4;
    if (d.bounds.x === saved.x && d.bounds.y === saved.y) score += 2;
    if (d.size.width === saved.width && d.size.height === saved.height) score += 1;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return bestScore >= 3 ? best : null;
}

function isCenterInside(pos, size, bounds) {
  const cx = pos.x + size / 2;
  const cy = pos.y + size / 2;
  return cx >= bounds.x && cx < bounds.x + bounds.width && cy >= bounds.y && cy < bounds.y + bounds.height;
}

// 모니터 작업 영역의 오른쪽 아래 기본 위치
function defaultPosition(display, size, margin = 40) {
  const a = display.workArea;
  return { x: a.x + a.width - size - margin, y: a.y + a.height - size - margin };
}

// 창 위치를 해당 모니터 안으로 맞춤.
//   창 중심이 모니터 밖이면(다른 모니터에 있거나 모니터가 빠진 경우) 기본 위치로 옮기고,
//   중심은 안에 있지만 가장자리가 걸쳐 있으면 작업 영역 안으로 밀어 넣음
function fitInto(pos, size, display) {
  if (!pos || !isCenterInside(pos, size, display.bounds)) return defaultPosition(display, size);
  const a = display.workArea;
  return {
    x: clamp(pos.x, a.x, a.x + a.width - size),
    y: clamp(pos.y, a.y, a.y + a.height - size),
  };
}

// 창이 모니터와 정확히 같은 크기인지 (전체 화면 앱 판별용). 작업표시줄까지 덮어야 하므로 bounds와 비교.
// "덮는지"가 아니라 "같은지"를 보는 이유: 최대화한 창은 보이지 않는 테두리 때문에
// 모니터보다 몇 px 더 큼(100% 배율에서 사방 8px). 작업표시줄이 없는 보조 모니터에서는
// 최대화 창도 모니터 전체를 덮으므로, 크기가 딱 맞는 경우만 전체 화면으로 봄
function matchesDisplay(rect, bounds, tolerance = 2) {
  const near = (a, b) => Math.abs(a - b) <= tolerance;
  return near(rect.x, bounds.x)
    && near(rect.y, bounds.y)
    && near(rect.x + rect.width, bounds.x + bounds.width)
    && near(rect.y + rect.height, bounds.y + bounds.height);
}

// 메뉴 표시용 이름: "2. DELL U2720Q (2560×1440, 150%, 주 모니터)"
function displayMenuLabel(d, index, primaryId) {
  // size는 배율이 적용된 값(DIP)이라 실제 해상도로 되돌림. Windows가 DIP를 반올림하므로 내림으로 보정
  const w = Math.floor(d.size.width * d.scaleFactor);
  const h = Math.floor(d.size.height * d.scaleFactor);
  const extra = [`${w}×${h}`, `${Math.round(d.scaleFactor * 100)}%`];
  if (d.id === primaryId) extra.push('주 모니터');
  return `${index + 1}. ${d.label || '모니터'} (${extra.join(', ')})`;
}

module.exports = { clamp, displayKey, resolveDisplay, isCenterInside, defaultPosition, fitInto, matchesDisplay, displayMenuLabel };
