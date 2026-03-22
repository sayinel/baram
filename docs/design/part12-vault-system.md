# Part 12. Vault 시스템 설계

> Phase 3 — 핵심 인프라
> 상태: M1 구현 완료 (2026-03-22)

---

## 12.1 개요

### 동기

Baram은 현재 **단일 폴더 모델**로 동작한다. `rootPath` 하나만 활성화되고, Journal은 임시 scoping workaround(`isJournalScoped`)로 처리된다. 이 구조의 한계:

| 한계 | 영향 |
|------|------|
| 하나의 폴더만 열 수 있음 | Skills vault + Journal을 동시에 참조 불가 |
| Journal이 vault 내부 폴더에 종속 | 독립적인 "하루 전반" 기록 공간 없음 |
| 설정이 모두 글로벌 | vault 성격에 따른 Extension/직렬화 규칙 분리 불가 |
| 독립 파일을 편집하면 vault 컨텍스트 상실 | `.md` 파일 더블클릭 시 기존 vault 연결 끊김 |

### 목표

Obsidian vault의 장점(자기완결적 지식 공간, 링크 그래프, vault-scoped 검색)을 유지하면서, **다중 컨텍스트 + 독립 파일** 동시 운용을 지원한다.

### 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **자기완결성** | vault는 `.baram/` 폴더를 가진 독립적 지식 공간. 이동·공유 시 깨지지 않는다 |
| **기본 격리** | 링크·검색·인덱스는 기본적으로 활성 컨텍스트 내로 격리 |
| **명시적 연결** | cross-vault 참조는 `[[alias::파일명]]` 구문으로만 허용 |
| **점진적 복잡도** | 단일 vault만 쓰면 현재와 완전히 동일한 경험. 기능이 강요되지 않는다 |
| **컨텍스트 = 일급 시민** | vault, 일반 폴더, 독립 파일이 모두 "컨텍스트"로 통합 관리 |

---

## 12.2 핵심 개념

### 컨텍스트(Context) 모델

Baram의 파일 관리 최상위 개념은 **컨텍스트(Context)**다. 모든 열린 소스는 아래 세 가지 타입 중 하나로 분류된다.

```
Context
├── VaultContext        .baram/ 폴더를 가진 지식 공간
│   ├── general         일반 vault
│   └── journal         글로벌 Journal vault (항상 존재, 최대 1개)
├── FolderContext       .baram/ 없는 일반 폴더
└── FileContext         독립 파일 (vault/폴더에 속하지 않음)
```

### 타입별 특성 비교

| 특성 | VaultContext | FolderContext | FileContext |
|------|:-----------:|:------------:|:-----------:|
| `.baram/config.json` | ✅ | — | — |
| 링크 그래프 (wikilink) | ✅ | — | — |
| 전문 검색 (tantivy) | ✅ | — | — |
| 파일 트리 | ✅ | ✅ | — |
| 탭에서 파일 열기 | ✅ | ✅ | ✅ |
| vault별 설정 오버라이드 | ✅ | — | — |
| Git 통합 | ✅ | ✅ (`.git` 존재 시) | — |
| 스냅샷 | ✅ | — | — |
| 컨텍스트 색상 | ✅ | ✅ | ✅ (회색) |
| alias 등록 | ✅ | — | — |

### VaultContext 내부 구조

```
my-vault/
├── .baram/                         ← vault 메타데이터 루트
│   ├── config.json                 ← vault 설정 (§12.6)
│   ├── snapshots/                  ← 파일 스냅샷
│   ├── link-index.db               ← SQLite 링크 인덱스
│   └── search-index/               ← tantivy 검색 인덱스
├── daily/                          ← Work Log (선택적, §12.5)
├── skills/                         ← Skills 폴더 (선택적)
└── *.md                            ← 마크다운 파일들
```

### Journal VaultContext

글로벌 Journal vault는 특수한 VaultContext다.

```
~/journal/                          ← vault_type: "journal"
├── .baram/
│   └── config.json                 ← { "vault": { "type": "journal" } }
├── entries/
│   ├── 2026-03-22.md
│   └── 2026-03-21.md
└── templates/
    └── daily.md
```

| 속성 | 일반 vault | Journal vault |
|------|-----------|---------------|
| 인스턴스 수 | 무제한 | 최대 1개 |
| 앱 시작 시 동작 | 마지막 상태 복원 | 오늘 파일 자동 생성/열기 |
| `vault_type` | `"general"` | `"journal"` |
| 컨텍스트 탭 위치 | 추가 순서 | 항상 두 번째 (첫 번째 vault 바로 뒤) |

---

## 12.3 앱 워크스페이스 (App Workspace)

앱 전체의 열린 컨텍스트 목록을 **앱 워크스페이스**라 부른다. 앱 시작 시 마지막 워크스페이스를 복원한다.

### 데이터 모델

```typescript
// --- Context 타입 ---

type ContextType = "vault" | "folder" | "file";
type VaultType = "general" | "journal";

interface ContextBase {
  id: string;                       // UUID
  type: ContextType;
  path: string;                     // 절대 경로 (파일 또는 폴더)
  label: string;                    // 표시 이름 (폴더명 또는 파일명)
  color: string;                    // 컨텍스트 색상 (hex)
  addedAt: number;                  // 추가 시각 (timestamp)
}

interface VaultContext extends ContextBase {
  type: "vault";
  alias: string;                    // cross-vault 링크용 alias
  vaultType: VaultType;
  config: VaultConfig;              // .baram/config.json 파싱 결과
}

interface FolderContext extends ContextBase {
  type: "folder";
}

interface FileContext extends ContextBase {
  type: "file";
}

type Context = VaultContext | FolderContext | FileContext;

// --- 앱 워크스페이스 ---

interface AppWorkspace {
  contexts: Context[];              // 열린 컨텍스트 목록 (순서 = 탭 순서)
  activeContextId: string | null;   // 현재 활성 컨텍스트 ID
  journalVaultPath: string | null;  // 글로벌 Journal vault 경로 (§12.5)
}
```

