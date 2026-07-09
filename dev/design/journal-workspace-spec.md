# Journal Workspace 설계서

> **상위 참조**: Part 5(§5.14 저널/데일리 노트), Part 4(§4.2 레이아웃), Part 8(§8.2 로드맵)
> **기존 구현**: §56(저널 기본), §57(멘션 시스템)
> **신규 섹션**: §56a–§56l

---

## 목차

1. [개요](#1-개요)
2. [폴더 구조 (§56a)](#2-폴더-구조-56a)
3. [Journal Workspace 모드 (§56b)](#3-journal-workspace-모드-56b)
4. [Memories View (§56c)](#4-memories-view-56c)
5. [Photo Journal (§56d)](#5-photo-journal-56d)
6. [무드 트래커 (§56e)](#6-무드-트래커-56e)
7. [Periodic Notes (§56f)](#7-periodic-notes-56f)
8. [Writing Streaks & 통계 (§56g)](#8-writing-streaks--통계-56g)
9. [저널 테마 (§56h)](#9-저널-테마-56h)
10. [Daily Prompts (§56i)](#10-daily-prompts-56i)
11. [AI 회고 (§56j)](#11-ai-회고-56j)
12. [저널 검색 (§56k)](#12-저널-검색-56k)
13. [Daily Capture (§56l)](#13-daily-capture-56l)
14. [데이터 모델](#14-데이터-모델)
15. [단축키](#15-단축키)
16. [구현 우선순위](#16-구현-우선순위)
17. [마이그레이션](#17-마이그레이션)

---

## 1. 개요

### 1.1 목표

현재 Baram의 저널은 "기능(feature)" 수준이다. 이를 **저널 작성에만 집중할 수 있는 독립된 workspace**로 격상한다.

### 1.2 설계 원칙

| 원칙 | 설명 |
|------|------|
| **독립된 공간** | 저널 폴더가 모든 관련 파일(일기, 사진, 템플릿, 설정)을 자체적으로 포함 |
| **집중 모드** | FileTree, Graph View 등 모든 기능이 저널 컨텍스트로 스코핑 |
| **감성적 UX** | 전용 테마, 미니멀 무드 트래커, 수채화 톤의 시각화 |
| **마크다운 우선** | 모든 데이터가 마크다운 + frontmatter로 저장, 벤더 종속 없음 |
| **점진적 확장** | 기본은 데일리 노트, 원하면 무드/사진/Periodic Notes로 확장 |

### 1.3 기존 구현과의 관계

| 영역 | 기존 (§56) | 신규 |
|------|-----------|------|
| 폴더 | 단일 디렉토리, 플랫 | 계층적 `YYYY/MM/` + 서브폴더 |
| FileTree | vault 전체 | 저널 폴더만 스코핑 |
| 사이드바 | 캘린더만 | 캘린더 + 통계 + 검색 |
| 우측 패널 | 미사용 | Memories View |
| 테마 | 일반 테마 공유 | 저널 전용 테마 |
| 사진 | 없음 | 드래그&드롭 + 갤러리 |
| 무드 | 없음 | 컬러 도트 5단계 |
| 회고 | 없음 | Memories View (On This Day + One Line A Day) |
| 캡처/메모 | 없음 | Daily Capture 4종 (Idea/Link/Quote/Note) + Notes 폴더 |

---

## 2. 폴더 구조 (§56a)

### 2.1 디렉토리 레이아웃

```
{journalDirectory}/
├── daily/                        # 데일리 노트
│   ├── 2025/
│   │   ├── 01/
│   │   │   ├── 2025-01-01.md
│   │   │   └── 2025-01-15.md
│   │   └── 12/
│   │       └── 2025-12-31.md
│   └── 2026/
│       └── 02/
│           └── 2026-02-28.md
│
├── weekly/                       # 주간 회고 (선택)
│   └── 2026/
│       └── 2026-W09.md
│
├── monthly/                      # 월간 회고 (선택)
│   └── 2026/
│       └── 2026-02.md
│
├── yearly/                       # 연간 회고 (선택)
│   └── 2025.md
│
├── notes/                        # 독립 노트 (캡처 승격, 자유 메모)
│   ├── my-project-idea.md
│   ├── reading-list.md
│   └── recipes/                  # 사용자 서브폴더 (자유 생성)
│       └── pasta-recipe.md
│
├── templates/                    # 저널 전용 템플릿
│   ├── daily-default.md
│   ├── weekly-review.md
│   ├── monthly-review.md
│   └── custom/                   # 사용자 커스텀 템플릿
│
├── assets/                       # 첨부 이미지/파일
│   ├── 2026-02/
│   │   ├── 20260228-143022-cafe.jpg
│   │   └── 20260228-150315-street.jpg
│   └── 2025-02/
│       └── 20250228-091000-first-day.jpg
│
├── prompts/                      # 저널 프롬프트 컬렉션
│   ├── gratitude.md
│   ├── reflection.md
│   └── custom.md
│
└── .journal.json                 # 저널 메타데이터 (무드, 통계 캐시)
```

### 2.2 경로 규칙

| 항목 | 규칙 | 예시 |
|------|------|------|
| 데일리 노트 | `daily/YYYY/MM/YYYY-MM-DD.md` | `daily/2026/02/2026-02-28.md` |
| 주간 노트 | `weekly/YYYY/YYYY-Www.md` | `weekly/2026/2026-W09.md` |
| 월간 노트 | `monthly/YYYY/YYYY-MM.md` | `monthly/2026/2026-02.md` |
| 연간 노트 | `yearly/YYYY.md` | `yearly/2026.md` |
| 사진 | `assets/YYYY-MM/YYYYMMDD-HHmmss-name.ext` | `assets/2026-02/20260228-143022-cafe.jpg` |
| 노트 | `notes/{name}.md` 또는 `notes/{folder}/{name}.md` | `notes/my-project-idea.md` |

### 2.3 자동 디렉토리 생성

일기 생성 시 필요한 중간 디렉토리(`daily/2026/02/`)를 자동으로 생성한다. Rust `create_dir` IPC의 recursive 옵션을 활용한다.

### 2.4 마이그레이션 (기존 §56 → §56a)

기존에 flat 구조(`journals/2026-02-28.md`)를 사용하던 사용자를 위해:

1. 저널 워크스페이스 최초 진입 시 flat 파일 감지
2. "폴더 구조로 정리하시겠습니까?" 다이얼로그 표시
3. 승인 시 `daily/YYYY/MM/` 구조로 자동 이동
4. 거부 시 flat 구조 그대로 유지 (하위 호환)

---

## 3. Journal Workspace 모드 (§56b)

### 3.1 진입/퇴장

| 동작 | 트리거 |
|------|--------|
| 진입 | `Alt+Cmd+4` / 커맨드 팔레트 "Journal Workspace" / 사이드바 캘린더 아이콘 |
| 퇴장 | 다른 워크스페이스 프리셋 선택 / `Alt+Cmd+1~3` / 커맨드 팔레트 |

### 3.2 레이아웃 전환

```
진입 시:
┌──────────┬─────────────────────┬──────────────┐
│ 사이드바  │     에디터 영역      │  우측 패널    │
│          │                     │              │
│ 캘린더    │  [무드 바]           │ Memories     │
│ FileTree │  [프롬프트 카드]      │  View        │
│ (저널)   │                     │              │
│  daily   │  ## Diary            │ [Journal]    │
│  weekly  │  일기 본문 편집       │ [Photos]     │
│  monthly │  (사진 드래그&드롭)   │ [Notes]      │
│  yearly  │                     │              │
│  notes   │  ## Captures         │ One Line     │
│ 통계     │  [캡처 아이템 목록]   │ / Full 토글   │
│          │                     │              │
│ 검색     │  [AI 회고 제안]      │              │
│ (저널)   │                     │              │
└──────────┴─────────────────────┴──────────────┘
```

### 3.3 FileTree 스코핑

저널 워크스페이스 진입 시:

1. `useFileStore`의 `rootPath`를 `journalDirectory`로 임시 전환
2. FileTree가 저널 폴더만 표시 (daily, weekly, monthly, yearly, notes, templates)
3. 퇴장 시 원래 vault `rootPath`로 복원
4. `.journal.json`, `assets/` 등은 FileTree에서 숨김 처리

```typescript
// file-store.ts 확장
interface FileStore {
  // ... 기존
  originalRootPath: string | null;  // 저널 모드 진입 전 rootPath 백업
  isJournalScoped: boolean;
  enterJournalScope: (journalDir: string) => void;
  exitJournalScope: () => void;
}
```

### 3.4 Graph View 스코핑

저널 워크스페이스에서 Graph View를 열면:

- 노드: 저널 폴더 내 파일만 표시
- 엣지: 저널 파일 간 위키링크, 날짜 멘션 연결
- 클러스터: 월별 자동 그룹핑
- 날짜 노드 크기: 해당 일기의 단어 수에 비례
- 무드 색상: 노드 색상이 무드 값에 따라 변동

### 3.5 상태 저장

`workspace-store.ts`의 저널 프리셋을 확장:

```typescript
interface JournalWorkspaceState {
  sidebarOpen: true;
  sidebarPanel: "calendar";
  rightPanelOpen: true;
  rightPanelMode: "memories";    // 신규 모드
  memoriesTab: "journal" | "photos" | "notes";
  memoriesMode: "oneline" | "full";
  journalScoped: true;
}
```

---

## 4. Memories View (§56c)

### 4.1 개요

**On This Day + One Line A Day를 통합한 단일 뷰**. 같은 날짜의 과거 기록을 한 화면에 보여준다.

### 4.2 UI 구조

```
┌─ Memories: 2월 28일 ── [Journal] [Photos] [Notes] ─┐
│                                        [One Line ▾] │
│                                                  │
│ ── 2026 (오늘) ──────────────────────────        │
│ ▌ (편집 중 — 인라인 편집 가능)                    │
│                                                  │
│ ── 2025 ─────────────────────────────────        │
│ 첫 출근. 설렘과 긴장이 공존하는 하루.            │
│                                                  │
│ ── 2024 ─────────────────────────────────        │
│ (기록 없음)                                      │
│                                                  │
│ ── 2023 ─────────────────────────────────        │
│ 카페에서 책 읽으며 하루 보냄.                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 4.3 모드 전환

| 모드 | 표시 내용 | 용도 |
|------|----------|------|
| **One Line** | 각 연도의 첫 문장 또는 frontmatter `oneline` 필드 | 빠른 회고, 10년 일기 |
| **Full** | 각 연도 일기 전문 (접기/펼치기) | 상세 회고 |

### 4.4 One Line 추출 규칙

1. frontmatter에 `oneline` 필드가 있으면 해당 값 사용
2. 없으면 **Diary 섹션**의 첫 번째 비어있지 않은 텍스트 단락의 첫 문장 추출
   - Diary 섹션: `## Diary` 헤딩부터 다음 `##` 헤딩 직전까지의 영역
   - `## Captures` 섹션의 내용은 One Line 추출 대상에서 제외
   - `## Diary` 헤딩이 없으면 본문 전체에서 추출 (하위 호환)
3. heading(`#`), frontmatter(`---`), 빈 줄은 건너뜀
4. 최대 100자까지 표시, 초과 시 `…`으로 절단

```typescript
function extractOneLine(content: string): string {
  // 1. frontmatter oneline 필드 확인
  const fmMatch = content.match(/^---\n[\s\S]*?oneline:\s*(.+)\n[\s\S]*?---/);
  if (fmMatch) return fmMatch[1].trim();

  // 2. 본문 첫 문장 추출
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed === "---") continue;
    // 첫 문장 (마침표, 느낌표, 물음표 기준)
    const sentence = trimmed.match(/^[^.!?]*[.!?]/);
    return (sentence ? sentence[0] : trimmed).slice(0, 100);
  }
  return "";
}
```

### 4.5 현재 연도 인라인 편집

- One Line 모드: 현재 연도 행에 텍스트 입력 필드 표시
  - 입력 내용은 해당 일기의 frontmatter `oneline` 필드에 저장
  - 아직 일기가 없으면 입력 시 자동 생성
- Full 모드: "일기 열기" 링크 → 에디터 영역에서 편집

### 4.6 데이터 로딩

```
Memories View 활성화
  │
  ▼
현재 날짜의 MM-DD 추출
  │
  ▼
daily/ 하위 모든 YYYY/ 스캔
  │
  ▼
각 연도에서 YYYY-{MM}-{DD}.md 파일 존재 확인
  │
  ▼
존재하는 파일의 content 로드 (One Line: 첫 줄만, Full: 전체)
  │
  ▼
연도 역순 정렬하여 렌더링
```

### 4.7 Photos 탭

Memories View의 두 번째 탭. 같은 날짜의 과거 사진을 연도별로 모아 보여준다.

```
┌─ Memories: 2월 28일 ── [Journal] [Photos] [Notes] ─┐
│                                                      │
│ ── 2026 ──────────────────────────────               │
│ ┌─────┐ ┌─────┐ ┌─────┐                       │
│ │     │ │     │ │     │                       │
│ └─────┘ └─────┘ └─────┘                       │
│ 카페라떼  봄 거리  회사 앞                      │
│                                                │
│ ── 2025 ──────────────────────────────         │
│ ┌─────┐                                        │
│ │     │                                        │
│ └─────┘                                        │
│ 첫 출근 인증샷                                 │
│                                                │
│ ── 2023 ──────────────────────────────         │
│ (사진 없음)                                    │
│                                                │
└────────────────────────────────────────────────┘
```

사진 추출: 해당 날짜 일기의 마크다운에서 `![caption](path)` 이미지 참조를 파싱한다.

### 4.8 Notes 탭

Memories View의 세 번째 탭. `notes/` 폴더의 독립 노트를 탐색한다.

```
┌─ Memories: 2월 28일 ── [Journal] [Photos] [Notes] ─┐
│                                                      │
│ ── 최근 수정 ─────────────────────────────           │
│ 📝 my-project-idea.md          2시간 전              │
│ 📝 reading-list.md             어제                  │
│ 📝 recipes/pasta-recipe.md     3일 전                │
│                                                      │
│ ── 태그 클라우드 ─────────────────────────           │
│ #프로젝트(5) #독서(3) #아이디어(8) #레시피(2)        │
│ #여행(4) #운동(2)                                    │
│                                                      │
│ ── 폴더 ──────────────────────────────────           │
│ 📁 recipes/ (3)                                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

- **최근 수정**: `notes/` 내 파일을 수정 시간 역순으로 표시 (최대 20개)
- **태그 클라우드**: `notes/` 파일들의 frontmatter `tags` 필드를 집계하여 빈도순 표시
- **폴더**: 사용자가 생성한 서브폴더 목록 (파일 개수 포함)
- 노트 클릭 시 에디터에서 열기
- 태그 클릭 시 해당 태그로 전체 저널 검색 (§12)

---

## 5. Photo Journal (§56d)

### 5.1 사진 추가 방식

| 방법 | 동작 | 저장 위치 |
|------|------|----------|
| 드래그 & 드롭 | 에디터에 사진 끌어다 놓기 | `assets/YYYY-MM/` |
| 클립보드 붙여넣기 | `Cmd+V`로 스크린샷/이미지 붙여넣기 | `assets/YYYY-MM/` |
| 툴바 버튼 | 📷 버튼 → Tauri 파일 다이얼로그 (다중 선택) | `assets/YYYY-MM/` |
| 슬래시 커맨드 | `/photo` → 파일 선택 다이얼로그 | `assets/YYYY-MM/` |

### 5.2 사진 저장 규칙

1. 원본을 `assets/YYYY-MM/` 폴더에 복사 (원본 경로 의존 제거)
2. 파일명 정규화: `YYYYMMDD-HHmmss-{original}.{ext}`
3. 마크다운 삽입: `![캡션](assets/2026-02/20260228-143022-cafe.jpg)`
4. 상대 경로 사용 (저널 폴더 루트 기준)

### 5.3 캡션 편집 UX

기존 이미지 NodeView를 확장하여 캡션 영역을 추가한다.

```
┌──────────────────────────────┐
│                              │
│         [사진 이미지]         │
│                              │
├──────────────────────────────┤
│ 봄 벚꽃이 피기 시작한 거리    │  ← 클릭 시 인라인 편집
└──────────────────────────────┘
```

- 사진 아래 캡션 영역 기본 표시 (placeholder: "캡션 추가...")
- 클릭하면 인라인 편집, 마크다운 `![캡션텍스트](path)`의 alt text로 저장
- 캡션에 태그 입력 가능: `봄 벚꽃 #서울 #산책`

### 5.4 Photo Gallery

별도 탭으로 열리는 사진 갤러리 뷰. 가상 경로 `journal-photos://` 사용.

```
┌─ Photo Gallery ──── [Day] [Month ▾] [Year] ──┐
│                                                │
│ ═══ 2026년 2월 ═══                             │
│                                                │
│ 28일 (3)                                       │
│ ┌─────┐ ┌─────┐ ┌─────┐                       │
│ │     │ │     │ │     │                       │
│ └─────┘ └─────┘ └─────┘                       │
│ 카페라떼  봄 거리  회사 앞                      │
│                                                │
│ 15일 (1)                                       │
│ ┌─────┐                                        │
│ │     │                                        │
│ └─────┘                                        │
│ 발렌타인 케이크                                │
│                                                │
└────────────────────────────────────────────────┘
```

### 5.5 Gallery View 모드

| 모드 | 그룹핑 | 사용 시나리오 |
|------|--------|-------------|
| **Day** | 특정 날짜 사진만 | Memories Photos 탭에서 날짜별 보기 |
| **Month** | 해당 월의 사진을 날짜별 그룹핑 | "이번 달 사진 모아보기" |
| **Year** | 해당 연도의 사진을 월별 그룹핑 | "올해 돌아보기" |

### 5.6 사진 인터랙션

| 동작 | 결과 |
|------|------|
| 썸네일 클릭 | 라이트박스로 확대 (좌우 화살표로 넘기기) |
| 캡션 클릭 | 캡션 인라인 편집 |
| "일기 보기" 버튼 | 라이트박스에서 해당 날짜 일기로 이동 |
| 드래그 정렬 | 같은 날짜 내 사진 순서 변경 (마크다운 내 이미지 순서 변경) |

### 5.7 사진 데이터 소스

별도 DB 없이 **마크다운이 single source of truth**:

1. `assets/` 폴더 스캔 → 파일명에서 날짜 추출
2. 해당 날짜 일기의 마크다운에서 `![caption](path)` 파싱 → 캡션 획득
3. 일기에 참조되지 않은 asset은 "미분류" 섹션에 표시

---

## 6. 무드 트래커 (§56e)

### 6.1 디자인 원칙

- 이모지를 사용하지 않는다
- Baram의 미니멀 톤에 맞는 컬러 도트 방식
- 저널 테마에 따라 색상 팔레트가 변동
- 선택은 항상 선택적 (강제 아님)

### 6.2 무드 입력 UI

에디터 상단 무드 바:

```
┌─ 2026-02-28 Friday ─────────────────────────────────┐
│                                                      │
│  기분   ○       ○       ○       ●       ○           │
│        Deep    Calm   Neutral  Warm   Bright         │
│                                                      │
│  에너지  ● ● ● ● ○                                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**기분 (5단계 컬러 도트)**:

| 단계 | 라벨 | 값 | 의미 |
|------|------|-----|------|
| 1 | Deep | `deep` | 가라앉은, 힘든 |
| 2 | Calm | `calm` | 차분한, 조용한 |
| 3 | Neutral | `neutral` | 평온한, 일상적 |
| 4 | Warm | `warm` | 따뜻한, 기분 좋은 |
| 5 | Bright | `bright` | 밝은, 에너지 넘치는 |

**에너지 (5단계 도트 바)**:

- 채워진 원(●)과 빈 원(○)으로 1~5 표시
- 클릭으로 토글

### 6.3 시각적 상태

| 상태 | 표현 |
|------|------|
| 미선택 | 모든 도트가 연한 아웃라인만 (`opacity: 0.3`, `border: 1px`) |
| 호버 | 해당 도트 + 라벨 표시, 도트 살짝 커짐 |
| 선택됨 | 해당 도트 채워짐 + 미세한 glow 효과 (`box-shadow`) |
| 라벨 | 기본 숨김, 호버 시에만 표시 (깔끔함 유지) |

### 6.4 테마별 색상 팔레트

| 테마 | Deep | Calm | Neutral | Warm | Bright |
|------|------|------|---------|------|--------|
| Classic Diary | `#4A5568` | `#718096` | `#A0AEC0` | `#D69E2E` | `#ECC94B` |
| Moleskine | `#4A5568` | `#68768A` | `#90A4AE` | `#C9956B` | `#E8C07A` |
| Muji | `#6B7280` | `#9CA3AF` | `#D1D5DB` | `#F59E0B` | `#FCD34D` |
| Night Owl | `#2D3748` | `#4299E1` | `#63B3ED` | `#F6AD55` | `#FBD38D` |
| Vintage | `#6B5B4F` | `#8B7D6B` | `#A89F91` | `#C4956A` | `#DEB887` |
| Watercolor | `#5B6ABF` | `#7EB5A6` | `#A8D8C8` | `#F2B880` | `#F7D794` |
| (기본/시스템) | `#64748B` | `#94A3B8` | `#CBD5E1` | `#F59E0B` | `#FBBF24` |

CSS 변수로 정의:

```css
--mood-deep: #64748B;
--mood-calm: #94A3B8;
--mood-neutral: #CBD5E1;
--mood-warm: #F59E0B;
--mood-bright: #FBBF24;
```

### 6.5 frontmatter 저장

```yaml
---
date: 2026-02-28
tags: [journal]
mood: warm
energy: 4
---
```

- `mood` 값: `deep` | `calm` | `neutral` | `warm` | `bright` | 미입력 시 필드 없음
- `energy` 값: `1` ~ `5` | 미입력 시 필드 없음

### 6.6 Year in Pixels

1년치 무드를 한눈에 보는 격자 시각화:

```
┌─ 2026 Year in Pixels ────────────────────────────────┐
│      Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep ... │
│  1   ◉    ◉    ◉    ·   ...                          │
│  2   ◉    ◉    ◉    ·   ...                          │
│  3   ◉    ◉    ◉    ·   ...                          │
│  ...                                                  │
│ 31   ◉    ◉    -    ·   ...                          │
│                                                       │
│ ◉ Deep  ◉ Calm  ◉ Neutral  ◉ Warm  ◉ Bright  · 없음 │
└───────────────────────────────────────────────────────┘
```

- 각 셀: 해당 테마의 무드 색상으로 채워진 작은 원
- 셀 호버: 날짜 + 무드 라벨 + 일기 첫 줄 툴팁
- 셀 클릭: 해당 날짜 일기로 이동
- `-`: 해당 월에 존재하지 않는 날짜 (예: 2월 31일)
- `·`: 기록 없음 (연한 회색 점)

### 6.7 30일 무드 트렌드

```
┌─ Mood Trend (30 days) ────────────────────┐
│ Bright ·  ·     ·  · ··                   │
│ Warm   ·· · ··· ··· ··· ···               │
│ Neutral   ··                ··             │
│ Calm                          ·            │
│ Deep                                       │
│         ─────────────────────────▶         │
│         2/1        2/15        2/28        │
└────────────────────────────────────────────┘
```

- 사이드바 캘린더 하단에 축소 버전 표시
- 도트는 해당 테마의 무드 색상 사용
- 클릭하면 상세 통계 뷰로 확대

### 6.8 캘린더 무드 통합

기존 캘린더의 날짜 점 표시(존재 여부)를 무드 색상 점으로 확장:

```
┌─ 📅 2026년 2월 ────────────────┐
│ 일  월  화  수  목  금  토      │
│                      1         │
│                      ◉         │  ← 무드 색상 점
│  2   3   4   5   6   7   8     │
│  ◉   ◉   ◉   ◉   ◉   ◉   ◉   │
│  9  10  11  12  13  14  15     │
│  ◉   ◉   ◉   ◉   ◉   ◉   ◉   │
│ 16  17  18  19  20  21  22     │
│  ◉   ◉   ·   ◉   ◉   ◉   ◉   │  ← ·는 무드 미입력
│ 23  24  25  26  27 [28]        │
│  ◉   ◉   ◉   ◉   ◉   ◉       │
└─────────────────────────────────┘
```

- 무드 입력된 날짜: 해당 무드 색상의 작은 원
- 일기는 있지만 무드 미입력: 회색 점 (`·`)
- 일기 없는 날짜: 점 없음

---

## 7. Periodic Notes (§56f)

### 7.1 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| 주간 노트 활성화 | OFF | weekly/ 폴더 사용 |
| 월간 노트 활성화 | OFF | monthly/ 폴더 사용 |
| 연간 노트 활성화 | OFF | yearly/ 폴더 사용 |
| 주간 시작 요일 | 월요일 | 주간 노트 기준일 |

### 7.2 템플릿 변수

**Daily (기존 확장)**:

| 변수 | 값 예시 |
|------|---------|
| `{{date}}` | 2026-02-28 |
| `{{year}}` | 2026 |
| `{{month}}` | 02 |
| `{{day}}` | 28 |
| `{{dayName}}` | Friday |
| `{{monthName}}` | February |
| `{{daily_prompt}}` | 오늘 감사한 세 가지는? |
| `{{mood_bar}}` | (무드 선택 UI placeholder) |

**Weekly**:

| 변수 | 값 예시 |
|------|---------|
| `{{week_number}}` | W09 |
| `{{week_start}}` | 2026-02-23 |
| `{{week_end}}` | 2026-03-01 |
| `{{week_entries}}` | 해당 주 일기 링크 목록 |
| `{{week_mood_summary}}` | 주간 무드 요약 (텍스트) |

**Monthly**:

| 변수 | 값 예시 |
|------|---------|
| `{{month_name}}` | February |
| `{{month_entries}}` | 해당 월 일기 링크 목록 |
| `{{month_mood_avg}}` | 월간 평균 무드 |
| `{{month_photos}}` | 해당 월 사진 갤러리 |
| `{{month_stats}}` | 월간 통계 (작성일수, 단어수) |

**Yearly**:

| 변수 | 값 예시 |
|------|---------|
| `{{year}}` | 2026 |
| `{{total_entries}}` | 365일 중 237일 작성 |
| `{{total_words}}` | 총 45,230단어 |
| `{{year_highlights}}` | 연간 하이라이트 (가장 긴 일기, 최장 streak 등) |
| `{{year_in_pixels}}` | Year in Pixels 시각화 (코드블록) |

### 7.3 자동 집계 코드블록

Periodic Note 내에서 특수 코드블록으로 동적 데이터를 렌더링한다.

````markdown
```journal-list
range: 2026-02-01..2026-02-28
```
````

렌더링 결과: 해당 기간 일기 파일의 링크 목록 (날짜 + 첫 줄 미리보기)

````markdown
```journal-mood
range: 2026-02-01..2026-02-28
style: trend | pixels | summary
```
````

렌더링 결과: 무드 시각화 (트렌드 그래프, Year in Pixels 부분, 또는 텍스트 요약)

````markdown
```journal-photos
range: 2026-02-01..2026-02-28
layout: grid | strip
columns: 4
```
````

렌더링 결과: 해당 기간 사진 갤러리 (그리드 또는 가로 스트립)

**구현**: 각 코드블록을 Tiptap NodeView로 렌더링. 마크다운 원본은 코드블록 그대로 보존하여 라운드트립을 유지한다.

### 7.4 캘린더 연동

| 클릭 대상 | 동작 |
|----------|------|
| 날짜 숫자 | 해당 데일리 노트 열기/생성 |
| 주 번호 (좌측 열) | 해당 주간 노트 열기/생성 |
| 월 제목 ("2월") | 해당 월간 노트 열기/생성 |

캘린더에 주 번호 열을 추가 (설정으로 토글):

```
┌─ 📅 2026년 2월 ─────────────────────┐
│     일  월  화  수  목  금  토       │
│ W05                      1          │
│ W06  2   3   4   5   6   7   8      │
│ W07  9  10  11  12  13  14  15      │
│ W08 16  17  18  19  20  21  22      │
│ W09 23  24  25  26  27 [28]         │
└──────────────────────────────────────┘
```

---

## 8. Writing Streaks & 통계 (§56g)

### 8.1 통계 대시보드

사이드바에 통계 섹션 또는 별도 탭:

```
┌─ Journal Stats ───────────────────────────────┐
│                                                │
│ 🔥 14일 연속 작성 중          최장: 42일       │
│                                                │
│ 이번 달        올해          전체              │
│  25/28일       142일         523일             │
│  8,340자       45,230자      182,400자         │
│                                                │
│ [기여 히트맵 — 12개월]                         │
│ ░░█░██░░░█████░██████░████████░██░░░░█        │
│ Mar  Apr  May  Jun  Jul  Aug  Sep  ...        │
│                                                │
│ 가장 많이 쓴 요일: 일요일 (평균 450자)         │
│ 평균 작성 시간: 오후 10:23                     │
└────────────────────────────────────────────────┘
```

### 8.2 기여 히트맵

GitHub 스타일 격자:

```
     Mon ░██░░░██░░░█████░
     Wed ░░█░██░░░█████░██
     Fri ██████░████████░██
         Mar  Apr  May  Jun
```

- 색상 농도: 단어 수에 비례 (0 = 빈칸, 1~100 = 연한, 100~300 = 중간, 300+ = 진한)
- 색상은 현재 저널 테마의 accent 색상 사용
- 셀 호버: 날짜 + 단어 수 표시
- 셀 클릭: 해당 날짜 일기로 이동

### 8.3 Streak 계산 규칙

- `daily/` 폴더의 파일 존재 여부로 판단
- 빈 파일(frontmatter만 있는 경우)은 streak에 포함하지 않음 (최소 10자 이상 본문)
- **캡처만 작성한 날도 streak에 포함** — Captures 섹션에 1개 이상의 캡처 아이템이 있으면 해당 날짜를 활동일로 인정
- 연속은 자연일(calendar day) 기준
- 타임존: 시스템 로컬 타임존

### 8.4 데이터 캐시

`.journal.json` 내 `stats` 섹션:

```json
{
  "stats": {
    "currentStreak": 14,
    "longestStreak": 42,
    "totalEntries": 523,
    "totalWords": 182400,
    "entriesByDate": {
      "2026-02-28": { "words": 342, "mood": "warm", "energy": 4 },
      "2026-02-27": { "words": 128, "mood": "calm", "energy": 3 }
    },
    "lastFullScan": "2026-02-28T10:00:00Z"
  }
}
```

- 일기 저장 시 해당 날짜 항목만 증분 갱신
- 저널 워크스페이스 진입 시 마지막 스캔 이후 변경분만 갱신
- "전체 재계산" 버튼 제공 (통계 불일치 시)

---

## 9. 저널 테마 (§56h)

### 9.1 기존 §54 테마 시스템 확장

저널 전용 테마는 기존 `ThemeDef` 구조를 상속하되, 저널 전용 CSS 변수를 추가한다.

```typescript
interface JournalThemeDef extends ThemeDef {
  journalColors: {
    moodDeep: string;
    moodCalm: string;
    moodNeutral: string;
    moodWarm: string;
    moodBright: string;
  };
  journalTypography: {
    fontFamily: string;         // 저널 전용 폰트
    lineHeight: number;         // 줄 간격 (1.6~2.0)
    maxWidth: string;           // 본문 최대 너비 (예: "680px")
  };
}
```

### 9.2 내장 저널 테마 (6종)

| 테마 | 배경 | 폰트 | 분위기 | 최대 너비 |
|------|------|------|--------|----------|
| **Classic Diary** | 크림 `#FDF6E3` | Noto Serif KR | 전통 일기장 | 640px |
| **Moleskine** | 아이보리 `#F5F1EB` | Pretendard | 몰스킨 노트 | 680px |
| **Muji** | 순백 `#FFFFFF` | Pretendard Light | 미니멀 | 600px |
| **Night Owl** | 남색 `#1B2838` | Noto Sans KR | 밤 일기 | 680px |
| **Vintage** | 세피아 `#F0E6D3` | D2Coding | 타자기 편지 | 620px |
| **Watercolor** | 파스텔 `#F8F4F0` | Nanum Pen Script | 감성 다이어리 | 640px |

### 9.3 테마 전환 동작

```
저널 워크스페이스 진입
  │
  ▼
journalThemeId 설정 확인
  │
  ├─ 설정 있음 → 해당 저널 테마 적용
  │               (일반 테마 → 저널 테마)
  │
  └─ 설정 없음 → 일반 테마 유지
  │
  ...
  │
저널 워크스페이스 퇴장
  │
  ▼
원래 activeThemeId 복원
```

### 9.4 CSS 변수

기존 16개 CSS 변수에 저널 전용 변수 추가:

```css
/* 무드 트래커 색상 */
--mood-deep: ...;
--mood-calm: ...;
--mood-neutral: ...;
--mood-warm: ...;
--mood-bright: ...;

/* 저널 타이포그래피 */
--journal-font-family: ...;
--journal-line-height: ...;
--journal-max-width: ...;

/* 저널 UI */
--journal-header-bg: ...;      /* 무드 바 배경 */
--journal-prompt-bg: ...;      /* 프롬프트 카드 배경 */
--journal-prompt-border: ...;  /* 프롬프트 카드 테두리 */
```

### 9.5 커스텀 저널 테마

기존 ThemeEditor와 동일한 UX로 저널 전용 커스텀 테마를 생성/편집할 수 있다. 무드 색상 팔레트와 타이포그래피를 추가로 설정 가능.

### 9.6 설정 UI

Settings → Journal → 테마 섹션:

```
┌─ 저널 테마 ──────────────────────────────────┐
│                                               │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│ │ Classic │ │Moleskine│ │  Muji   │          │
│ │ Diary   │ │         │ │         │          │
│ │ ■■■■■   │ │ ■■■■■   │ │ ■■■■■   │          │
│ └────✓────┘ └─────────┘ └─────────┘          │
│                                               │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│ │ Night   │ │ Vintage │ │Waterclr │          │
│ │ Owl     │ │         │ │         │          │
│ │ ■■■■■   │ │ ■■■■■   │ │ ■■■■■   │          │
│ └─────────┘ └─────────┘ └─────────┘          │
│                                               │
│ [+ 커스텀 테마 만들기]                        │
└───────────────────────────────────────────────┘
```

카드 하단 `■■■■■`는 해당 테마의 무드 색상 5종 스와치.

---

## 10. Daily Prompts (§56i)

### 10.1 내장 프롬프트 카테고리

| 카테고리 | 프롬프트 수 | 예시 |
|---------|-----------|------|
| 감사 (Gratitude) | 30개 | "오늘 감사한 세 가지는?" |
| 성찰 (Reflection) | 30개 | "오늘 가장 도전적이었던 순간은?" |
| 목표 (Goals) | 20개 | "내일 꼭 하고 싶은 한 가지는?" |
| 창작 (Creative) | 20개 | "지금 창밖에 보이는 풍경을 묘사해보세요" |
| 관계 (Relationships) | 20개 | "오늘 누군가에게 고마웠던 일은?" |

### 10.2 프롬프트 카드 UI

에디터 상단, 무드 바 아래에 표시:

```
┌─ 💡 오늘의 질문 ──────────────────────── [×] ─┐
│                                                │
│ "오늘 가장 기억에 남는 대화는                   │
│  무엇이었나요?"                                │
│                                                │
│                               [다른 질문] [×]  │
└────────────────────────────────────────────────┘
```

- 접기/닫기 가능 (× 버튼)
- "다른 질문" 버튼: 같은 카테고리에서 다른 프롬프트 표시
- 설정에서 카테고리 선택 및 표시 방식 설정 (랜덤/순차)

### 10.3 템플릿 통합

`{{daily_prompt}}` 변수로 템플릿에 자동 삽입:

```markdown
---
date: {{date}}
tags: [journal]
---

# {{date}} {{dayName}}

> {{daily_prompt}}

## 메모

## 작업
```

### 10.4 사용자 커스텀 프롬프트

`prompts/` 폴더에 마크다운 파일로 관리:

```markdown
# 나만의 프롬프트

- 오늘 읽은 책에서 인상 깊었던 구절은?
- 이번 주에 배운 새로운 것은?
- 지금 가장 해결하고 싶은 문제는?
```

- 파일당 한 카테고리
- 한 줄에 한 프롬프트 (`- ` 접두사)
- 설정에서 내장/커스텀 프롬프트 혼합 비율 설정

### 10.5 프롬프트 이력

`.journal.json` 내 `promptHistory` 섹션에서 최근 사용된 프롬프트 ID를 추적하여 중복을 방지한다.

---

## 11. AI 회고 (§56j)

### 11.1 기존 AI 인프라 활용

Baram의 LLM 스트리밍(§6.3)을 저널에 특화한다. 기존 `llmComplete` IPC와 `useLLMStream` 훅을 그대로 사용.

### 11.2 기능

| 기능 | 트리거 | 동작 |
|------|--------|------|
| **후속 질문** | 일기 저장 후 자동 | 일기 내용 기반으로 심화 질문 1~2개 제안 |
| **주간 패턴** | 주간 노트 열 때 | "이번 주 운동한 날에 기분이 좋은 경향이 있어요" |
| **월간 요약** | 월간 노트 열 때 | 한 달 일기를 3줄로 요약 |
| **감정 추론** | 무드 미입력 일기 | 텍스트에서 감정 추론하여 무드 제안 |

### 11.3 UI

에디터 하단에 접을 수 있는 제안 카드:

```
┌─ ✨ AI 회고 ──────────────────────────── [×] ─┐
│                                                │
│ 오늘 "새로운 팀원"에 대해 쓰셨네요.            │
│ 첫인상은 어땠나요? 어떤 기대가 있으신가요?     │
│                                                │
│              [답변 작성하기]  [무시]            │
└────────────────────────────────────────────────┘
```

- "답변 작성하기" → 일기 하단에 AI 질문 + 빈 답변 영역 추가
- "무시" → 카드 닫기

### 11.4 프라이버시

| 설정 | 동작 |
|------|------|
| AI 회고 OFF | 기능 완전 비활성 |
| Privacy Mode ON | AI 회고 자동 비활성 (Ollama 로컬만 허용) |
| Provider = Ollama | 로컬에서만 처리, 외부 전송 없음 |

- 일기 내용은 사용자가 명시적으로 AI 기능을 트리거했을 때만 LLM에 전달
- 자동 트리거(저장 후 제안)는 설정에서 별도 토글

### 11.5 시스템 프롬프트

```
당신은 저널 회고 도우미입니다. 사용자가 오늘 쓴 일기를 바탕으로
더 깊이 생각해볼 수 있는 질문을 1~2개 제안합니다.

규칙:
- 판단하지 마세요. 호기심 어린 질문만 하세요.
- 감정을 강요하지 마세요. 사용자가 스스로 탐구하도록 유도하세요.
- 짧고 따뜻한 톤을 유지하세요.
- 한국어로 답변하세요 (사용자 언어에 맞춰).
```

---

## 12. 저널 검색 (§56k)

### 12.1 기존 Global Search 확장

Global Search(§5.11)에 저널 모드를 추가한다. 저널 워크스페이스에서 `Cmd+Shift+F`를 누르면 자동으로 저널 검색 모드로 진입.

**검색 범위**: `daily/` + `notes/` + `weekly/` + `monthly/` + `yearly/` 전체를 대상으로 검색한다. 태그 클릭 시에도 동일한 전체 범위를 검색하며, 결과를 소스 타입별로 그룹핑한다:

1. **Standalone Notes** (notes/ 폴더) — 우선 표시
2. **Daily Entries** (daily/ 폴더)
3. **Periodic Notes** (weekly/, monthly/, yearly/ 폴더)

### 12.2 저널 전용 필터

```
┌─ Journal Search ─────────────────────────────┐
│ 🔍 [검색어 입력]                              │
│                                               │
│ 필터:                                         │
│ 📅 기간   [2025-01-01] ~ [2026-02-28]        │
│ ● 기분    [○ Deep] [○ Calm] [● 전체]         │
│ 🏷️ 태그   [여행, 운동]                       │
│ 📷 사진   [□ 사진 있는 일기만]                │
│ 📊 에너지 [○ 3 이상]                         │
│                                               │
│ 결과: 23건                                    │
└───────────────────────────────────────────────┘
```

### 12.3 검색 구현

1. 텍스트 검색: 기존 `searchFiles` IPC에 `rootPath`를 저널 폴더로 지정
2. frontmatter 필터: Rust 측에서 frontmatter 파싱 후 mood/tags/energy 조건 매칭
3. 사진 필터: 마크다운 내 `![` 패턴 존재 여부로 판단
4. 날짜 범위: 파일명(`YYYY-MM-DD`)에서 날짜 추출하여 범위 필터링

### 12.4 IPC 확장

```typescript
interface JournalSearchOptions extends SearchOptions {
  dateFrom?: string;         // YYYY-MM-DD
  dateTo?: string;           // YYYY-MM-DD
  moodFilter?: string[];     // ["warm", "bright"]
  energyMin?: number;        // 1-5
  tagsFilter?: string[];     // ["여행", "운동"]
  hasPhotos?: boolean;       // true = 사진 있는 일기만
}
```

Rust 측에 `search_journal` 커맨드를 추가하거나, 기존 `search_files`에 frontmatter 필터 옵션을 확장한다.

---

## 13. Daily Capture (§56l)

### 13.1 개요

데일리 노트는 **Diary + Captures** 2개 섹션으로 구성된다.

- **Diary**: 자유 형식 일기 본문 (기존과 동일)
- **Captures**: 하루 동안 빠르게 기록한 아이디어, 링크, 인용, 메모의 시간순 목록

```markdown
---
date: 2026-02-28
tags: [journal]
mood: warm
energy: 4
---

# 2026-02-28 Friday

## Diary

오늘은 봄이 시작되는 느낌의 하루였다...

## Captures

- ✦ **새 사이드 프로젝트 아이디어**: CLI 기반 저널 도구 #아이디어
- ↗ [Tiptap 2.0 릴리즈 노트](https://tiptap.dev/blog) — 에디터 업그레이드 참고
- ❝ "The best way to predict the future is to invent it." — Alan Kay
- ☰ 내일 회의 전에 디자인 문서 검토 필요
```

### 13.2 캡처 타입 4종

| 타입 | 아이콘 | 접두사 | 슬래시 커맨드 | 용도 |
|------|--------|--------|-------------|------|
| **Idea** | ✦ | `✦` | `/idea` | 아이디어, 영감, 떠오른 생각 |
| **Link** | ↗ | `↗` | `/link` | URL 북마크 + 간단 메모 |
| **Quote** | ❝ | `❝` | `/quote` | 인용구, 명언, 발췌 |
| **Note** | ☰ | `☰` | `/note` | 간단 메모, TODO, 리마인더 |

**SVG 아이콘 스펙**:
- 크기: 16×16px (인라인), 20×20px (다이얼로그)
- 스트로크: 1.5px, `currentColor`
- 스타일: Lucide 아이콘 톤과 일관

### 13.3 캡처 입력 방식

#### 슬래시 커맨드

에디터 내에서 `/idea`, `/link`, `/quote`, `/note` 입력 시 해당 타입의 캡처 아이템을 현재 커서 위치에 삽입한다.

- Captures 섹션이 없으면 자동 생성 (`## Captures` 헤딩 + 리스트)
- 커서가 Diary 영역에 있으면 Captures 섹션 끝에 추가
- 커서가 Captures 영역에 있으면 현재 위치에 삽입

#### Quick Capture 다이얼로그 (§13.10)

`Cmd+Shift+N`으로 에디터 밖에서도 빠르게 캡처할 수 있는 모달 다이얼로그.

### 13.4 캡처 마크다운 구조

각 캡처 아이템은 불릿 리스트 아이템으로 저장된다:

```markdown
## Captures

- ✦ **제목**: 본문 내용 #태그1 #태그2
- ↗ [링크 제목](URL) — 부가 설명
- ❝ "인용 텍스트" — 출처
- ☰ 메모 내용
```

**frontmatter 확장** (캡처 메타데이터):

```yaml
---
date: 2026-02-28
captures:
  - type: idea
    time: "14:30"
    text: "CLI 기반 저널 도구"
    tags: [아이디어]
  - type: link
    time: "15:10"
    url: "https://tiptap.dev/blog"
    text: "Tiptap 2.0 릴리즈 노트"
---
```

- `captures` 배열은 선택적 — frontmatter 없이 마크다운 본문만으로도 동작
- frontmatter가 있으면 검색/필터링 성능 향상에 활용

### 13.5 승격 워크플로우

캡처 아이템을 독립 노트로 승격(promote)하는 워크플로우:

**트리거**: 캡처 아이템에 커서를 놓고 `Cmd+Shift+E` 또는 컨텍스트 메뉴 "Promote to Note"

**동작**:

1. `notes/` 폴더에 새 마크다운 파일 생성
   - 파일명: 캡처 제목의 kebab-case 변환 (예: `cli-based-journal-tool.md`)
   - 이미 존재하면 `-2`, `-3` 등 접미사 추가
2. 생성된 노트에 캡처 내용을 초기 본문으로 채움
3. 원래 캡처 아이템에 위키링크 추가: `✦ **CLI 기반 저널 도구**: [[cli-based-journal-tool]] #아이디어`
4. 생성된 노트를 새 탭에서 열기

```
[캡처 아이템]  ──Cmd+Shift+E──▶  [notes/cli-based-journal-tool.md]
   원본에 [[link]] 자동 추가         캡처 내용이 초기 본문
```

### 13.6 Notes 폴더 관리

`notes/` 폴더는 **플랫 구조**를 기본으로 하되, 사용자가 자유롭게 서브폴더를 생성할 수 있다.

**서브폴더 생성 시나리오 5종**:

| 시나리오 | 동작 |
|---------|------|
| FileTree 우클릭 "새 폴더" | `notes/` 하위에 서브폴더 생성 |
| 승격 시 경로 지정 | `Cmd+Shift+E` 다이얼로그에서 `recipes/pasta-recipe` 입력 → `notes/recipes/` 자동 생성 |
| 위키링크 경로 | `[[recipes/pasta-recipe]]` → `notes/recipes/pasta-recipe.md` 자동 생성 |
| Quick Capture 다이얼로그 | 파일명에 `folder/name` 패턴 입력 시 자동 생성 |
| 드래그&드롭 | FileTree에서 노트를 서브폴더로 드래그하여 이동 |

### 13.7 Notes 네비게이션

| 진입점 | 동작 |
|--------|------|
| **사이드바 FileTree** | `notes/` 폴더가 daily, weekly 등과 함께 트리에 표시 |
| **Quick Switcher** (`Cmd+K`) | `notes/` 파일도 검색 결과에 포함, `n:` 접두사로 노트만 필터링 |
| **Memories Notes 탭** | 최근 수정 노트 목록 + 태그 클라우드 (§4.8) |
| **백링크 패널** | 노트에서 일기를, 일기에서 노트를 양방향 참조 |

### 13.8 위키링크 자동 생성

기존 위키링크 시스템(§28)을 확장하여 `notes/` 폴더와 연동한다:

| 입력 | 해석 | 파일 경로 |
|------|------|----------|
| `[[name]]` | notes/ 내 파일 검색 → 없으면 생성 제안 | `notes/name.md` |
| `[[folder/name]]` | notes/folder/ 자동 생성 + 파일 생성 | `notes/folder/name.md` |
| `[[daily/2026-02-28]]` | daily 노트 참조 (기존 동작) | `daily/2026/02/2026-02-28.md` |

- 위키링크 자동완성에서 `notes/` 파일 목록을 제안
- 존재하지 않는 위키링크 클릭 시 "노트 생성하시겠습니까?" 다이얼로그

### 13.9 태그 시스템 (§56m)

캡처와 노트에 사용된 `#태그`를 전체 Vault에서 인덱싱하고, 검색·자동완성·네비게이션을 제공한다.

#### 경쟁 에디터 분석

| 에디터 | 태그 문법 | 중첩 태그 | 태그 패널 | 자동완성 | 클릭 동작 |
|--------|-----------|-----------|-----------|----------|-----------|
| **Obsidian** | `#tag`, `#parent/child` | ✅ (무제한) | Tag Pane (트리) | Vault 전체 | 검색 결과 |
| **Logseq** | `#tag`, `[[tag]]` | ❌ | 페이지 = 태그 | 페이지 기반 | 페이지 열기 |
| **Bear** | `#tag`, `#multi word#` | ✅ (`#parent/child`) | 사이드바 트리 | ✅ | 필터링 |
| **Notion** | DB property | ❌ | 필터 UI | DB 내 | 필터 적용 |
| **Craft** | `#tag` | ❌ | 태그 필터 | ✅ | 필터링 |
| **Typora** | 없음 | — | — | — | — |

**Baram 전략**: Obsidian 표준 모델 기반 — `#tag` 인라인 + 중첩 + Vault-wide 인덱스 + 검색 연동.

#### P0 — 필수 (§56m 스코프)

**태그 입력**:
- 인라인 `#태그명` — 마크다운 본문에 직접 작성
- 중첩 태그: `#프로젝트/baram`, `#상태/완료` (Obsidian 호환)
- frontmatter `tags: [태그1, 태그2]` — 구조화된 태그
- 입력 시 `#` 이후 Vault 전체 태그 자동완성 제안

**Vault-wide Rust 태그 인덱스**:
- Rust 백엔드에서 전체 `.md` 파일 스캔
- 인라인 `#tag` + frontmatter `tags:` 배열 추출
- `get_vault_tags(root_path)` IPC → `Vec<TagEntry { tag, count }>` 반환
- 프론트엔드 30초 TTL 캐시

**태그 클릭 동작**:
1. 에디터 내 `#tag` 텍스트 Cmd/Ctrl+Click → 글로벌 검색 실행
2. 전체 Vault 범위 검색 (저널 한정이 아닌 rootPath 전체)
3. 검색 결과를 소스 타입별 그룹핑:
   - **Standalone Notes** (notes/) — 우선 표시
   - **Daily Captures** (daily/ 내 Captures 섹션)
   - **Daily Diary** (daily/ 내 Diary 섹션)
   - **Periodic Notes** (weekly/, monthly/, yearly/)
   - **일반 파일** (저널 외 마크다운)

**Vault-wide 자동완성**:
- Rust 인덱스 기반으로 전체 Vault 태그 자동완성
- 기존 저널 폴더 한정 → Vault 전체로 확대
- 중첩 태그 경로 부분 매칭 (`proj` → `프로젝트/baram` 제안)

#### P1 — 향후 확장

| 기능 | 설명 | 구현 난이도 |
|------|------|-------------|
| **태그 사이드바 패널** | 사이드바에 태그 트리 뷰 (중첩 태그 계층 표시) | 중 |
| **태그 인라인 Atom 노드** | `#tag`를 텍스트가 아닌 ProseMirror atom node로 | 고 |
| **Frontmatter `tags:` 편집** | YAML frontmatter에서 태그 편집 UI | 중 |

#### P2 — 장기

| 기능 | 설명 |
|------|------|
| 태그 rename/merge | Vault 전체에서 태그 이름 일괄 변경 |
| 태그 색상 지정 | 사용자 정의 태그 색상 |
| 파일 태그 필터링 | FileTree에서 태그로 파일 필터 |
| 태그 클라우드 | 빈도 기반 시각화 |
| AI 태그 제안 | 내용 기반 자동 태그 추천 |

**태그 통계**: `.journal.json`에 태그별 사용 빈도를 캐싱하여 태그 클라우드 렌더링에 활용.

### 13.10 Quick Capture 다이얼로그

`Cmd+Shift+N`으로 호출하는 경량 캡처 입력 모달:

```
┌─ Quick Capture ─────────────────────────────────────┐
│                                                      │
│  [✦ Idea] [↗ Link] [❝ Quote] [☰ Note]              │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ 입력 영역 (자동 포커스)                       │   │
│  │                                              │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  태그: #아이디어 #프로젝트                   [저장]   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

- 상단 타입 선택 탭 (기본: 마지막 사용 타입)
- 입력 영역에 마크다운 지원 (볼드, 링크 등)
- 태그 입력 시 자동완성
- `Enter`로 즉시 저장, `Shift+Enter`로 줄바꿈
- 저장 위치: 오늘 날짜의 데일리 노트 `## Captures` 섹션 끝에 추가
  - 오늘 데일리 노트가 없으면 자동 생성 (템플릿 적용)
- `Esc`로 닫기

---

## 14. 데이터 모델

### 14.1 `.journal.json` 스키마

```json
{
  "version": 1,
  "stats": {
    "currentStreak": 14,
    "longestStreak": 42,
    "totalEntries": 523,
    "totalWords": 182400,
    "lastFullScan": "2026-02-28T10:00:00Z"
  },
  "entriesByDate": {
    "2026-02-28": {
      "words": 342,
      "mood": "warm",
      "energy": 4,
      "hasPhotos": true,
      "photoCount": 3,
      "tags": ["일상", "카페"],
      "captureCount": 3,
      "captureTypes": ["idea", "link", "quote"]
    }
  },
  "tagIndex": {
    "아이디어": 8,
    "프로젝트": 5,
    "독서": 3,
    "레시피": 2
  },
  "notesMetadata": {
    "my-project-idea.md": {
      "title": "CLI 기반 저널 도구",
      "tags": ["아이디어", "프로젝트"],
      "lastModified": "2026-02-28T14:30:00Z",
      "promotedFrom": "2026-02-28"
    }
  },
  "promptHistory": {
    "lastUsed": {
      "gratitude": 15,
      "reflection": 12,
      "goals": 8,
      "creative": 5,
      "relationships": 3
    },
    "usedPromptIds": ["g-001", "g-002", "r-005"]
  },
  "preferences": {
    "memoriesMode": "oneline",
    "memoriesTab": "journal",       // "journal" | "photos" | "notes"
    "promptCategory": "gratitude",
    "promptMode": "random",
    "weekStartDay": "monday",
    "showWeekNumbers": true
  }
}
```

### 14.2 frontmatter 확장

기존 저널 frontmatter에 신규 필드 추가:

```yaml
---
date: 2026-02-28
tags: [journal, 일상, 카페]
mood: warm
energy: 4
oneline: "봄이 시작되는 느낌의 하루"
---
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `date` | string | ✅ | YYYY-MM-DD 형식 |
| `tags` | string[] | ❌ | 태그 목록 |
| `mood` | string | ❌ | `deep` \| `calm` \| `neutral` \| `warm` \| `bright` |
| `energy` | number | ❌ | 1~5 |
| `oneline` | string | ❌ | One Line A Day 요약 (Memories View에서 사용) |

### 14.3 설정 확장 (settings-store.ts)

```typescript
interface SettingsState {
  // ... 기존 저널 설정
  journalEnabled: boolean;
  journalDirectory: string;
  journalFilenameFormat: string;
  journalTemplatePath: string;
  journalStartupBehavior: "openJournal" | "nothing";

  // §56a 폴더 구조
  journalUseHierarchy: boolean;        // YYYY/MM/ 구조 사용 여부

  // §56e 무드
  journalMoodEnabled: boolean;
  journalEnergyEnabled: boolean;

  // §56f Periodic Notes
  journalWeeklyEnabled: boolean;
  journalMonthlyEnabled: boolean;
  journalYearlyEnabled: boolean;
  journalWeekStartDay: "monday" | "sunday";

  // §56g 통계
  journalShowStreak: boolean;

  // §56h 테마
  journalThemeId: string | null;       // null = 일반 테마 사용
  journalCustomThemes: JournalThemeDef[];

  // §56i 프롬프트
  journalPromptEnabled: boolean;
  journalPromptCategory: string;
  journalPromptMode: "random" | "sequential";

  // §56j AI 회고
  journalAIReflectionEnabled: boolean;
  journalAIAutoSuggest: boolean;       // 저장 후 자동 제안
}
```

---

## 15. 단축키

| 단축키 | 동작 | 컨텍스트 | 구현 상태 |
|--------|------|---------|----------|
| `Alt+Cmd+4` | 저널 워크스페이스 진입/퇴장 | 전역 (기존) | ✅ |
| `Cmd+Shift+J` | 오늘의 일기 열기/생성 | 전역 | ✅ |
| `Cmd+Shift+D` | Diary 섹션으로 점프 | 저널 에디터 | ✅ |
| `Cmd+Shift+C` | Captures 섹션으로 점프 | 저널 에디터 | ✅ |
| `Cmd+Shift+M` | Memories View 토글 (우측 패널) | 전역 | ✅ |
| `Alt+←` | 전날 일기로 이동 | 저널 파일 열린 상태 | ✅ |
| `Alt+→` | 다음날 일기로 이동 | 저널 파일 열린 상태 | ✅ |
| `Cmd+Shift+E` | 캡처 아이템을 노트로 승격 | 저널 에디터 (캡처 아이템 위) | ✅ |
| `Cmd+Shift+N` | Quick Capture 다이얼로그 열기 | 저널 워크스페이스 | ✅ |
| `#` | 태그 자동완성 트리거 | Quick Capture + 에디터 | ✅ |
| `Cmd/Ctrl+Click #tag` | 태그 클릭 → 글로벌 검색 | 에디터 | 🔧 §56m |
| `Cmd+Shift+P` | Photo Gallery 열기 | 저널 워크스페이스 | 🔜 §56d |

> **참고**: 초기 설계에서 `Cmd+J`를 Diary 점프로 할당했으나, 기존 Inline AI 편집(§6.2)과 충돌하여 `Cmd+Shift+D`로 변경. `Cmd+J`는 Inline AI 유지.

---

## 16. 구현 우선순위

### Phase A: 기반 (§56a, §56b)

| 순서 | 항목 | 예상 복잡도 |
|------|------|-----------|
| A1 | 폴더 구조 재설계 + 마이그레이션 | 중 |
| A1.5 | `notes/` 폴더 생성 + FileTree 표시 | 소 |
| A2 | FileTree 스코핑 (enterJournalScope/exitJournalScope) | 중 |
| A3 | 워크스페이스 레이아웃 전환 (우측 패널 Memories 모드) | 중 |

### Phase B: 핵심 기능 (§56c, §56d, §56e, §56l)

| 순서 | 항목 | 예상 복잡도 |
|------|------|-----------|
| B1 | Memories View — One Line / Full 모드 | 상 |
| B2 | Memories View — Photos 탭 | 중 |
| B2.5 | Memories View — Notes 탭 | 중 |
| B3 | Photo Journal — 드래그&드롭 + assets 관리 | 중 |
| B4 | Photo Journal — 캡션 편집 (ImageView 확장) | 중 |
| B5 | Photo Gallery 별도 뷰 (Month/Year) | 상 |
| B6 | 무드 트래커 — 입력 UI + frontmatter 저장 | 중 |
| B7 | 무드 트래커 — 캘린더 색상 점 통합 | 소 |
| B8 | Year in Pixels 시각화 | 중 |
| B9 | Daily Capture — 캡처 타입 4종 + 슬래시 커맨드 | 중 |
| B10 | Daily Capture — Quick Capture 다이얼로그 | 중 |
| B11 | Daily Capture — 승격 워크플로우 (→ notes/) | 중 |
| B12 | Notes 폴더 관리 + 위키링크 연동 | 중 |
| B13 | 태그 시스템 + 태그 자동완성 | 중 |

### Phase E: 태그 시스템 (§56m)

| 순서 | 항목 | 예상 복잡도 |
|------|------|-----------|
| E1 | Rust Vault-wide 태그 인덱스 (get_vault_tags IPC) | 중 |
| E2 | 중첩 태그 지원 (#parent/child 문법) | 소 |
| E3 | 태그 클릭 → 글로벌 검색 (Cmd/Ctrl+Click) | 소 |
| E4 | Vault-wide 자동완성 (Rust 인덱스 기반) | 소 |
| E5 | 태그 사이드바 패널 (P1) | 중 |
| E6 | 태그 Atom 노드 (P1) | 고 |
| E7 | Frontmatter 태그 편집 UI (P1) | 중 |

### Phase C: 확장 기능 (§56f, §56g, §56h)

| 순서 | 항목 | 예상 복잡도 |
|------|------|-----------|
| C1 | Periodic Notes — 주간/월간/연간 노트 생성 | 중 |
| C2 | 자동 집계 코드블록 (journal-list, journal-mood, journal-photos) | 상 |
| C3 | Writing Streaks + 기여 히트맵 | 중 |
| C4 | .journal.json 통계 캐시 시스템 | 중 |
| C5 | 저널 테마 (6종 내장) | 중 |
| C6 | 테마 자동 전환 (진입/퇴장) | 소 |

### Phase D: 부가 기능 (§56i, §56j, §56k)

| 순서 | 항목 | 예상 복잡도 |
|------|------|-----------|
| D1 | Daily Prompts — 내장 프롬프트 + 카드 UI | 중 |
| D2 | 커스텀 프롬프트 (prompts/ 폴더) | 소 |
| D3 | AI 회고 — 후속 질문 제안 | 중 |
| D4 | AI 회고 — 주간/월간 패턴 분석 | 상 |
| D5 | 저널 검색 — frontmatter 필터 확장 | 중 |
| D6 | Graph View 저널 스코핑 | 중 |

### 구현 현황 (2026-03-01 기준)

| 섹션 | 상태 | 비고 |
|------|------|------|
| §56a 폴더 구조 | ✅ 완료 | 계층 경로, 마이그레이션 다이얼로그, 템플릿 폴더 |
| §56b 워크스페이스 모드 | ✅ 완료 | 스코핑, Graph View 필터, 프리셋 |
| §56c Memories View | ✅ 완료 | Journal/Notes/Photos 탭, 인라인 편집, OneLineEditor |
| §56d Photo Journal | ✅ 완료 | 사진 드래그&드롭→assets/, /photo 슬래시, 갤러리+라이트박스 |
| §56e 무드 트래커 | ✅ 완료 | MoodBar, 캘린더 도트, YearInPixels, MoodTrend30, 테마별 팔레트 |
| §56f Periodic Notes | ✅ 완료 | 주간/월간/연간 노트 생성, 캘린더 연동, 템플릿 |
| §56g Streaks & 통계 | ✅ 완료 | StatsPanel, streak 계산 (캡처 포함) |
| §56h 저널 테마 | ✅ 완료 | 5종 테마, CSS 변수 오버라이드, streak 아이콘 |
| §56i Daily Prompts | ✅ 완료 | 63개 한국어 프롬프트, DailyPrompt 컴포넌트, 템플릿 변수 |
| §56j AI 회고 | ✅ 완료 | ReflectionPanel, LLM 스트리밍, 노트 저장 |
| §56k 저널 검색 | ✅ 완료 | JournalSearchPanel, 카테고리 그룹핑, 태그 검색 |
| §56l Daily Capture | ✅ 완료 | 4종 캡처, Quick Capture, 승격, 태그 자동완성 |
| §56m 태그 시스템 | ✅ 완료 | P0+P1: Rust 인덱스, 중첩 태그, 클릭→검색, 자동완성, 사이드바, Atom 노드, Frontmatter 편집 |

**테스트**: vitest 1366/1366 pass (85 파일), cargo test 112/112 pass

---

## 17. 마이그레이션

### 17.1 기존 사용자 호환

| 시나리오 | 동작 |
|---------|------|
| flat 구조 사용 중 | "폴더 구조로 정리하시겠습니까?" 다이얼로그 → 승인 시 자동 이동, 거부 시 그대로 |
| 절대경로 저널 디렉토리 | 그대로 유지 (§56 기존 설정 호환) |
| 템플릿 사용 중 | `templates/` 폴더로 복사 권유 (강제 아님) |
| frontmatter에 mood 없음 | 무드 바가 미선택 상태로 표시 (기존 일기 깨지지 않음) |

### 17.2 설정 마이그레이션

기존 `journalDirectory` 설정을 그대로 사용. 신규 설정은 모두 기본값(OFF)으로 시작하여 기존 동작에 영향 없음.

---

*Journal Workspace 설계서 끝. 상위 참조: Part 5(§5.14), Part 4(§4.2), Part 8(§8.2)*
