# 인수인계 — 집에서 이어서 작업하기

마지막 갱신: 2026-11-09 (v1.2.2 커밋 시점)

다른 PC, 다른 Claude 세션에서 이 문서만 보고 이어서 작업할 수 있도록 현재 상태와 다음 작업(더블클릭 동작)을 정리했다.
전체 계획과 지금까지의 변경 이력은 [plan.md](plan.md), 사용법은 [README.md](../README.md) 참고.

---

## 1. 현재 상태

- 버전: **1.2.2** (`package.json`). 1단계 MVP ~ 4단계 완성도까지 끝났고, 1.1.0·1.2.0은 기본 캐릭터 그림과 클릭 동작을 다듬은 버전
- 기본 캐릭터 6종: 곰(default), 검은 고양이(cat), 푸들(dog), 토끼(rabbit), 쿼카(quokka), 오목눈이(bird)
- 설치 프로그램: `dist/installer/DesktopPet-Setup-1.2.2.exe` (dist는 git에 올리지 않음)
- GitHub: `m3rri/desktop-pet` (개인 계정, main 브랜치). 커밋 후 push는 직접 함

### 클릭 동작 (1.2.2 기준, 클릭하면 이 중 하나를 무작위로 재생)

| 캐릭터 | 클릭 동작 |
|---|---|
| 곰 | 점프, 고개 갸웃, 볼 감싸기, 꿀단지 할짝, 하품 |
| 고양이 | 하악질, 그루밍, 사냥 전 엉덩이 씰룩씰룩, 하트, 얼굴만 기울여 부비부비 |
| 푸들 | 점프, 꼬리 흔들기, 고개 갸웃, 발라당 |
| 토끼 | 점프, 볼 감싸기, 하트, 당근 뇸뇸, 세수 |
| 쿼카 | 점프, 고개 갸웃, 볼 감싸기, 하트, 나뭇잎 오물오물 |
| 오목눈이 | 날갯짓, 날개 펴고 점프, 하트, 고개 갸웃 |

---

## 2. 집 PC에서 준비

```bash
git clone https://m3rri@github.com/m3rri/desktop-pet.git
cd desktop-pet
npm install
npm start      # 실행
npm test       # 모니터 선택·캐릭터 폴더 테스트 (27개)
```

- Node.js 20 이상 (회사 VM은 22로 작업)
- 커밋 계정: `user.name m3rri`, `user.email m3rri17@gmail.com`. 회사 PC는 이 폴더에만 개인 계정이 적용되도록 `includeIf`로 설정해 둠. 집 PC가 원래 개인 계정이면 따로 할 일 없음
- push 인증은 Windows 자격 증명 관리자에 저장된 PAT(fine-grained, 이 저장소 Contents 읽기·쓰기) 사용

---

## 3. 구조

| 파일 | 역할 |
|---|---|
| `src/main.js` | 메인 프로세스. 창·트레이·전역 단축키, 상태(idle/walk/click/sleep/drag) 전환과 이동 계산, 모니터 선택, 전체 화면 감지, 설정 저장, IPC |
| `src/renderer.js` | 캐릭터 창. 이미지를 프레임 단위로 풀어 canvas에 재생, 투명 영역 클릭 통과 판정, 마우스(클릭·드래그) 처리 |
| `src/preload.js` | 렌더러 → 메인 IPC 함수 (`window.pet.click()` 등) |
| `src/pets.js` | 캐릭터 폴더 읽기. 상태별 이미지 파일 찾기, 기본값(`STATE_DEFAULTS`) |
| `src/displays.js` | 모니터 식별·저장·복원 (테스트 있음) |
| `src/fullscreen.js` | koffi로 user32 호출해 전체 화면 앱 감지 |
| `src/settings.*` | 설정 창 (캐릭터, 움직임, 화면, 기타) |
| `scripts/make-pets.js` | 기본 캐릭터 이미지와 앱 아이콘을 코드로 그려서 `assets/`에 생성 |
| `scripts/image-encode.js` | PNG·APNG·ICO 인코더 |