### 앱 워크스페이스 영속화

```jsonc
// ~/Library/Application Support/baram/app-workspace.json
{
  "contexts": [
    {
      "id": "ctx-1",
      "type": "vault",
      "vaultType": "general",
      "path": "/Users/동훈/work-vault",
      "alias": "work",
      "label": "work-vault",
      "color": "#3b82f6",
      "addedAt": 1711065600000
    },
    {
      "id": "ctx-2",
      "type": "vault",
      "vaultType": "journal",
      "path": "/Users/동훈/journal",
      "alias": "journal",
      "label": "journal",
      "color": "#10b981",
      "addedAt": 1711065600000
    },
    {
      "id": "ctx-3",
      "type": "folder",
      "path": "/Users/동훈/oss-contrib",
      "label": "oss-contrib",
      "color": "#f59e0b",
      "addedAt": 1711065700000
    }
  ],
  "activeContextId": "ctx-1",
  "journalVaultPath": "/Users/동훈/journal",
  "vaultAliases": {
    "work": "/Users/동훈/work-vault",
    "journal": "/Users/동훈/journal"
  }
}
```

### Vault Alias 레지스트리

cross-vault 링크 해석을 위해 `alias → path` 매핑을 글로벌로 관리한다.

```
등록 시점: vault 컨텍스트 추가 시 (alias 자동 = 폴더명, 수동 변경 가능)
저장 위치: app-workspace.json의 vaultAliases
충돌 해결: alias 중복 시 뒤에 숫자 추가 (work, work-2)
```

각 vault의 `.baram/config.json`에도 `crossVaultHints`로 마지막 알려진 경로를 저장하여, 다른 환경으로 이동 시 alias 자동 매칭을 시도한다.

```jsonc
// work-vault/.baram/config.json
{
  "crossVaultHints": {
    "journal": {
      "lastKnownPath": "/Users/동훈/journal"
    }
  }
}
```

---

## 12.4 UI 설계

### 12.4.1 컨텍스트 탭 바 (Context Tab Bar)

타이틀 바 아래, 에디터 탭 바 위에 위치하는 컨텍스트 전환 UI다.

```
┌──────────────────────────────────────────────────────────────┐
│ 🌀 Baram                                                     │
├──────────────────────────────────────────────────────────────┤
│  ● work-vault   ○ journal   ○ oss-contrib   ○ readme.md [+] │
│  ───────────                                                 │
│  현재 활성 컨텍스트                                             │
├──────────────────────────────────────────────────────────────┤
│ 사이드바 │  에디터 영역                                         │
│          │                                                    │
│ ▼ work-  │  [● project-a.md] [● 2026-03-22.md] [● README.md]│
│   vault  │   work (파란)       journal (초록)     oss (주황)   │
│  ├ proj  │                                                    │
│  └ skill │  (에디터 본문)                                      │
│          │                                                    │
└──────────┴────────────────────────────────────────────────────┘
```

#### 핵심 규칙

```
사이드바 파일트리 = 활성 컨텍스트 하나만 표시
에디터 탭         = 모든 컨텍스트 파일 공존 가능
링크/검색 scope   = 활성 컨텍스트 기준 (명시적 전환 가능)
```

#### 컨텍스트 탭 인터랙션

| 동작 | 결과 |
|------|------|
| 클릭 | 활성 컨텍스트 전환 → 파일트리 교체 (에디터 탭 유지) |
| 더블클릭 | 이름 변경 (label) |
| 우클릭 | 컨텍스트 메뉴 (§12.4.2) |
| 드래그 | 탭 순서 변경 |
| `[+]` 클릭 | 새 컨텍스트 추가 (폴더 선택 / 파일 선택 / 새 vault 생성) |
| 가운데 클릭 | 컨텍스트 닫기 |

#### 12.4.2 컨텍스트 메뉴

```
컨텍스트 탭 우클릭:
  ├── vault로 초기화               ← FolderContext에서만 (.baram/ 생성)
  ├── 새 창으로 분리               ← Phase 4 (multi-window)
  ├── 이름 변경
  ├── 색상 변경
  ├── alias 변경                  ← VaultContext에서만
  ├── ──────────
  ├── 이 컨텍스트만 남기기
  ├── 다른 컨텍스트 모두 닫기
  ├── ──────────
  ├── vault 설정 열기              ← VaultContext에서만
  └── 닫기
```

### 12.4.3 에디터 탭의 컨텍스트 표시

각 에디터 탭에 컨텍스트 색상 dot을 표시하여 출처를 구분한다.

```
[● project-a.md]  [● 2026-03-22.md]  [● README.md]  [○ scratch.md]
 파란 dot           초록 dot           주황 dot        회색 dot
 = work-vault       = journal          = oss-contrib   = loose file
```

- dot 색상: 컨텍스트의 `color` 필드
- FileContext (독립 파일): 회색 dot, 호버 시 전체 경로 표시
- dot 클릭: 해당 컨텍스트로 활성 전환 (사이드바 자동 교체)

### 12.4.4 사이드바 파일트리

활성 컨텍스트의 파일트리만 표시한다. 컨텍스트 전환 시 파일트리가 교체된다.

