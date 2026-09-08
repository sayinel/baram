---
title: "시작하기"
sourceHash: "383756c5bb2e"
---

## 시작하기

### 설치

[Releases](https://github.com/sayinel/baram/releases) 페이지에서 사용하는 플랫폼의 최신 릴리스를 내려받습니다.

| 플랫폼                        | 형식                        |
| ----------------------------- | --------------------------- |
| macOS (Apple Silicon / Intel) | `.dmg`                      |
| Windows (x64)                 | `.msi`, `.exe`              |
| Linux (x64)                   | `.deb`, `.rpm`, `.AppImage` |

또는 [소스에서 직접 빌드](https://github.com/sayinel/baram#build-from-source)할 수 있습니다.

### 첫 실행

Baram을 처음 열면 시작 화면이 두 가지 선택지를 보여 줍니다.

- **폴더 열기** — 마크다운 파일이 들어 있는 기존 폴더를 엽니다
- **새 파일** — 빈 문서를 새로 만듭니다

### 화면 둘러보기

Baram은 3열 레이아웃을 씁니다.

<figure class="ui-map not-content">
  <div class="ui-map-frame">
    <div class="ui-map-chrome" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="ui-map-cell ui-map-contexts">
      <strong>컨텍스트 탭 바</strong>
      <span>볼트·폴더마다 탭 하나</span>
    </div>
    <div class="ui-map-cell ui-map-rail" aria-label="활동 표시줄">
      <span class="ui-map-icons" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <strong>활동 표시줄</strong>
    </div>
    <div class="ui-map-cell ui-map-left">
      <strong>왼쪽 사이드바</strong>
      <span>파일 트리 · 백링크 · 검색</span>
    </div>
    <div class="ui-map-center">
      <div class="ui-map-cell"><strong>문서 탭 바</strong></div>
      <div class="ui-map-cell ui-map-editor">
        <strong>메인 에디터</strong>
        <span>WYSIWYG</span>
      </div>
    </div>
    <div class="ui-map-cell ui-map-right">
      <strong>오른쪽 사이드바</strong>
      <span>개요 · AI 채팅</span>
    </div>
    <div class="ui-map-cell ui-map-status"><strong>상태바</strong></div>
  </div>
</figure>

- **컨텍스트 탭 바** — 열어 둔 볼트·폴더마다 탭 하나입니다. 창 **맨 위 전체 폭**을 차지하고, 볼트나 폴더가 하나도 열려 있지 않으면 숨습니다.
- **활동 표시줄** — 왼쪽 사이드바와 오른쪽 패널에 무엇을 띄울지 고르는 아이콘 띠입니다. **설정 > 활동 표시줄**에서 어떤 아이콘을 어떤 순서로 둘지 정합니다. 폴더를 열지 않았으면 숨습니다.
- **왼쪽 사이드바** — 파일 트리, 백링크 패널, 북마크, 전체 검색, Git 소스 제어, 버전 히스토리. `Cmd+Shift+L`(macOS) / `Ctrl+Shift+L`(Windows·Linux)로 접고 펼칩니다.
- **문서 탭 바** — 지금 컨텍스트에서 열어 둔 문서들입니다. 탭을 탭 바 밖으로 끌면 별도 창으로 떼어낼 수 있습니다.
- **메인 에디터** — 글을 쓰는 WYSIWYG 편집 영역입니다.
- **오른쪽 사이드바** — 제목 구조를 보여 주는 문서 개요, 또는 AI 채팅 패널입니다.
- **상태바** — 단어 수, 줄 수, 커서 위치를 표시합니다.

> 왼쪽 사이드바는 워크스페이스를 열면 함께 열리고 오른쪽은 닫힌 채로 시작하므로, 창은 대부분 글쓰기 공간으로 남습니다. 에디터는 **최소한의 인터페이스** 원칙을 따릅니다 — 필요한 것만, 필요할 때만 보여 줍니다.

---

## 도움말 메뉴

**도움말** 메뉴는 이 설명서와 키보드 단축키 레퍼런스, FAQ를 브라우저에서 열고, 프로젝트 홈페이지와 이슈 트래커로도 연결합니다. 앱 안에 별도 패널은 없습니다.

| 메뉴 항목 | 여는 것 |
| --------- | ------- |
| **사용 설명서** | 이 설명서 |
| **키보드 단축키** | 전체 키보드 단축키 레퍼런스 |
| **FAQ** | 자주 묻는 질문과 답 |
| **Baram 홈페이지** | 프로젝트 홈페이지 |
| **문제 신고...** | GitHub Issues |

---

## 도움 받는 곳

- **도움말 메뉴** — 사용 설명서, 키보드 단축키, FAQ를 브라우저에서 엽니다
- **명령 팔레트** (`Cmd+P` 또는 `Cmd+Shift+P`) — 모든 기능을 검색합니다
- **빠른 전환** (`Cmd+K`) — 파일을 빠르게 열고 제목으로 이동합니다
- **슬래시 명령** (`/`) — 블록을 빠르게 삽입합니다
- [**FAQ**](/ko/docs/faq/general/) — 자주 묻는 질문
- [**GitHub Issues**](https://github.com/sayinel/baram/issues) — 버그 신고나 기능 요청
