# Desktop Pet

바탕화면 위에 이미지가 떠 있는 데스크톱 앱 (Electron).
단계별 계획과 검토한 기술 이슈는 [docs/plan.md](docs/plan.md) 참고.

## 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
npm start
```

## Windows 실행 파일 만들기

```bash
npm run package:win
```

`dist/desktop-pet-win32-x64/desktop-pet.exe`가 생성됩니다. 폴더째 복사하면 Node.js 없이 실행됩니다.

## 조작

| 동작 | 방법 |
|---|---|
| 이동 | 이미지를 드래그 |
| 반응 | 이미지를 클릭 (점프) |
| 숨기기/보이기 | `Ctrl + Alt + P`, 트레이 아이콘 클릭, 또는 이미지 우클릭 메뉴 |
| 종료 | 이미지 우클릭 → 종료, 또는 트레이 아이콘 우클릭 → 종료 |

트레이는 작업표시줄 오른쪽 끝(시계 옆) 아이콘 영역입니다. 안 보이면 `^`를 누르세요.

이미 실행 중일 때 exe를 다시 실행하면 새로 뜨지 않고 기존 창을 다시 보여줍니다.

## 캐릭터 동작

| 상태 | 언제 | 재생 |
|---|---|---|
| idle | 기본 | 반복 |
| walk | 2~6초 쉬다가 현재 모니터 안의 근처 지점으로 이동 | 반복 |
| click | 클릭했을 때 | 1회 재생 후 idle |
| drag | 드래그하는 동안 | 반복 |
| sleep | 키보드·마우스 입력이 `sleepAfterSec`초 동안 없을 때. 입력이 생기면 깨어남 | 반복 |

## 캐릭터 바꾸기

`%APPDATA%\desktop-pet\pet` 폴더를 만들고 아래처럼 이미지를 넣은 뒤 앱을 다시 실행하면 됩니다.
폴더가 없거나 `idle` 이미지가 없으면 기본 캐릭터(곰)를 사용합니다.

```
%APPDATA%\desktop-pet\pet\
├── idle.png      필수. 이미지가 없는 상태는 이 이미지로 대체
├── walk.gif
├── click.webp
├── sleep.png
├── drag.png
└── pet.json      선택
```

- 파일 이름 = 상태 이름. 확장자는 `.png`, `.apng`, `.gif`, `.webp` 중 아무거나
- 정지 이미지와 애니메이션(GIF, APNG, 애니메이션 WebP) 모두 가능. 투명 배경 권장
- 이미지는 오른쪽을 바라보게 그리면 왼쪽으로 걸을 때 자동으로 뒤집힘 (`facing`으로 변경 가능)
- 상태마다 이미지 크기가 달라도 하단 중앙에 맞춰 그리므로 발 위치가 고정됨

`pet.json` (모든 항목 선택):

```json
{
  "name": "곰",
  "size": 128,
  "speed": 80,
  "facing": "right",
  "sleepAfterSec": 600,
  "states": { "click": { "loop": false } }
}
```

| 항목 | 의미 | 기본값 |
|---|---|---|
| `size` | 창 크기(px) | 128 |
| `speed` | 걷는 속도(px/초) | 80 |
| `facing` | 원본 이미지가 바라보는 방향 | `right` |
| `sleepAfterSec` | 입력이 없을 때 잠들기까지 걸리는 시간(초) | 600 |
| `states.<상태>.loop` | 반복 재생 여부 | click만 `false` |

기본 캐릭터 이미지는 `npm run make-sample-pet`으로 다시 만들 수 있습니다 (`scripts/make-sample-pet.js`).

## 파일 위치

| 파일 | 위치 |
|---|---|
| 사용자 캐릭터 | `%APPDATA%\desktop-pet\pet\` |
| 마지막 위치 | `%APPDATA%\desktop-pet\window-state.json` |
| 로그 | `%APPDATA%\desktop-pet\main.log` |

## 구조

```
src/main.js       메인 프로세스: 창, 트레이, 단축키, 캐릭터 불러오기, 상태 전환·이동, 드래그
src/preload.js    렌더러에 노출하는 API (window.pet)
src/renderer.js   이미지를 프레임으로 풀어(ImageDecoder) canvas에 재생, 클릭·드래그 감지
src/index.html    canvas
assets/pets/default/  기본 캐릭터
assets/tray.png   트레이 아이콘
scripts/          기본 캐릭터 이미지 생성 스크립트
docs/plan.md      단계별 계획
```

## MVP 진행 상황

- [x] 투명 배경, 테두리 없는 창
- [x] 항상 위
- [x] 작업표시줄에서 숨기기
- [x] PNG 이미지 1장 표시
- [x] 드래그로 이동
- [x] 전역 단축키로 숨기기/보이기
- [x] 트레이 아이콘과 메뉴
- [x] 마지막 위치 저장·복원
- [x] Windows에서 실행 확인

## 2단계 진행 상황

- [x] 캐릭터 폴더 불러오기 (PNG, APNG, GIF, WebP)
- [x] canvas에 프레임 직접 재생 (ImageDecoder)
- [x] 상태 전환: idle, walk, click(1회 재생), drag, sleep
- [x] 화면 안에서 돌아다니기, 방향에 따라 좌우 반전
- [x] Windows에서 실행 확인