```
활성 컨텍스트: work-vault
┌─────────────────────────────┐
│ work-vault  ⓘ              │ ← 컨텍스트 이름 + vault 아이콘
│ ▼ 📁 project-a/            │
│   ├── design.md             │
│   └── notes.md              │
│ ▼ 📁 skills/               │
│   ├── analyzer.md           │
│   └── writer.md             │
│   scratch.md                │
└─────────────────────────────┘

활성 컨텍스트: journal
┌─────────────────────────────┐
│ journal  📔                 │ ← journal 아이콘
│ ▼ 📁 entries/               │
│   ├── 2026-03-22.md         │
│   └── 2026-03-21.md         │
│ ▼ 📁 templates/             │
│   └── daily.md              │
└─────────────────────────────┘

활성 컨텍스트: FileContext (독립 파일)
┌─────────────────────────────┐
│ 📄 readme.md                │
│                             │
│ (파일트리 없음 — 단일 파일)    │
│                             │
│ 경로: /Users/.../readme.md  │
└─────────────────────────────┘
```

FileContext 활성 시 사이드바는 파일 경로와 기본 메타정보만 표시한다.

### 12.4.5 검색 Scope UI

전문 검색(Cmd+Shift+F), Quick Switcher(Cmd+K) 모두 scope 선택을 지원한다.

```
┌─ 전문 검색 (Cmd+Shift+F) ─────────────────┐
│ 🔍 검색어...                                │
│                                            │
│ Scope: ● 현재 vault (work)                  │ ← 기본값
│        ○ 열린 vault 전체                     │
│        ○ 열린 모든 컨텍스트                   │
│                                            │
│ 결과:                                       │
│   work::project-a/design.md (L12)          │
│   work::skills/analyzer.md (L45)           │
└────────────────────────────────────────────┘
```

Quick Switcher에도 컨텍스트 구분:

```
Cmd+K:
  ┌──────────────────────────────────────┐
  │ 🔍 파일 검색...                        │
  │                                      │
  │ design.md              work-vault    │
  │ 2026-03-22.md          journal       │
  │ README.md              oss-contrib   │
  │ scratch.md             (loose)       │
  └──────────────────────────────────────┘
```

### 12.4.6 설정 패널의 Vault 탭

Preferences(Cmd+,)에 Vault 설정 탭을 추가한다. 현재 활성 VaultContext가 있을 때만 활성화.

```
Preferences (Cmd+,)
┌──────────┬──────────────────────────────────────────┐
│ General  │  Vault Settings: work-vault               │
│ Editor   │                                          │
│ Markdown │  ┌─ Extensions ──────────────────────┐   │
│ AI       │  │  ✅ Wikilink                       │   │
│ Appear.  │  │  ✅ Skills                         │   │
│ Exten.   │  │  ☐ Journal (글로벌 설정: ON)        │   │
│ Git      │  │     ↳ vault에서 비활성화됨           │   │
│ ──────── │  └────────────────────────────────────┘   │
│ 📦 Vault │                                          │
│          │  ┌─ Markdown ────────────────────────┐   │
│          │  │  bulletListMarker: -               │   │
│          │  │  enableWikilink: true              │   │
│          │  └────────────────────────────────────┘   │
│          │                                          │
│          │  ┌─ AI ──────────────────────────────┐   │
│          │  │  model: claude-haiku-4-5           │   │
│          │  │  privacyMode: ☐                    │   │
│          │  └────────────────────────────────────┘   │
│          │                                          │
│          │  ℹ️ .baram/config.json에 저장됩니다        │
└──────────┴──────────────────────────────────────────┘
```

---

## 12.5 Journal 시스템 재설계

### 개념 분리: Journal vs Work Log

현재의 단일 "Journal" 개념을 두 가지로 분리한다.

```
니즈 1: 하루 전반의 기록          → "Journal" (글로벌 vault)
니즈 2: 프로젝트별 작업 일지       → "Work Log" (vault 내부, 선택적)
```

### 글로벌 Journal vault

| 속성 | 설명 |
|------|------|
| 위치 | 사용자 지정 (기본: `~/journal`) |
| `vault_type` | `"journal"` |
| 인스턴스 수 | 앱 전체에 최대 1개 |
| 앱 시작 시 | 오늘 파일 자동 생성 + 열기 |
| 컨텍스트 탭 위치 | 항상 두 번째 (첫 번째 vault 바로 뒤) |
| cross-vault 참조 | `[[journal::2026-03-22]]` |

```markdown
<!-- journal/entries/2026-03-22.md -->
---
date: 2026-03-22
tags: [journal]
---

# 2026-03-22

오늘 Baram의 vault 시스템 설계서를 작성했다.
→ [[work::vault-system-design]]     ← cross-vault 링크
```

### vault별 Work Log (선택적)

```jsonc
// work-vault/.baram/config.json
{
  "workLog": {
    "enabled": true,                  // 기본 false
    "folder": "daily/",
    "fileNameFormat": "YYYY-MM-DD",
    "template": "templates/work-log.md"
  }
}
```

Work Log는 앱 시작 시 자동 생성하지 않는다. 커맨드 팔레트 → "New Work Log for Today"로 명시적 생성.

| 속성 | 글로벌 Journal | vault별 Work Log |
|------|--------------|-----------------|
| 성격 | 하루 전반, 개인적 | 프로젝트 작업 이력 |
| 자동 생성 | 항상 (앱 시작 시) | vault 설정에서 활성화 시만 |
| 앱 시작 시 동작 | journal vault 파일 오픈 | 별도 동작 없음 |
| cross-vault 링크 | 가끔 | 거의 없음 (vault 내부 링크) |
| Git 추적 | 개인 repo | 프로젝트 repo에 포함 가능 |