### 상태가 바뀌는 흐름

1. 렌더러에서 마우스를 떼면 `endPointer()`가 4px 이상 움직였는지로 드래그/클릭을 구분하고 `window.pet.click()` 호출
2. 메인의 `ipcMain.on('pet:click')` → `setState('click', { force: true })` → 렌더러에 `pet:state` 전송
3. 렌더러는 `click` 상태의 이미지 중 하나(직전과 다른 것)를 1회 재생. 1회 재생 상태 목록은 `ONE_SHOT_STATES`
4. 재생이 끝나면 렌더러가 `pet:anim-end`를 보내고, 메인이 `idle`로 되돌림

### 캐릭터 폴더 규칙

- 상태 이름 = 파일 이름: `idle.png`, `walk.png`, `click.png` …
- 같은 상태에 여러 이미지를 두려면 `click_1.png`, `click_2.png`처럼 `상태_아무거나.확장자`
- PNG/APNG/GIF/WebP 지원. 원본은 오른쪽을 보는 기준(꼬리는 왼쪽)으로 그리고, 왼쪽으로 갈 때는 앱이 좌우를 뒤집음
- 없는 상태는 idle 이미지로 대신 보여줌

---

## 4. 기본 캐릭터 그림 고치기 (`scripts/make-pets.js`)

```bash
npm run make-pets   # assets/pets/*, assets/icon.ico 등 전부 다시 생성 (약 1분 반)
```

- `drawPet(px, kind, 옵션)`이 한 프레임을 그림. 좌표는 발 밑 중앙이 원점이고 위쪽이 음수인 로컬 좌표(128px 캔버스에서 0.8배)
- 자주 쓰는 옵션: `eyes`(open/big/happy/closed/squint/crescent/hunt), `mouth`(w/open/small/tongue/lick/munch/yawn/hiss), `pose`(dx, dy, sx, sy, rot), `tail`, `perk`, `pawPos`, `headTilt`(몸은 두고 머리만 기울임), `props`(앞발 뒤·몸 앞에 물건 그리기)
- 클릭 동작은 `CLICKS` 객체에 이름별로 정의하고, 파일 맨 아래 `makeSet(캐릭터, 폴더, [동작 이름…])`에서 캐릭터마다 고름. 배열 순서대로 `click_1.png`, `click_2.png` …가 됨
- 그림이 128px 캔버스 가장자리에 닿으면 잘리므로, 새 동작을 만들면 모든 프레임의 불투명 영역이 가장자리(0 또는 128)에 닿지 않는지 확인
- 그림체 원칙: 손그림 굵은 갈색 외곽선(군데군데 끊김, 프레임마다 살짝 일렁임), 떡처럼 둥근 몸, 파스텔 단색, 큰 분홍 볼터치. 털 무늬 같은 잔 표현은 넣지 않음(여러 번 시도했지만 지저분해 보였음)

### 지금까지 받은 피드백 (같은 실수 반복 방지)

- 팔을 길게 뻗는 표현은 팔이 갑자기 길어져 보여서 뺐음. 앞발은 몸에서 떨어진 동그란 손으로만 표현
- 눈 근처에서만 손을 움직이면 우는 것처럼 보임
- 몸 전체를 좌우로 흔드는 동작은 모두 고개만 갸웃하는 동작으로 바꿨음
- 동작에 배경 소품(스크래처 기둥 등)을 따로 그리면 어색함. 들고 있는 물건(당근, 꿀단지)은 괜찮음

---

## 5. 빌드·배포

```bash
npm run package:win   # 설치 없이 실행하는 폴더 → dist/desktop-pet-win32-x64/ (zip으로 묶어 테스트용으로 씀)
npm run dist:win      # 설치 프로그램 → dist/installer/DesktopPet-Setup-<버전>.exe
```

