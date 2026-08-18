# Settings UI 고도화 — 구현 노트

## 경쟁 에디터 Settings 패턴 비교

| | Typora | Obsidian | Zettlr |
|---|---|---|---|
| **레이아웃** | 상단 탭 바 | 사이드바 + 콘텐츠 (모달) | 사이드바 + 콘텐츠 (별도 창) |
| **카테고리 수** | 6 | 7 + 플러그인별 동적 | 11 |
| **설정 검색** | v1.8부터 지원 | Hotkeys에서만 | 전체 검색 지원 |
| **설정 행 패턴** | 라벨 + 컨트롤 | **라벨 + 설명 + 컨트롤** | 라벨 + 설명 + 컨트롤 |
| **그룹핑** | 없음 (평면 목록) | **섹션 헤더로 그룹핑** | 섹션 헤더 |
| **설명 텍스트** | 최소 | **모든 설정에 설명** | 대부분 설명 |

## Baram Settings 개선 방향

### 핵심 개선 포인트

1. **Obsidian 스타일 설정 행**: 라벨 + 설명(description) 2줄 구조
2. **섹션 헤더로 그룹핑**: 탭 내 설정을 논리적 그룹으로 구분
3. **카테고리 확장**: 3탭 → 6탭 (General, Editor, Appearance, Files, Markdown, AI)
4. **모달 크기 확대**: 560px → 640px (설명 텍스트 공간 확보)

### 제안 레이아웃

```
┌──────────────────────────────────────────────────────────┐
│  Settings                                          ✕     │
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  General   │  ┌─ Startup ──────────────────────────────┐ │
│  Editor    │  │                                        │ │
│  Appearance│  │  On Launch              [▾ Restore…]   │ │
│  Files     │  │  What to do when Baram starts          │ │
│  Markdown  │  │                                        │ │
│  AI        │  │  Auto Save                     [━━●]   │ │
│            │  │  Save changes automatically            │ │
│            │  │                                        │ │
│            │  │  Save Delay               [━━━●━━━]    │ │
│            │  │  Wait before saving (2.0s)             │ │
│            │  └────────────────────────────────────────┘ │
│            │                                             │
│            │  ┌─ System ───────────────────────────────┐ │
│            │  │                                        │ │
│            │  │  Spell Check                   [●━━]   │ │
│            │  │  Check spelling while typing           │ │
│            │  │                                        │ │
│            │  │  Show Welcome                  [●━━]   │ │
│            │  │  Show welcome screen on startup        │ │
│            │  └────────────────────────────────────────┘ │
│            │                                             │
└────────────┴─────────────────────────────────────────────┘
```

### 6개 탭 구성

| 탭 | 설정 항목 | 비고 |
|---|---|---|
| **General** | On Launch, Auto Save, Save Delay, Spell Check, Show Welcome | 기존 유지 + On Launch 추가 |
| **Editor** | Font Family, Font Size, Line Height, Tab Size, Line Numbers, Auto Pair Brackets, Editor Max Width | 기존 유지 + 3개 추가 |
| **Appearance** | Color Scheme (Light/Dark/System), Accent Color, Content Width | 기존 Theme을 분리 + 강화 |
| **Files** | Wikilink Format, Auto-update Links on Rename, Default New File Location, Image Insert Action | M7 연결 시스템 설정 |
| **Markdown** | Inline Math, Highlight, Strikethrough, Diagrams, Code Block Line Numbers, Smart Punctuation | 확장 구문 토글 |
| **AI** | Provider, Model, API Key, Ollama URL (conditional), Privacy Mode | 기존 유지 + 2개 추가 |

### 시각 디자인 변경

| 요소 | 현재 | 제안 |
|---|---|---|
| 모달 너비 | 560px | **640px** |
| 사이드바 너비 | 140px | **160px** |
| 설정 행 | 라벨 + 컨트롤 (1줄) | **라벨 + 설명 + 컨트롤 (2줄)** |
| 섹션 구분 | 없음 | **섹션 헤더 (muted text + 얇은 밑줄)** |
| 설정 간 간격 | 16px | **20px** (설명 추가로 여유) |
| 컨트롤 정렬 | flex end | **고정 너비 컬럼 (200px)** |