---

## 12.6 설정 계층 (3-Tier)

### 계층 구조

```
글로벌 설정 (~/Library/Application Support/baram/settings.json)
     │
     └──→ vault 설정 (.baram/config.json) 으로 오버라이드
               │
               └──→ 파일별 YAML frontmatter로 오버라이드 (일부 항목)
```

### 설정 분류

#### 🔒 글로벌 전용 (vault 오버라이드 불가)

"사람/디바이스에 귀속"되는 설정. vault마다 달라지면 혼란을 야기한다.

```
appearance.theme              테마 (기본값, vault에서 opt-in 오버라이드는 예외 허용)
appearance.fontSize           폰트 크기
appearance.fontFamily         폰트 패밀리
appearance.lineHeight         줄 높이

ai.provider                   AI 제공자
ai.apiKey                     API 키

keybindings                   키보드 단축키
spellCheck                    맞춤법 검사
zoomLevel                     확대/축소
```

#### ⚙️ vault별 오버라이드 가능

"vault의 성격/목적에 귀속"되는 설정.

**Extension on/off**

```jsonc
// work-vault/.baram/config.json
{
  "extensions": {
    "enabled": ["ext-wikilink", "ext-skills", "ext-block-ref"],
    "disabled": ["ext-journal"]
  }
}
```

**Markdown 직렬화 규칙**

```jsonc
{
  "markdown": {
    "serializationRules": {
      "bulletListMarker": "-"
    },
    "enableWikilink": true,
    "enableMermaid": false
  }
}
```

**AI 모델 (provider 제외)**

```jsonc
{
  "ai": {
    "model": "claude-haiku-4-5",
    "privacyMode": true,
    "contextScope": "vault"
  }
}
```

**Git 설정**

```jsonc
{
  "git": {
    "autoFetchInterval": 5,
    "autoPushOnCommit": true
  }
}
```

**파일/폴더 구조**

```jsonc
{
  "editor": {
    "dailyNotesFolder": "entries",
    "skillsFolder": "prompts",
    "defaultNewFileLocation": "root"
  }
}
```

**Appearance (opt-in 예외)**

테마/폰트는 글로벌이 원칙이지만, vault별 opt-in 오버라이드를 허용한다. 컨텍스트 전환 시 시각적 신호 역할.

```jsonc
// journal-vault/.baram/config.json
{
  "appearance": {
    "theme": "sepia"       // journal vault는 항상 sepia
  }
}
```

### 전체 분류표

| 설정 항목 | 글로벌만 | vault 오버라이드 | 파일 오버라이드 |
|-----------|:------:|:--------------:|:------------:|
| 테마/폰트 | 기본값 | opt-in 허용 | — |
| 에디터 줄높이/폭 | ✅ | — | — |
| 단축키 | ✅ | — | — |
| AI provider/API 키 | ✅ | — | — |
| AI 모델 선택 | 기본값 | ✅ | — |
| AI privacy mode | 기본값 | ✅ | ✅ |
| Extension on/off | 기본값 | ✅ | — |
| Markdown 직렬화 규칙 | 기본값 | ✅ | — |
| dailyNotesFolder 경로 | 기본값 | ✅ | — |
| skillsFolder 경로 | 기본값 | ✅ | — |
| Git 설정 | 기본값 | ✅ | — |
| spellCheck | ✅ | — | — |
| Snapshot 주기/개수 | 기본값 | ✅ | — |

### VaultConfig 스키마

```typescript
/** .baram/config.json — 값이 있는 필드만 기록 (글로벌과 merge) */
interface VaultConfig {
  vault: {
    type: VaultType;                      // "general" | "journal"
    alias: string;                        // cross-vault 링크용
  };

  appearance?: {
    theme?: string;                       // opt-in 테마 오버라이드
  };

  extensions?: {
    enabled?: string[];
    disabled?: string[];
  };

  markdown?: {
    serializationRules?: Partial<SerializationRules>;
    enableWikilink?: boolean;
    enableMermaid?: boolean;
    // ... 기타 Layer 3 확장 토글
  };

  ai?: {
    model?: string;
    privacyMode?: boolean;
    contextScope?: "vault" | "all";
  };

  git?: {
    autoFetchInterval?: number;
    autoPushOnCommit?: boolean;
  };

  editor?: {
    dailyNotesFolder?: string;
    skillsFolder?: string;
    defaultNewFileLocation?: "root" | "current";
  };

  workLog?: {
    enabled?: boolean;
    folder?: string;
    fileNameFormat?: string;
    template?: string;
  };

  snapshot?: {
    intervalMinutes?: number;
    maxCount?: number;
  };

  crossVaultHints?: Record<string, { lastKnownPath: string }>;
}
```

### 설정 Resolve 로직

```rust
fn resolve_settings(
    global: &GlobalSettings,
    vault_config: Option<&VaultConfig>,
    file_frontmatter: Option<&Frontmatter>,
) -> ResolvedSettings {
    let mut s = global.clone();
    if let Some(vc) = vault_config {
        s.merge_vault_config(vc);     // vault 오버라이드
    }
    if let Some(fm) = file_frontmatter {
        s.merge_frontmatter(fm);      // 파일 오버라이드
    }
    s
}
```

Rust 백엔드에서 `#[serde(skip_serializing_if = "Option::is_none")]` 패턴으로 vault config는 오버라이드할 필드만 기록한다.

---

## 12.7 Cross-vault 링크

### 기본 원칙: 기본 격리, 명시적 절대경로 링크만 허용

