# Part 13. Zettelkasten 스페이스 설계 (§91–§99)

> 상태: **설계 (P2)** · 작성 2026-07-06 · 브랜치 `feature/zettelkasten-space`
> 선행: Part 12 Vault 시스템(§80–§90), Journal 슬림화(P1, PR #164 merged)
> 후속: P3 외부 플러그인 스페이스 API (deferred, YAGNI)

## 13.1 개요 (§91)

### 동기

Journal(P1)에서 떼어낸 Note/Capture를, 독립적인 **Zettelkasten 스페이스**로
재구성한다. 동시에 지금 코드베이스에 `vaultType === "journal"` 하드코딩이
여러 곳에 흩어져 있는 상태를 정리하여, **데이터 주도 스페이스 레지스트리**로
승격한다.

전략은 "**코어 먼저, API는 나중**"이다. Journal(사례 1)과 Zettelkasten(사례 2)
두 개의 구체 스페이스를 내부 레지스트리 위에 올려 추상화를 실증한 뒤(rule-of-three),
외부 플러그인 API(P3)는 그 다음에 추출한다. **이 문서의 레지스트리는 내부용이며
외부 플러그인 계약이 아니다.**

### 목표

- Journal과 대칭인 **글로벌 단일 Zettelkasten 스페이스**(최대 1개, 자체 루트).
- **모던 링크드 노트** 방식: 원자 노트 + 타임스탬프 ID + 조밀한 wikilink/백링크 +
  MOC(인덱스) 노트 + 가벼운 inbox 캡처. `fleeting/literature/permanent` 3단계
  규율은 **강제하지 않는다.**
- 링크/백링크/그래프/전문검색은 **기존 인프라를 재사용**(신규 구현 아님).
- Journal을 레지스트리로 이관하되 **동작을 보존**(회귀 제로 목표).

### 비목표 (이번 P2에서 제외)

- 노트 타입 강제 규율, Folgezettel 시퀀스, 고급 inbox 처리 워크플로우.
- 외부 플러그인 스페이스 API(P3).
- Journal 내부 패널(Calendar/Memories) 로직 재작성 — 마운트 위치만 레지스트리화.

### 확정 결정 (사용자 승인 2026-07-06)

| 항목 | 결정 |
| --- | --- |
| 아키텍처 | **A — 전면 레지스트리 리팩터** (Journal도 레지스트리로 이관) |
| 방식/충실도 | 모던 링크드 노트 |
| 공간 모델 | 글로벌 단일 (Journal 대칭, 최대 1개) |
| 노트 ID | 타임스탬프 ID + 제목 (`202607051530 원자적 노트.md`) |
| 링크 형식 | `[[ID\|제목]]` (target=ID, display=제목) |
| 디스크 구조 | `inbox/` + `notes/` |
| 캡처 | 제텔카스텐 inbox로 (fleeting note) |

---

## 13.2 스페이스 레지스트리 (Approach A) (§92)

### 문제

현재 스페이스별 동작이 `vaultType === "journal"` 조건 분기로 코드 전반에 흩어져
있다(액티비티바, 워크스페이스 프리셋, 시작 동작, new-file 흐름, 시작 훅 등).
새 스페이스를 추가할 때마다 이 분기들을 병렬로 늘려야 하는 구조.

### SpaceDefinition (내부 레지스트리)

`src/spaces/registry.ts`에 데이터 주도 정의를 둔다. 필드는 **Journal의 실제
동작에서 역으로 추출**하여 실증된 확장점만 담는다(상상 API 금지).

```ts
interface SpaceDefinition {
  type: VaultType;                       // "journal" | "zettelkasten"
  label: string;                         // "Journal" | "Zettelkasten"
  icon: LucideIcon;
  maxInstances: number | null;           // journal: 1, zettelkasten: 1, general: null

  // 시작 동작 (앱 시작 시 이 스페이스가 활성/복원 대상일 때)
  startup?: (ctx: SpaceStartupCtx) => Promise<void>;
  //   journal: 오늘 파일 생성/열기
  //   zettelkasten: home 노트(없으면 inbox) 열기

  // 워크스페이스 프리셋 레이아웃 (사이드바/우패널 구성)
  workspacePreset: WorkspaceLayout;

  // 액티비티바 항목
  activityBarItem?: ActivityBarItem;

  // "새 파일/노트" 흐름
  newFileFlow?: (ctx: SpaceCtx) => Promise<{ path: string; content: string } | null>;
  //   journal: ensureJournalFile
  //   zettelkasten: createZettelNote

  // vault 초기화 시 생성할 폴더/파일
  configFolders: string[];               // journal: ["daily"], zettelkasten: ["inbox", "notes"]

  // 설정 네임스페이스 (per-space 설정 키 접두)
  settingsNamespace?: string;            // "journal" | "zettelkasten"
}
```

레지스트리는 `Map<VaultType, SpaceDefinition>` + `getSpace(type)` / `registerSpace(def)`.
Journal·Zettelkasten을 부팅 시 등록.

### VaultType 확장

- Rust: `src-tauri/src/context/types.rs`의 `VaultType` enum에 `Zettelkasten` variant 추가.
- TS: `src/ipc/types.ts` 미러에 `"zettelkasten"` 추가.
- config.json: `{ "vault": { "type": "zettelkasten" } }`.

### Journal 이관 전략 (동작 보존, 단계적)

회귀 리스크를 통제하기 위해 **behavior-preserving 리팩터**로 진행한다.
기존 테스트(2642 passed)를 안전망으로 삼고, 각 단계마다 전체 테스트 + GUI 확인.

- **A1 — 레지스트리 계약 정의.** Journal이 실제로 사용하는 확장점을 열거하여
  `SpaceDefinition` 인터페이스를 확정. 이 단계는 코드 이동 없음(계약만).
- **A2 — Journal을 레지스트리로 이관 (seam 단위).** `vaultType === "journal"`
  분기들을 `getSpace("journal")` 조회로 하나씩 치환. **패널 컴포넌트 내부는
  불변**, 레지스트리는 "언제/어디에 마운트되는가"만 결정. seam 후보:
  액티비티바 항목, 워크스페이스 프리셋(`stores/file/workspace.ts`), 시작 동작
  (`hooks/use-app-startup.ts`의 journal 분기), new-file(`ensureJournalFile` 호출부),
  config 폴더 초기화. 각 seam 치환 = 1커밋 + 전체 테스트.
- **A3 — Zettelkasten을 2번째 SpaceDefinition으로 등록.** 이 시점에 레지스트리가
  2개 실제 스페이스로 검증됨(rule-of-three 충족).
- **A4 — Zettelkasten 코어 기능 구축**(§93–§97).

---

## 13.3 Zettelkasten 디스크 구조 (§93)

링크가 구조를 대신하므로 계층을 얕게 유지한다.

```
~/zettelkasten/                       vault_type: "zettelkasten"  (최대 1개)
├── .baram/
│   ├── config.json                   { "vault": { "type": "zettelkasten" } }
│   ├── link-index.db                 (기존 인프라 재사용)
│   └── search-index/                 (기존 tantivy 재사용)
├── inbox/                            fleeting notes — 빠른 캡처 착지점
│   └── 202607051530.md
└── notes/                            permanent atomic notes — 플랫
    └── 202607051530 원자적 노트.md   (MOC은 여기서 #moc 태그로 표기)
```

- `inbox/`와 `notes/` 두 폴더로 fleeting/permanent 상태를 **폴더로 가시화**.
  promote = `inbox/` → `notes/` 파일 이동.
- MOC은 별도 폴더를 강제하지 않고 `notes/` 안에서 `#moc` 태그로 식별.

---

## 13.4 노트 정체성 & 생성 (§94)

### ID 규칙

- ID = `YYYYMMDDHHmm` (분 단위). **충돌 시 초(`ss`)를 덧붙여** `YYYYMMDDHHmmss`로 확장.
- permanent 노트 파일명: `{id} {title}.md` (예: `202607051530 원자적 노트.md`).
- fleeting 노트 파일명: `{id}.md` (제목 미정 상태).

### 프론트매터

```yaml
---
id: 202607051530
title: 원자적 노트
created: 2026-07-05T15:30
tags: []
aliases: []
---
```

H1 = title. `id`는 파일명 접두와 프론트매터에 **이중 기록**(리졸버가 둘 다 활용).

### 생성 흐름 (커맨드)

- **New Zettel** — permanent 노트를 `notes/{id} {title}.md`로 생성(빈 제목 허용,
  이후 rename). 커맨드 팔레트 + 키바인딩.
- **New note from selection** — 선택 텍스트를 새 permanent 노트로 추출하고,
  **원위치에 그 노트로의 `[[ID|제목]]` 링크를 삽입**. Zettelkasten의 핵심 동작.
- **Quick Capture** — fleeting 노트를 `inbox/{id}.md`로 생성. P1에서 도입한
  `resolveCaptureTarget` seam의 기본 타깃을 제텔 inbox로 전환(§96).

ID 생성은 앱 런타임 코드이므로 `Date`/`Date.now()` 사용 가능(워크플로우 스크립트
제약과 무관).

---

## 13.5 링크 (기존 인프라 재사용 + 리졸버 확장) (§95)

### 삽입 형식

- `[[` 자동완성 → **제목/별칭으로 검색** → `[[{id}|{title}]]` 삽입
  (target=ID로 안정성, display=제목으로 가독성). wikilink 노드는 이미
  `[[target|display]]`, `#heading`, `#^blockId`, `alias::target`를 지원(§28).
- 제목을 rename해도 ID가 target이므로 링크가 안 깨진다.

### ⚠️ 리졸버 확장 (필수 작업)

현재 링크 리졸버(`src-tauri/src/index/normalizer.rs`)는 **플랫·정확일치**다:
`resolve_target(root, t)` = `{root}/{t}.md`, `normalize_target`은 소문자화 +
`.md` 제거. 즉 `[[Architecture]]` → `{root}/architecture.md`.

이 방식은 `notes/{id} {title}.md` + `[[ID|...]]`와 맞지 않는다(서브폴더 미탐색,
target이 ID인데 파일명은 `{id} {title}`). 따라서 Zettelkasten vault에 대해
**ID 기반 + 서브폴더 인식 리졸버**가 필요하다. 요구 해석 우선순위:

1. target이 ID 패턴(`\d{12,14}`)이면 → 링크 인덱스에서 해당 `id`를 가진 노트로 해석
   (서브폴더 무관, `inbox/`·`notes/` 모두).
2. 아니면 파일명(확장자 제외) 정확/정규화 일치.
3. 아니면 title/alias 프론트매터 일치.

이를 위해 링크 인덱서(`src-tauri/src/index/`)가 노트의 `id`(파일명 접두 또는
프론트매터)를 인덱싱하고, `resolve_target`이 vaultType에 따라 분기하도록 확장한다.
백링크 계산도 동일 리졸버를 사용하므로 이 확장으로 백링크가 자동 일관.

### 재사용 (신규 구현 없음)

- 백링크 패널: `src/components/sidebar/Backlinks.tsx` + `backlink-utils.ts`.
- 그래프 뷰: `src/components/sidebar/GraphView.tsx` + `graph-utils.ts` — 제텔 공간의
  1차 내비게이션으로 전면 노출.
- 전문검색(tantivy) + 퀵스위처(`command/QuickSwitcher.tsx`) — 빠른 노트 점프.

---

## 13.6 inbox → permanent 흐름 (§96)

- **Inbox 패널**: `inbox/`의 fleeting 노트 리스트.
- **Promote 액션**: fleeting → permanent 변환. 제목 부여 → `inbox/{id}.md`를
  `notes/{id} {title}.md`로 이동 → 프론트매터 정리(title/tags). 기존 노트 승격
  로직(`use-keybinding-actions.ts`의 promote — NotesTab의 승격 UI는 P1에서 제거됨)을
  제텔 대상으로 재배선/복원.
- 규율은 강제하지 않는다(모던 스타일). "처리 안 된 fleeting" 배지 정도만 표시.

---

## 13.7 MOC / 인덱스 노트 (기본) (§97)

- `#moc` 태그 컨벤션 + **"New MOC"** 템플릿(큐레이션된 링크 목록 뼈대).
- 사이드바에 MOC 목록(= `#moc` 태그 노트) 노출은 **기본 수준만**. 자동 MOC 생성/
  추천 등 고급 기능은 후속.

---

## 13.8 UI 배선 (§98)

- **액티비티바**: "Zettelkasten" 항목 추가(레지스트리 `activityBarItem`).
- **워크스페이스 프리셋**: 사이드바 = 파일트리 + Inbox/노트 네비게이터, 우패널 =
  백링크(기본) 또는 그래프. `stores/file/workspace.ts`에 레지스트리 기반 프리셋.
- **시작 동작**: 제텔 스페이스가 마지막 활성 컨텍스트였다면 지정 **home 노트**
  (없으면 inbox)를 연다. 레지스트리 `startup` 훅.
- 퀵스위처/커맨드 팔레트는 기존 그대로 동작.

---

## 13.9 캡처 이전 (journal → zettel inbox) (§99)

- P1에서 도입한 seam(`resolveCaptureTarget`)의 **기본 타깃을 제텔 inbox로 전환**
  (제텔 스페이스 존재 시). 미존재 시 폴백 정책은 구현 시 확정(캡처 비활성 또는
  일기 폴백 — A3에서 결정).
- Journal은 순수 일기 유지(인파일 `## Captures` 신규 사용 안 함). NotesTab은
  P1에서 이미 제거됨 → "노트" 개념은 제텔 공간으로 완전 이동.
- **데이터 비파괴**: 기존 저널 파일의 `## Captures` 섹션은 건드리지 않는다.

---

## 13.10 Rust 백엔드 변경

- `context/types.rs`: `VaultType::Zettelkasten` + 직렬화(`"zettelkasten"`).
- `context/`: ContextManager가 zettel vault를 general vault처럼 링크/검색 인덱싱
  (VaultContext는 이미 링크 인덱스 + tantivy 보유 — §80).
- `index/normalizer.rs` + `index/`: §95의 ID 기반 리졸버 + id 인덱싱.
- IPC: 신규 커맨드 최소화 — 노트 생성/이동은 기존 fs 커맨드 재사용. ID 생성은 TS측.

---

## 13.11 설정 & config

- `journal-settings.ts`와 대칭으로 `zettelkasten` 설정 슬라이스 신설:
  `zettelkastenEnabled`, `zettelkastenDirectory`, `zettelkastenStartupBehavior`,
  `zettelkastenHomeNote` 등. settings store partialize에 추가 + version bump.
- 마이그레이션은 **키 추가만**(데이터 비파괴). 기존 사용자에겐 비활성 기본값.

---

## 13.12 데이터 흐름

```
빠른 캡처 ──► resolveCaptureTarget() ──► zettel/inbox/{id}.md  (fleeting)
                                              │  Promote
                                              ▼
[[ 자동완성 ─► 제목 검색 ─► [[ID|제목]] 삽입   zettel/notes/{id} 제목.md  (permanent)
      │                                        │
      ▼                                        ▼
 링크 인덱서(id 인덱싱) ◄──────────── 저장 시 인덱싱 ──► 백링크/그래프/검색 (기존)
      │
      └─► resolve_target(vaultType=zettel): ID→파일 / 파일명 / title·alias
```

---

## 13.13 테스트 전략

- **레지스트리**: `getSpace`/`registerSpace`, journal·zettel 정의 resolution, maxInstances.
- **Journal 이관(A2)**: 각 seam 치환마다 기존 저널 테스트 그린 유지(회귀 게이트).
- **ID 생성**: 포맷, 분 단위 충돌 시 초 확장, 유일성.
- **노트 생성**: 파일명/프론트매터, New-from-selection의 링크 삽입, 캡처 타깃 resolution.
- **리졸버**: ID 타깃 → 서브폴더 파일 해석, 파일명/title 폴백, 백링크 일관성
  (Rust `index/` 유닛 테스트 + TS 통합).
- **promote**: inbox→notes 이동 + 프론트매터 정리.
- **마이그레이션**: 설정 version bump 데이터 비파괴.

---

## 13.14 범위 경계

- **P2 (이번)**: §92 레지스트리 + Journal 이관(A1–A3), §93–§99 Zettelkasten 코어
  (디스크 구조, ID, New Zettel / New-from-selection / Quick Capture, `[[ID|제목]]`
  + 리졸버 확장, inbox→promote, 기본 MOC, UI 배선, 캡처 이전).
- **후속 (P2.5)**: 노트 타입 강제 규율, Folgezettel 시퀀스, 고급 inbox 처리,
  MOC 자동 추천, unlinked mentions(현 부재 시).
- **P3 (deferred, YAGNI)**: 외부 플러그인 스페이스 API — `SpaceDefinition`을 외부
  기여 계약으로 승격.

---

## 13.15 리스크 & 오픈 이슈

- **R1 (핵심) — Journal 회귀.** Approach A는 작동 중 Journal을 이관하므로 최대
  리스크. 완화: §92의 단계적·동작보존 이관 + seam별 전체 테스트 + GUI 확인.
- **R2 — 리졸버 확장 파급.** ID 기반 리졸버가 general vault의 기존 `[[정확일치]]`
  동작을 해치면 안 됨. 완화: vaultType 분기 + 기존 리졸버 테스트 보존, ID 경로는
  zettel vault에서만 활성.
- **R3 — 링크 가독성.** `[[ID|제목]]`의 마크다운 원문이 다소 장황. 수용(선택한
  안정성 트레이드오프). 렌더 시엔 제목만 보이므로 편집 UX 영향은 작음.
- **O1 — 캡처 폴백 정책**: 제텔 스페이스 미존재 시 캡처 동작(비활성 vs 일기 폴백) — A3에서 확정.
- **O2 — home 노트 지정 UX**: 지정 방식(설정 vs 노트에 `#home` 태그) — §98 구현 시 확정.
- **O3 — 스페이스 생성 온보딩**: 제텔 vault 최초 생성/지정 흐름(폴더 선택 + config
  초기화) — Journal 온보딩과 대칭으로 §92 A3에서 설계.