- 버전은 `package.json`의 `version`만 바꾸면 설치 파일 이름과 앱 정보에 반영됨
- Windows에서 실행하면 그대로 동작함. 회사 작업 환경에서는 Windows PC에서 직접 빌드할 수 없어서 Linux + Wine으로 설치 프로그램을 만들었는데, 집 PC에서는 그럴 필요 없음
- `dist/`, `out/`은 git에 올리지 않음. 빌드 폴더 안에 예전 빌드 결과(`out/` 등)가 남아 있으면 앱 안에 같이 묶여서 용량이 수백 MB로 커지므로 지우고 빌드
- 지금까지 작업 순서: 테스트용 zip 생성 → Windows에서 직접 확인 → 커밋 → 설치 프로그램 생성

---

## 6. 다음 작업: 더블클릭 동작

캐릭터를 더블클릭하면 클릭과 다른 동작을 재생하고 싶음. 어떤 동작을 넣을지는 아직 정하지 않았음.

### 먼저 정해야 할 것: 첫 번째 클릭을 어떻게 처리할지

지금은 마우스를 떼는 순간 바로 클릭 동작을 재생한다. 그래서 더블클릭을 그대로 받으면 첫 번째 클릭 동작이 먼저 시작된다.

| 방식 | 동작 | 장단점 |
|---|---|---|
| A. 기다렸다가 판단 | 클릭 후 약 250ms 동안 두 번째 클릭을 기다리고, 안 오면 클릭 동작, 오면 더블클릭 동작 | 동작이 섞이지 않음. 대신 한 번 클릭할 때마다 반응이 약 0.25초 늦어짐 |
| B. 바로 재생 후 전환 | 클릭 동작을 바로 시작하고, 짧은 시간 안에 두 번째 클릭이 오면 더블클릭 동작으로 바꿔 처음부터 재생 | 클릭 반응은 지금처럼 빠름. 대신 클릭 동작 첫 프레임이 잠깐 보였다가 바뀜 |

### 고칠 곳

1. `src/pets.js` — `STATE_DEFAULTS`에 `dblclick: { loop: false }` 추가
2. `src/renderer.js`
   - `ONE_SHOT_STATES`에 `'dblclick'` 추가
   - `endPointer()`에서 직전 클릭 시각과 위치를 기억해 더블클릭 판정 (DOM `dblclick` 이벤트 대신 지금처럼 pointer 이벤트로 직접 판정하는 편이 드래그 구분 로직과 맞음)
   - 더블클릭 이미지가 없는 캐릭터(사용자 캐릭터 등)는 click 동작으로 대신할지 정하기. 지금 규칙은 "없는 상태는 idle 이미지"라서 그대로 두면 더블클릭해도 아무 반응이 없어 보임
3. `src/preload.js` — `dblclick: () => ipcRenderer.send('pet:dblclick')`
4. `src/main.js`
   - `ipcMain.on('pet:dblclick')` → `setState('dblclick', { force: true })`
   - `pet:anim-end`에서 `dblclick`이 끝났을 때도 `idle`로 되돌리기
   - 자는 중 판정(`behavior.state !== 'click'`)처럼 `click`을 직접 비교하는 곳에 `dblclick`도 넣기
5. `scripts/make-pets.js` — 캐릭터별 더블클릭 동작을 만들고 `dblclick.png`(여러 개면 `dblclick_1.png` …)로 저장. `makeSet`에 더블클릭 목록을 받는 인자 추가
6. `test/pets.test.js` — `dblclick` 파일을 찾는지 테스트 추가
7. `README.md`의 캐릭터 폴더 설명과 `plan.md`에 반영, 버전 1.3.0

---

## 7. 새 세션 시작용 프롬프트

```
바탕화면에 캐릭터가 돌아다니는 Electron 앱(desktop-pet)을 이어서 작업하려고 해.
docs/handoff.md에 현재 상태, 구조, 그림 생성 방법, 다음 작업이 정리돼 있어.

이번에는 캐릭터를 더블클릭했을 때 동작을 추가하고 싶어.
handoff.md 6장의 "첫 번째 클릭 처리 방식"부터 같이 정하고, 캐릭터별 더블클릭 동작 아이디어도 같이 논의하자.
```