```
vault 내부 (기존과 동일):
  [[analyzer]]              → 현재 vault 내에서만 해석

cross-vault (명시적):
  [[work::analyzer]]        → work alias vault의 analyzer.md
  [[work::skills/analyzer]] → 경로 지정
  [[journal::2026-03-22]]   → journal vault의 특정 파일
```

### 링크 해석 우선순위

```
[[파일명]] 해석:
  1순위: 현재 vault 내 exact match
  2순위: 현재 vault 내 fuzzy match
  3순위: ❌ 다른 vault 검색 안 함 (격리 기본값)

[[alias::파일명]] 해석:
  1순위: alias vault에서 exact match
  2순위: alias vault에서 fuzzy match
  미열림: → dangling 표시 + "열기" 제안
```

### 자동완성 UX

```
[[ 입력 후:
  ┌────────────────────────────────────┐
  │  📁 현재 vault (work)               │
  │     analyzer.md                    │
  │     parser.md                      │
  │  ─────────────────────────────     │
  │  💡 cross-vault: "journal::" 입력  │
  └────────────────────────────────────┘

[[journal:: 입력 후:
  ┌────────────────────────────────────┐
  │  📔 journal vault                  │
  │     2026-03-22.md                  │
  │     2026-03-21.md                  │
  └────────────────────────────────────┘
```

### Dangling 링크 처리

```
[[journal::2026-03-22]]  (journal vault 미열림)

  렌더링:  🔗 journal::2026-03-22  (회색)
  호버:    "journal vault가 열려 있지 않습니다."  [열기]
  저장:    [[journal::2026-03-22]] 그대로 보존 (roundtrip fidelity 유지)
```

### 이식성 보장

vault를 다른 환경으로 이동 시 `.baram/config.json`의 `crossVaultHints`로 alias 자동 매칭 시도. 실패 시 사용자에게 경로 재지정 안내.

### SQLite 스키마 변경

```sql
ALTER TABLE links ADD COLUMN target_vault_alias TEXT DEFAULT NULL;
-- NULL:       현재 vault 내 링크 (기존 동작 유지)
-- 'journal':  cross-vault 링크
```

### Graph View 확장

#### Scope 선택 UI

```
  ● 현재 vault (work)     ← 기본값, 기존과 동일
  ○ 열린 vault 전체
  ○ 로컬 (현재 파일 n-depth)
```

#### Multi-vault 그래프 구성

각 vault의 `link-index.db`를 개별 조회 후 단순 merge. DB federation 아님.

```rust
fn build_multi_vault_graph(contexts: &[VaultContext]) -> GraphData {
    let mut nodes = vec![];
    let mut edges = vec![];

    for ctx in contexts {
        // vault prefix로 노드 ID 충돌 방지
        nodes.extend(ctx.link_index.query_all_files()
                        .map(|n| n.with_vault_prefix(&ctx.alias)));
        edges.extend(ctx.link_index.query_all_links()
                        .map(|e| e.with_vault_prefix(&ctx.alias)));

        // cross-vault 링크 추가
        edges.extend(ctx.link_index.query_cross_vault_links());
    }

    GraphData { nodes, edges }
}
```

#### 시각적 구분

```
  🔵 work vault 노드       🟢 journal vault 노드
     ◉ parser.md                ◉ 2026-03-22
     |                              |
     ◉ analyzer.md ╌╌╌╌╌╌╌╌╌╌╌ ◉ 2026-03-21
     |
     ◉ skill-x.md

  ── 실선: 같은 vault 내 링크
  ╌╌ 점선: cross-vault 링크 ([[alias::파일명]])
```

### Knowledge Q&A에서의 Cross-vault 동작

Chat Panel의 `@` 참조로 검색 대상 vault를 명시적으로 지정한다.

```
기존 @ 참조 (현재 vault 내):
  @파일명      → 현재 vault의 특정 파일
  @folder      → 현재 vault의 특정 폴더

추가 (cross-vault):
  @work        → work vault 전체를 컨텍스트로
  @journal     → journal vault 전체를 컨텍스트로
  @all-vaults  → 열린 모든 vault

예시:
  "@work의 parser 스킬과 @journal의 오늘 메모의 연관성은?"
  → work vault + journal vault 동시 검색
```

---

## 12.8 Rust 백엔드 아키텍처

### ContextManager (Tauri Managed State)

현재의 단일 `VaultRootState`를 `ContextManager`로 대체한다.

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::RwLock;

