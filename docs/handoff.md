# 인수인계 — 집에서 이어서 작업하기

마지막 갱신: 2026-11-10 (v1.4.1 커밋 시점)

다른 PC, 다른 Claude 세션에서 이 문서만 보고 이어서 작업할 수 있도록 현재 상태와 다음 작업 후보를 정리했다.
전체 계획과 지금까지의 변경 이력은 [plan.md](plan.md), 사용법은 [README.md](../README.md) 참고.

---

## 1. 현재 상태

- 버전: **1.4.1** (`package.json`). 1단계 MVP ~ 4단계 완성도까지 끝났고, 1.1.0·1.2.0은 기본 캐릭터 그림과 클릭 동작을 다듬은 버전
- 기본 캐릭터 6종: 곰(default), 검은 고양이(cat), 푸들(dog), 토끼(rabbit), 쿼카(quokka), 오목눈이(bird)
- 설치 프로그램: [GitHub Releases](https://github.com/m3rri/desktop-pet/releases/latest) (`DesktopPet-Setup.exe`, 태그 push로 자동 배포)
- GitHub: `m3rri/desktop-pet` (개인 계정, main 브랜치). 커밋 후 push는 직접 함

### 클릭 동작 (1.4.1 기준, 클릭하면 이 중 하나를 무작위로 재생)

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
| `src/bubble.*` | 말풍선 창. 글자 크기를 재고 손그림 테두리를 그림 |
| `src/countdown.js` | 남은 시간 알림 문구 (테스트 있음) |
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
npm run dist:win      # 설치 프로그램 → dist/installer/DesktopPet-Setup.exe (내 PC에만, 올리지 않음)
```

- **배포는 태그 push** (1.4.1부터): `package.json` 버전을 올려 커밋 → `git push origin main` → `git tag v<버전>` → `git push origin v<버전>`. GitHub Actions(`.github/workflows/release.yml`, windows-latest)가 빌드해서 Releases에 `DesktopPet-Setup.exe`, `latest.yml`, `.blockmap`을 올림
- 다운로드 링크는 항상 `https://github.com/m3rri/desktop-pet/releases/latest/download/DesktopPet-Setup.exe` (설치 파일 이름에 버전을 넣지 않음)
- Release는 Actions가 초안으로 먼저 만들고, 파일이 다 올라간 뒤 공개함 (바로 공개로 올렸던 v1.4.1에서 같은 태그의 Release가 2개 생겼음)
- 태그와 `package.json` 버전이 다르면 Actions가 멈춤. `npm ci`를 쓰므로 의존성을 바꾸면 `package-lock.json`도 같이 커밋
- `.github/workflows` 파일을 바꿔 push하려면 PAT에 Workflows 권한이 필요
- 1.4.0까지는 회사 작업 환경에서 Windows PC에서 직접 빌드할 수 없어서 Linux + Wine으로 설치 프로그램을 만들고 파일을 나눠 옮겼음. 이제는 필요 없음
- `dist/`, `out/`은 git에 올리지 않음. 빌드 폴더 안에 예전 빌드 결과(`out/` 등)가 남아 있으면 앱 안에 같이 묶여서 용량이 수백 MB로 커지므로 지우고 빌드
- 작업 순서: 테스트용 zip 생성 → Windows에서 직접 확인 → 커밋 → 태그 push로 배포
- 다운로드 페이지(Cloudflare Pages, `m3rri.github.io` 저장소의 `desktop-pet/download/`)와 앱 안 자동 업데이트는 아직 (프로젝트 문서 distribution-page.md 참고)

---

## 6. 더블클릭 말풍선 (1.3.0)

- 클릭은 0.25초 동안 두 번째 클릭을 기다렸다가 없으면 클릭 동작 (A안). `src/renderer.js`의 `handleClick()`, `DBL_MS`
- 더블클릭 → 메인 `talk()`: 걷기·잠을 멈추고 `pet.phrases`(pet.json `phrases`) 중 하나를 `showBubble(text, ms)`로 띄움. 캐릭터 폴더에 `dblclick` 이미지가 있으면 그 동작도 재생
- 말풍선은 캐릭터 창과 별도의 투명 창(`src/bubble.*`). 순서: 메인이 `bubble:show`로 문구 전달 → 말풍선 창이 글자 크기를 재서 `bubble:size` → 메인이 `positionBubble()`로 캐릭터 머리 위에 놓고 `bubble:tail`로 꼬리 위치 전달 → 손그림 테두리를 그림
- 폰트는 `assets/fonts/gaegu` (Gaegu, SIL OFL 1.1). 폰트를 바꾸려면 OFL 같은 재배포 가능 라이선스인지 확인하고, 라이선스 문서를 같이 넣을 것
- 기본 캐릭터 대사는 `scripts/make-pets.js`의 `PHRASES`에서 고치고 `npm run make-pets` (pet.json에 들어감)

---

## 7. 남은 시간 알림 (1.4.0, 1.4.1)

- 더블클릭 3번째마다 메인 `talk()`가 `countdownMessage(settings.countdown)`를 말함. 설정이 꺼져 있거나 비어 있으면 평소 대사
- 문구 규칙은 `src/countdown.js` 한 곳에 모여 있음 (퇴근: 정색 `COLD`, 이모지 단계 `WORK_EMOJI`·`STEPS` / 마감: 종류별 말 `DEADLINE_KINDS`, 여유 `RELAXED`, 슬슬 `NUDGE`, 일수 단계). 바꾸면 `test/countdown.test.js`도 같이 고칠 것
- 설정: `settings.countdown = { mode: 'work' | 'deadline' | 'off', workEnd: 'HH:MM', deadline: 'YYYY-MM-DDTHH:MM' | 'YYYY-MM-DD' | null, deadlineKind: 'exam' | 'assignment' | 'manuscript' | 'project' | 'other', notify: boolean }` (시각이 없으면 그날 밤 12시). 설정 화면 "남은 시간 알림"
- 먼저 알려주기 (1.4.1): 메인 `checkAlerts()`가 1초마다 `dueAlert(cfg, 지난 확인, 지금)`으로 알릴 시점을 확인. 시점 목록은 `ALERT_MINUTES`
- 초가 줄어드는 말풍선 (1.4.1): 남은 시간 문구면 `showBubble(text, ms, { r })`로 띄우고, 떠 있는 동안 1초마다 다시 계산해 `bubble:update`로 글자만 바꿈 (폭은 줄이지 않음)

---

## 8. 다음 작업 후보 (아직 정하지 않음)

- 요일별 퇴근 시간, 주말에는 알림 끄기
- 기본 캐릭터에 `dblclick` 동작 이미지 추가

---

## 9. 새 세션 시작용 프롬프트

```
바탕화면에 캐릭터가 돌아다니는 Electron 앱(desktop-pet)을 이어서 작업하려고 해.
docs/handoff.md에 현재 상태, 구조, 그림 생성 방법, 지금까지 한 일과 다음 작업 후보가 정리돼 있어.
먼저 handoff.md를 읽고, 다음에 뭘 할지 같이 정하자.
```
