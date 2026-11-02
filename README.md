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
| 숨기기/보이기 | `Ctrl + Alt + P`, 또는 트레이 아이콘 클릭 |
| 종료 | 트레이 아이콘 우클릭 → 종료 |

마지막 위치는 `%APPDATA%\desktop-pet\window-state.json`에 저장되고 다음 실행 때 복원됩니다.

## 이미지 교체

`assets/pet.png`를 투명 배경 PNG로 바꾸면 됩니다. 창 크기는 `src/main.js`의 `WINDOW_SIZE`에서 조정합니다.
임시 이미지를 다시 만들려면 `npm run make-icon`.

## 구조

```
src/main.js      메인 프로세스: 창, 트레이, 전역 단축키, 위치 저장
src/preload.js   렌더러에 노출할 API (아직 비어 있음)
src/index.html   이미지 표시
assets/pet.png   표시할 이미지
scripts/         임시 이미지 생성 스크립트
docs/plan.md     단계별 계획
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
- [ ] Windows에서 실행 확인