/// 컨텍스트 타입
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContextType {
    Vault { vault_type: VaultType, alias: String },
    Folder,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VaultType {
    General,
    Journal,
}

/// 개별 컨텍스트의 런타임 상태
#[derive(Debug)]
pub struct ContextState {
    pub id: String,
    pub context_type: ContextType,
    pub path: PathBuf,
    pub config: Option<VaultConfig>,         // VaultContext만
    pub link_index: Option<LinkIndex>,       // VaultContext만
    pub search_index: Option<SearchIndex>,   // VaultContext만
    pub file_watcher: Option<WatcherHandle>, // Vault/Folder만
}

/// 앱 전체 컨텍스트 관리자
pub struct ContextManager {
    contexts: RwLock<HashMap<String, ContextState>>,
    active_context_id: RwLock<Option<String>>,
    vault_aliases: RwLock<HashMap<String, String>>,  // alias → context_id
}

impl ContextManager {
    /// 컨텍스트 추가
    pub async fn add_context(&self, ctx: ContextState) -> Result<(), String> {
        // 1. path 유효성 검증 (symlink 보호)
        // 2. VaultContext: .baram/config.json 로드, 인덱스 초기화
        // 3. Vault/Folder: 파일 워처 시작
        // 4. alias 등록 (VaultContext만)
        todo!()
    }

    /// 컨텍스트 제거
    pub async fn remove_context(&self, id: &str) -> Result<(), String> {
        // 1. 파일 워처 정지
        // 2. 인덱스 정리 (메모리 해제)
        // 3. alias 해제
        todo!()
    }

    /// 활성 컨텍스트 전환
    pub async fn set_active(&self, id: &str) -> Result<(), String> {
        todo!()
    }

    /// 경로 검증: 대상 경로가 특정 컨텍스트 내에 있는지 확인
    pub async fn validate_path(
        &self,
        path: &Path,
        context_id: &str,
    ) -> Result<PathBuf, String> {
        // canonicalize + symlink 보호 (기존 VaultRootState 로직)
        todo!()
    }

    /// cross-vault alias 해석
    pub async fn resolve_alias(&self, alias: &str) -> Option<String> {
        self.vault_aliases.read().await.get(alias).cloned()
    }

    /// 설정 resolve (글로벌 + vault + frontmatter merge)
    pub async fn resolve_settings(
        &self,
        context_id: &str,
        frontmatter: Option<&Frontmatter>,
    ) -> ResolvedSettings {
        todo!()
    }
}
```

### IPC 커맨드 변경

#### 새로운 커맨드

| Command | 입력 | 출력 | 용도 |
|---------|------|------|------|
| `add_context` | `{ type, path, alias? }` | `Context` | 컨텍스트 추가 |
| `remove_context` | `{ contextId }` | `bool` | 컨텍스트 제거 |
| `set_active_context` | `{ contextId }` | `bool` | 활성 컨텍스트 전환 |
| `get_contexts` | — | `Vec<Context>` | 열린 컨텍스트 목록 |
| `get_vault_config` | `{ contextId }` | `VaultConfig` | vault 설정 조회 |
| `set_vault_config` | `{ contextId, config }` | `bool` | vault 설정 저장 |
| `resolve_settings` | `{ contextId, filePath? }` | `ResolvedSettings` | 설정 resolve |
| `init_vault` | `{ path }` | `VaultConfig` | 폴더를 vault로 초기화 |
| `resolve_cross_vault_link` | `{ alias, target }` | `Option<String>` | cross-vault 링크 해석 |

#### 기존 커맨드 변경

기존 IPC 커맨드에 `contextId` 파라미터를 추가한다. 기존 `setVaultRoot`는 deprecated.

| 기존 Command | 변경사항 |
|-------------|---------|
| `read_file` | `+ contextId` — 경로 검증 대상 컨텍스트 |
| `write_file` | `+ contextId` |
| `list_dir` | `+ contextId` |
| `search_files` | `+ contextId` (scope 지정) |
| `get_backlinks` | `+ contextId` |
| `refresh_index` | `+ contextId` |
| `git_status` | `+ contextId` |
| `watch_dir` | `+ contextId` |
| `setVaultRoot` | **deprecated** → `add_context` + `set_active_context` |

#### 새로운 이벤트

| Event | Payload | 용도 |
|-------|---------|------|
| `context-added` | `{ context: Context }` | 컨텍스트 추가됨 |
| `context-removed` | `{ contextId: string }` | 컨텍스트 제거됨 |
| `context-changed` | `{ contextId: string }` | 활성 컨텍스트 변경 |
| `vault-config-changed` | `{ contextId, config }` | vault 설정 변경 |

---

## 12.9 프론트엔드 스토어 아키텍처

### 새로운 contextStore

기존 `fileStore`의 `rootPath` 관리를 `contextStore`로 분리한다.

```typescript
// src/stores/context/context.ts

interface ContextStore {
  // --- 상태 ---
  contexts: Context[];
  activeContextId: string | null;

  // --- 파생 ---
  activeContext: () => Context | null;
  activeVaultConfig: () => VaultConfig | null;
  vaultContexts: () => VaultContext[];
  journalContext: () => VaultContext | null;

  // --- 액션 ---
  addContext: (type: ContextType, path: string, opts?: {
    alias?: string;
    color?: string;
  }) => Promise<void>;
  removeContext: (id: string) => Promise<void>;
  setActiveContext: (id: string) => Promise<void>;
  reorderContexts: (ids: string[]) => void;
  updateContextLabel: (id: string, label: string) => void;
  updateContextColor: (id: string, color: string) => void;
  updateVaultAlias: (id: string, alias: string) => void;

  // --- 워크스페이스 영속화 ---
  saveWorkspace: () => Promise<void>;
  restoreWorkspace: () => Promise<void>;
}
```

### fileStore 변경

```typescript
// 변경 전 (현재)
interface FileState {
  rootPath: string;
  originalRootPath: string | null;
  isJournalScoped: boolean;
  fileTree: FileTreeNode | null;
  // ...
}

// 변경 후
interface FileState {
  // rootPath → contextStore로 이관
  // isJournalScoped → 제거 (Journal은 별도 VaultContext)
  // originalRootPath → 제거

  fileTrees: Map<string, FileTreeNode>;   // contextId → 파일트리
  activeFileTree: () => FileTreeNode | null;  // 활성 컨텍스트의 트리

  expandedDirs: Map<string, Set<string>>; // contextId → 확장된 디렉토리
  openFiles: Map<string, string>;         // filePath → content
  // ...
}
```

### editorStore 변경

```typescript
// EditorTab에 contextId 추가
interface EditorTab {
  id: string;
  filePath: string;
  contextId: string;       // ← 새로 추가: 이 탭이 속한 컨텍스트
  isDirty: boolean;
  isPinned: boolean;
  // ...
}
```

### settingsStore 변경

```typescript
// 설정 resolve를 위한 헬퍼 추가
interface SettingsState {
  // ... 기존 글로벌 설정 ...

  // 현재 활성 vault의 resolved 설정 캐시
  resolvedSettings: ResolvedSettings | null;
  refreshResolvedSettings: () => Promise<void>;
}
```

### workspaceStore 변경

```typescript
// 기존 WorkspacePreset에 컨텍스트 정보 추가
interface WorkspacePreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  layout: WorkspaceLayout;
  contextConfigs?: {                // ← 새로 추가
    activeContextId?: string;       // 이 프리셋이 활성화할 컨텍스트
  };
}
```

---

## 12.10 독립 파일 열기 (FileContext)

### 시나리오

1. **OS에서 파일 더블클릭** (Baram이 `.md` 기본 앱일 때)
2. **Cmd+O로 파일 열기** (vault 밖의 파일 선택)
3. **터미널에서 `baram file.md`** 실행

### 동작 규칙

```
파일 경로 → 열린 컨텍스트 중 해당 파일을 포함하는 vault/폴더가 있는가?
  ├── YES → 해당 컨텍스트에서 탭으로 열기 (새 컨텍스트 추가 안 함)
  └── NO  → FileContext 생성 → 컨텍스트 탭에 추가 → 에디터 탭에 열기
