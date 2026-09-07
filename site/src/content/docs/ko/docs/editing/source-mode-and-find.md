---
title: "소스 모드, 찾기 및 바꾸기"
sourceHash: "d6c22f3ec7b4"
---

## 소스 모드

`Cmd+/`(macOS) 또는 `Ctrl+/`(Windows/Linux)를 누르면 WYSIWYG 모드와 소스 모드를 오갑니다.

소스 모드에서는 CodeMirror 6 에디터로 원본 마크다운을 직접 편집합니다.

- 구문 강조
- 마크다운 원본 전체 표시
- 실행 취소·실행 복귀(`Cmd+Z` / `Cmd+Shift+Z`)
- 줄 번호(설정 > 에디터에서 조정)
- **Vim 키 바인딩** 선택 가능(설정 > 에디터 > Vim 키 바인딩) — 스위치 하나로 소스 모드·WYSIWYG 에디터·코드 블록 안에서 모달 편집이 켜지고, `/` 검색과 `:w`·`:q`·`:N` ex 명령, 한글 IME를 지원합니다(macOS에서 확인했고 Windows·Linux는 아직 검증하지 않았습니다). [키보드 단축키](/baram/ko/docs/customization/keyboard-shortcuts/#vim-mode) 참조
- 모드를 바꾸면 모든 변경이 WYSIWYG 모드로 그대로 반영됩니다

마크다운을 정확히 손봐야 할 때나 서식이 이상할 때 원인을 찾는 데 좋습니다.

---

## 찾기 및 바꾸기

### 찾기 (`Cmd+F`)

`Cmd+F`(macOS) 또는 `Ctrl+F`(Windows/Linux)를 눌러 찾기 표시줄을 엽니다.

- 입력하면 검색 — 걸린 텍스트가 에디터에서 강조됩니다
- **Enter** — 다음 결과로 이동
- **Shift+Enter** — 이전 결과로 이동
- **Escape** — 찾기 표시줄 닫기

### 바꾸기 (`Cmd+H`)

`Cmd+H`(macOS) 또는 `Ctrl+H`(Windows/Linux)를 눌러 찾기 및 바꾸기를 엽니다.

- 찾을 텍스트와 바꿀 텍스트를 넣습니다
- **바꾸기** — 현재 결과를 바꿉니다
- **모두 바꾸기** — 걸린 것을 한 번에 모두 바꿉니다

---
