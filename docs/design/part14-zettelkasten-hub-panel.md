# Part 14. Zettelkasten 허브 패널 설계 (§100–§103)

> Part 13(§91–§99)의 Zettelkasten 스페이스 위에 얹는 **UX 레이어**. 코어(디스크 구조, ID, 캡처, promote, B안 링크, MOC)는 이미 구현되어 있고(PR #173), 이 문서는 "아이디어 정리와 노트 생성을 쉽고 편하게" 만드는 **인터페이스**를 정의한다.

## 14.0 목표 / 비목표

**목표**
- Zettel 공간의 핵심 루프(포착 → 처리 → 생성 → 연결 → 탐색)를 **한 화면에서 발견 가능하고 매끄럽게** 잇는다.
- 현재 3대 마찰 해소: (1) 진입점 비가시성(기능이 단축키뿐), (2) inbox 처리 UI 부재, (3) 빈약한 생성/승격 다이얼로그.
- 대상 워크플로: **혼합**(빠른 포착 + 정제 작성을 오감).

**비목표 (P2.5 이후로 유지)**
- 노트 타입 강제 규율(fleeting/literature), Folgezettel 시퀀스, MOC 자동 추천, unlinked mentions — Part 13 §13.14 그대로 연기.
- 그래프 뷰 재설계, 외부 플러그인 스페이스 API(P3).

**핵심 가치 제약**
- Baram "가볍다/아름답다": 허브는 **Zettel 공간에서만** 렌더. 다른 공간·일반 vault엔 어떤 새 상시 UI도 추가하지 않는다.

---

## 14.1 배치 & 라우팅 (§100)

**결정: 허브를 Zettel 공간의 기본 사이드바 패널로.** (Journal 공간이 `sidebarPanel: "calendar"`를 기본으로 쓰는 것과 동일한 메커니즘)

- `SidebarPanel` 타입(`src/stores/ui/ui.ts`, canonical 위치)에 `"zettel"` 값 추가.
- `src/spaces/zettelkasten-space.ts`의 `layout.sidebarPanel`을 `"files"` → `"zettel"`로 변경.
- `Sidebar.tsx`: `sidebarPanel === "zettel"`일 때 `<ZettelHubPanel />` 렌더.
- `ActivityBar.tsx`: **[Zettel] 아이템** 추가(아이콘: 카드/노트 계열). Zettel 공간이 활성일 때만 노출. **[Files]**를 누르면 `sidebarPanel="files"`로 전환 → notes/ 트리 탐색. 즉 트리는 **한 클릭 거리**.

경계 규칙: 활성 컨텍스트의 `vaultType`이 `zettelkasten`이 아니면 [Zettel] 아이템·허브를 노출하지 않는다.

---

## 14.2 허브 패널 구성 (§101)

새 컴포넌트 `src/components/zettelkasten/ZettelHubPanel.tsx`. 3~4개 섹션의 세로 스택:

```
┌ Zettelkasten ──────────────┐
│ [+ New] [⚡ Capture] [🗺 MOC] │  ← A. Actions
├────────────────────────────┤
│ ▾ INBOX (3)                │  ← B. Inbox 큐
│   • 자료구조 아이디어  ↑ ✕  │
│   • 회의 메모          ↑ ✕  │
│   • arxiv 링크…        ↑ ✕  │
├────────────────────────────┤
│ ▾ MOCs                     │  ← C. MOC 진입점
│   🗺 지식관리                │
│   🗺 주간리뷰                │
├────────────────────────────┤
│ ▾ RECENT                   │  ← D. 최근 노트
│   • 원자성 원칙             │
│   • TCP 흐름제어            │
└────────────────────────────┘
```

### A. Actions 바
- `+ New` → `zettelkasten.newNote` (⇧⌘V)
- `⚡ Capture` → `openQuickCapture()` (⇧⌘N)
- `🗺 MOC` → `zettelkasten.newMoc` (⇧⌘C)
- 각 버튼 `title`(tooltip)에 이름 + 단축키 표기 → **발견성 해결**. 버튼은 기존 키바인딩 액션을 그대로 호출(단일 진실원).

### B. Inbox 큐
- 데이터: `{zettelDir}/inbox/`의 `.md` 파일들. 헤더에 개수 배지 `INBOX (n)`.
- 항목 표시: **제목 = 본문 첫 비어있지 않은 줄**(없으면 파일명/시간). 보조로 frontmatter 태그 최대 2개 pill.
- 상호작용:
  - 항목 클릭 → 해당 노트를 에디터 탭으로 연다.
  - hover 시 나타나는 `↑ Promote` → **강화된 승격 다이얼로그**(§102) 오픈, 제목은 첫 줄로 미리채움.
  - hover 시 `✕ Delete` → 확인 후 `deleteFile` + 인덱스 `removeByPath`.
- 정렬: 생성 최신순(파일명 id 내림차순).
- 빈 상태: "Inbox가 비었습니다 — ⇧⌘N으로 생각을 담아보세요." 안내 카드.

### C. MOCs
- 데이터: `#moc` 태그를 가진 permanent 노트 목록(Rust 태그 검색 재사용, §14.4).
- 클릭 → 열기. 아이콘 🗺. MOC이 없으면 섹션 숨김(또는 "🗺 MOC 만들기" 힌트).

### D. Recent
- 데이터: `notes/`의 최근 수정 `.md` 상위 N개(기본 7).
- 클릭 → 열기.

### 접이식
- INBOX / MOCs / RECENT 각 섹션 헤더는 접기(▾/▸) 가능. 접힘 상태는 UI 스토어에 persist(패널 길이 관리).

---

## 14.3 강화된 공유 다이얼로그 (§102)

현재 `ZettelTitleDialog`는 4개 액션(New/Promote/from-Selection/MOC)이 공유하는데 맥락이 없어 "이게 뭐하는 창이지"를 유발한다. 다이얼로그 상태를 확장한다.

**상태 변경** (`src/stores/ui/ui.ts`)

```ts
zettelTitleDialog: {
  open: boolean;
  onSubmit: ((title: string) => void) | null;
  initialTitle: string;
  // 신규
  title: string;        // 헤더 (예: "Promote to Permanent Note")
  description?: string; // 한 줄 설명
  confirmLabel: string; // 확인 버튼 라벨 (예: "Promote")
}
```

**시그니처 변경**

```ts
openZettelTitleDialog(opts: {
  onSubmit: (title: string) => void;
  title: string;
  confirmLabel: string;
  initialTitle?: string;
  description?: string;
}): void
```

**액션별 값**

| 액션 | title | description | confirmLabel | initialTitle |
| --- | --- | --- | --- | --- |
| New Zettel | New Zettel | notes/에 새 영구 노트를 만듭니다 | Create | "" |
| **Promote** | **Promote to Permanent Note** | **이 fleeting 노트를 inbox → notes/로 승격합니다** | **Promote** | **fleeting 본문 첫 줄** |
| New from Selection | New Note from Selection | 선택 텍스트로 노트를 만들고 [[링크]]로 대체합니다 | Create | 선택 앞 3단어 |
| New MOC | New MOC | #moc 색인 노트를 만듭니다 | Create | "" |

**컴포넌트 변경** (`ZettelTitleDialog.tsx`): 헤더(`title`) + 설명(`description`) + 확인 버튼 라벨(`confirmLabel`) 렌더. 나머지(IME 가드, Enter/Escape, autoFocus)는 유지.

**Promote 스마트 기본값**: `zettelkasten.promote` 액션이 승격 대상 fleeting 파일을 읽어 `stripFrontmatter` 후 **첫 비어있지 않은 줄**을 `initialTitle`로 넘긴다. 사용자는 확인만 눌러도(또는 다듬어) 승격 완료.

---

## 14.4 데이터 소스 & 상태 (§103)

- **인덱스**: `useZettelIndexStore`(`byId`: id→{path,title})를 렌더의 1차 소스로 사용. 허브가 열릴 때 `refreshZettelIndex(zettelDir)`로 최신화(이미 공간 진입/컨텍스트 변경 시 갱신됨 — §95 M1).
- **Inbox 목록**: `listDir(`${dir}/inbox`)`의 `.md` + 각 파일 첫 줄(제목). 소규모라 즉시 스캔 허용. 파일 시스템 watcher가 있으면 반영, 없으면 액션(캡처/승격/삭제) 후 수동 리프레시.
- **MOCs**: 기존 태그 검색 인프라 재사용(Rust `tag` 커맨드로 `#moc` 보유 파일 조회). 프론트 폴백: `notes/` 스캔 중 `#moc` 매칭.
- **Recent**: `listDir(`${dir}/notes`)` mtime 정렬 상위 N.
- 셀렉터는 `useShallow` 준수(프로젝트 규약). 허브는 `zettelkastenEnabled && resolvedDir`일 때만 데이터 요청.

**리프레시 트리거**: 캡처/승격/삭제/생성 성공 후 허브 목록을 갱신(액션 완료 콜백에서 인덱스 리프레시 + inbox 재스캔). watcher 연동은 후속.

---

## 14.5 컴포넌트 / 파일 구조

- 신규 `src/components/zettelkasten/ZettelHubPanel.tsx` — 패널 컨테이너 + 3~4 섹션.
- 신규 하위(선택): `ZettelInboxList.tsx`, `ZettelSectionList.tsx`(MOC/Recent 공용) — 파일이 ~300줄 넘으면 분리.
- 신규 CSS: `src/styles/zettelkasten.css`(또는 기존 `journal-*` 계열에 편승하지 말고 전용) — `@import`는 `index.css`에 추가.
- 수정: `ui.ts`(SidebarPanel + 다이얼로그 상태/시그니처), `Sidebar.tsx`, `ActivityBar.tsx`, `zettelkasten-space.ts`(layout), `ZettelTitleDialog.tsx`, `use-keybinding-actions.ts`(4개 openZettelTitleDialog 호출 + promote 스마트 기본값), `CommandPalette.tsx`(동일 다이얼로그 호출부).
- **기존 위치 정리(선택)**: `ZettelTitleDialog.tsx`·`QuickCaptureDialog.tsx`가 현재 `components/journal/`에 있음(journal 캡처 시절 잔재). 이번에 `components/zettelkasten/`로 이동하는 건 별도 정리로 두거나 함께 처리 — 스코프는 플랜에서 결정.

---

## 14.6 상호작용 상세 & 엣지

- Delete는 되돌리기 어려우므로 **확인 프롬프트** 필수.
- Promote 후: inbox 파일 삭제 + notes/ 새 파일 오픈 → 허브의 INBOX 개수 감소, RECENT 갱신.
- 공간 미설정(`!zettelkastenEnabled` 또는 dir 미해결) 시: 허브는 "제텔카스텐 공간을 먼저 설정하세요" 안내(설정 링크). Actions 비활성.
- 대량 inbox: 목록은 가상 스크롤 없이도 수용(정상 사용 규모). 필요 시 top-N + "더 보기"로 제한하되 **잘림을 명시**.
- 키보드: 허브는 마우스 중심이되, 기존 단축키(⇧⌘V/N/U/Y/C)는 그대로 병행 동작.

---

## 14.7 테스트 전략

- **단위**: inbox 항목의 "첫 줄 → 제목" 파생, promote 스마트 기본값 추출, MOC 필터(#moc), recent 정렬.
- **다이얼로그**: 액션별 title/description/confirmLabel 렌더 + Promote 미리채움(RTL). 기존 `ZettelTitleDialog` 사용처 회귀.
- **패널 렌더**: 빈 inbox 안내, 개수 배지, 클릭→open, ↑→다이얼로그, ✕→삭제 확인(모킹).
- **라우팅**: zettel 공간 진입 시 `sidebarPanel==="zettel"`, [Files] 토글, 비-zettel 공간에서 [Zettel] 미노출.
- 전체 스위트 그린 유지(현재 2732 passed 기준).

---

## 14.8 범위 경계

- **이번(허브 UX)**: §100 배치/라우팅, §101 허브 패널(Actions/Inbox/MOCs/Recent), §102 강화 다이얼로그 + Promote 스마트 기본값, §103 데이터 소스.
- **후속(P2.5 유지)**: 노트 타입 규율, MOC 자동 추천, unlinked mentions, inbox 배치 처리(다중 선택 승격), 파일 watcher 실시간 반영.
- **미결**: `components/journal/` → `components/zettelkasten/` 이동을 이번에 포함할지(플랜에서 확정).

---

## 14.9 명칭 (Naming)

**결정: 사용자 표시 이름 = "Zettel". 내부 코드 정체성은 `zettelkasten` 그대로 유지.**

- 근거: 방법론 정체성·코드 일관성(`vaultType: "zettelkasten"`, `zettel-*` 파일, `[[id]]` 인덱스)을 지키면서, 긴 독일어 합성어의 읽기/쓰기/기억 장벽만 덜어낸다. Baram의 다른 공간명(Writing/Journal/Skills)과 톤도 맞춘다.
- **변경 범위 = 사용자에게 보이는 문자열만** (enum/타입/파일명/디렉토리 구조는 불변):
  - `src/spaces/zettelkasten-space.ts` — `label: "Zettelkasten"` → `"Zettel"`
  - `src/stores/file/workspace.ts` — 프리셋 `name: "Zettelkasten"` → `"Zettel"`, `description` 평이화
  - `src/components/command/CommandPalette.tsx` — "Open Zettelkasten" → "Open Zettel" 등
  - `src/extensions/plugins/slash-command-items.ts` — `/capture` 설명 문구
  - `src/components/settings/tabs/GeneralTab.tsx` — 설정 라벨(Enable/Directory/Home Note)
  - `src/components/journal/QuickCaptureDialog.tsx` — "제텔카스텐 공간을 먼저 설정하세요" → "Zettel 공간을 …"
  - (신규) ActivityBar [Zettel] 아이템 라벨, 허브 패널 헤더 "Zettel"
- **설명 문구도 평이화**: 예) 프리셋 설명 "Open the Zettelkasten space (notes + inbox + backlinks)." → "생각을 빠르게 담고 연결된 노트로 다듬는 공간".
- **시퀀싱**: 이 표시명 리네임은 **작고 독립적**이라 현재 PR(#173)에 바로 얹어 개선할 수 있다(허브 구현과 무관). 허브는 별도 후속 브랜치.