```

### FileContext 특성

- 파일트리 없음 (사이드바에 단일 파일 정보만 표시)
- 링크 그래프 없음 (wikilink는 텍스트로만 표시)
- 검색 없음
- vault 설정 없음 (글로벌 설정만 적용)
- 파일 닫으면 FileContext도 자동 제거
- 컨텍스트 색상: 회색 (기본)

---

## 12.11 앱 시작 흐름

### 시작 시 워크스페이스 복원

```
앱 시작
  │
  ├── app-workspace.json 로드
  │     ├── 각 컨텍스트 path 유효성 검증
  │     ├── 유효한 컨텍스트 → ContextManager에 등록
  │     └── 유효하지 않은 경로 → 경고 표시, 목록에서 제거
  │
  ├── 글로벌 설정 로드
  │
  ├── Journal vault 처리
  │     ├── journalVaultPath 존재 → Journal context 복원
  │     ├── 오늘 파일 자동 생성 (없으면)
  │     └── 오늘 파일 에디터 탭에 열기
  │
  ├── 마지막 활성 컨텍스트 복원
  │     └── activeContextId → 사이드바 파일트리 로드
  │
  └── 마지막 열린 탭 복원
        └── 각 탭의 contextId 기준으로 파일 로드
```

### 첫 실행 (워크스페이스 없음)

```
앱 첫 실행
  │
  ├── 환영 화면 표시
  │     ├── "폴더 열기" → FolderContext 또는 VaultContext 추가
  │     ├── "새 vault 만들기" → 폴더 선택 → .baram/ 생성
  │     └── "파일 열기" → FileContext 추가
  │
  └── Journal vault 설정
        ├── "Journal 사용하기" → 경로 선택 → journal vault 생성
        └── "나중에" → journalVaultPath = null
```

---

## 12.12 마이그레이션 전략

### 기존 사용자 마이그레이션

현재 단일 vault로 쓰고 있는 사용자가 새 버전으로 업데이트할 때의 자동 마이그레이션.

```
업데이트 감지 (app-workspace.json 없음)
  │
  ├── lastOpenedFolder 존재?
  │     ├── YES → 해당 폴더를 VaultContext로 자동 등록
  │     │         (.baram/ 없으면 FolderContext로)
  │     └── NO  → 빈 워크스페이스 시작
  │
  ├── Journal 설정 존재? (journalEnabled + journalDirectory)
  │     ├── YES → resolvedDir를 Journal VaultContext로 분리 제안
  │     │         (사용자 확인 후 실행 — 강제 아님)
  │     └── NO  → 패스
  │
  └── app-workspace.json 생성
```

### 데이터 호환성

| 항목 | 호환성 | 비고 |
|------|--------|------|
| `.md` 파일 | 100% | 변경 없음 |
| `.baram/snapshots/` | 100% | 기존 경로 유지 |
| `link-index.db` | 호환 | `target_vault_alias` 컬럼 추가 (마이그레이션) |
| localStorage bookmarks | 호환 | `rootPath` 키 → `contextId` 키 마이그레이션 |
| Zustand persist stores | 호환 | 버전 마이그레이션으로 처리 |

---

## 12.13 구현 로드맵

### M1: 단일 vault 기반 Context 인프라

> 목표: 현재 동작을 Context 모델 위에 재구축. 사용자 체감 변화 없음.

```
Backend:
  ✦ ContextManager 구조체 구현
  ✦ add_context / remove_context / set_active_context IPC
  ✦ 기존 IPC에 contextId 파라미터 추가 (하위 호환: 생략 시 active context)
  ✦ VaultConfig 로드/저장 (.baram/config.json)
  ✦ setVaultRoot deprecated (add_context로 내부 리다이렉트)

Frontend:
  ✦ contextStore 신규 생성
  ✦ fileStore에서 rootPath/isJournalScoped 로직 제거
  ✦ editorStore의 EditorTab에 contextId 추가
  ✦ app-workspace.json 영속화
  ✦ 기존 사용자 마이그레이션 (lastOpenedFolder → context)

UI:
  ✦ 컨텍스트 탭 바 기본 구현 (단일 컨텍스트만)
  ✦ 에디터 탭에 컨텍스트 색상 dot

테스트:
  ✦ 기존 전체 테스트 통과 확인 (regression 없음)
```

### M2: Multi-Context + Journal vault

> 목표: 여러 컨텍스트 동시 운용, Journal vault 독립화

```
Backend:
  ✦ 복수 컨텍스트 동시 관리 (ContextManager 확장)
  ✦ 컨텍스트별 파일 워처 분리
  ✦ 컨텍스트별 링크 인덱스 독립 관리
  ✦ init_vault IPC (폴더 → vault 초기화)
  ✦ 설정 resolve (글로벌 + vault merge)

Frontend:
  ✦ 컨텍스트 탭 바 완전 구현 (추가/제거/순서/색상)
  ✦ 사이드바 파일트리 컨텍스트 전환
  ✦ 에디터 탭 cross-context 파일 열기
  ✦ Quick Switcher에 컨텍스트 구분 표시
  ✦ 전문 검색 scope 선택 (현재 vault / 전체)

Journal:
  ✦ 글로벌 Journal vault 생성/관리
  ✦ 앱 시작 시 오늘 파일 자동 생성
  ✦ Journal 컨텍스트 탭 고정 위치
  ✦ 기존 journal scoping → Journal vault 마이그레이션

UI:
  ✦ "+" 버튼: 폴더/파일/vault 추가 메뉴
  ✦ 컨텍스트 탭 우클릭 메뉴
  ✦ FileContext (독립 파일 열기)
  ✦ 설정 패널 Vault 탭
```

### M3: Cross-vault 링크 + vault별 설정

> 목표: vault 간 명시적 연결, 설정 세분화

```
Backend:
  ✦ cross-vault 링크 파서 ([[alias::파일명]])
  ✦ SQLite 스키마 변경 (target_vault_alias)
  ✦ resolve_cross_vault_link IPC
  ✦ Vault alias 레지스트리 관리

Frontend:
  ✦ wikilink 자동완성에 cross-vault 지원
  ✦ cross-vault dangling 링크 표시
  ✦ Graph View scope 선택 (현재 vault / 전체)
  ✦ Graph View multi-vault 렌더링 (색상 + 점선)
  ✦ vault별 Extension on/off 설정 UI
  ✦ vault별 Markdown 직렬화 규칙 설정 UI
  ✦ vault별 AI 모델/privacy 설정 UI

Work Log:
  ✦ vault별 Work Log 활성화/비활성화
  ✦ "New Work Log for Today" 커맨드

Knowledge Q&A:
  ✦ @vault 참조로 multi-vault 검색
  ✦ Citation에 vault 출처 표시
```

### 향후 확장 (Phase 4+)

```
  · 새 창으로 분리 (Tauri multi-window)
  · vault 템플릿 (프로젝트 유형별 초기 구조)
  · vault 동기화 (Git 자동 동기화)
  · vault 간 파일 이동/복사 (drag & drop)
  · 공유 vault (실시간 협업)
```

---

## 12.14 페르소나별 검증

| 페르소나 | 주요 시나리오 | 해결 |
|---------|-------------|------|
| **Persona 1** (LLM 개발자) | skills-vault + journal 동시 참조하며 개발일지 작성 | ✅ 두 파일을 탭에 나란히 열 수 있음 |
| **Persona 2** (MD 파워유저) | work vault 하나만 집중해서 사용 | ✅ 컨텍스트 탭 하나만 두면 현재와 동일 |
| **Persona 3** (연구자) | 논문 vault + 메모 폴더 병행 | ✅ 폴더를 두 번째 컨텍스트로 추가 |
| **Quick Edit** | 독립 `.md` 파일 빠르게 열어서 편집 | ✅ FileContext로 즉시 열림 |
| **팀 프로젝트** | vault별 마크다운 컨벤션 분리 | ✅ `.baram/config.json` 직렬화 규칙 |

---

## 12.15 성능 고려사항

### 메모리

| 항목 | 단일 vault (현재) | multi-context (3개 vault) |
|------|:-----------------:|:-------------------------:|
| Rust ContextManager | ~1MB | ~3MB |
| 링크 인덱스 (SQLite) | ~2MB | ~6MB |
| 검색 인덱스 (tantivy) | ~5MB | ~15MB |
| 파일 워처 | 1개 | 3개 |
| **합계 추가** | — | **~20MB** |

유휴 메모리 목표(< 100MB) 내에서 3~5개 vault를 동시에 운용할 수 있다.

### 시작 시간

컨텍스트 초기화를 병렬로 수행하여 시작 시간 영향 최소화.

```rust
// 모든 컨텍스트 병렬 초기화
let futures: Vec<_> = workspace.contexts.iter()
    .map(|ctx| context_manager.add_context(ctx.clone()))
    .collect();
futures::future::join_all(futures).await;
```

목표: 3개 vault 동시 초기화 < 2초 (콜드).

---

## 12.16 §번호 매핑

본 설계서의 하위 섹션을 기존 §체계에 매핑한다.

| § 번호 | 제목 | 설계서 섹션 |
|--------|------|-----------|
| §80 | Context 모델 | 12.2 |
| §81 | 앱 워크스페이스 | 12.3 |
| §82 | 컨텍스트 탭 바 UI | 12.4.1~12.4.2 |
| §83 | 에디터 탭 컨텍스트 표시 | 12.4.3 |
| §84 | 검색 Scope | 12.4.5 |
| §85 | Journal 시스템 재설계 | 12.5 |
| §86 | 설정 3-Tier 계층 | 12.6 |
| §87 | Cross-vault 링크 | 12.7 |
| §88 | ContextManager (Rust) | 12.8 |
| §89 | 독립 파일 열기 | 12.10 |
| §90 | 앱 시작 흐름 | 12.11 |
