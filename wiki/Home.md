# baram

Tauri 2.0 + Tiptap/ProseMirror + React 로 만든 경량 WYSIWYG 마크다운 에디터.

## 목적별 길잡이

| 하려는 일                              | 먼저 읽을 것                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 앱을 쓴다                              | [시작하기](https://baram.ing/ko/docs/getting-started/) — 사용자 문서 전체는 [baram.ing/ko/docs](https://baram.ing/ko/docs/)                                                                                                                         |
| 지금 무엇이 되고 무엇이 안 되는지 본다 | [이슈](https://github.com/sayinel/baram/issues)                                                                                                                                                                                                     |
| 코드에 기여한다                        | [`CLAUDE.md`](https://github.com/sayinel/baram/blob/main/CLAUDE.md) 의 기술 스택 · 로컬 실행 · 테스트 · Git 절. PR 을 열기 전에 돌릴 `npm run verify:ci` 는 [`CONTRIBUTING.md`](https://github.com/sayinel/baram/blob/main/CONTRIBUTING.md) 에 있다 |
| 코드가 지켜야 하는 계약을 찾는다       | 리포의 `CLAUDE.md` 와 각 모듈 헤더 주석                                                                                                                                                                                                             |
| 플러그인을 만든다                      | [빠르게 시작하기](https://baram.ing/ko/docs/plugin-dev/quick-start/)                                                                                                                                                                                |
| 테마를 만든다                          | [테마 만들기](https://baram.ing/ko/docs/customization/creating-themes/)                                                                                                                                                                             |
| 보안 문제를 알린다                     | [`SECURITY.md`](https://github.com/sayinel/baram/blob/main/SECURITY.md) — 공개 이슈가 아니라 비공개 신고로                                                                                                                                          |
| **왜 이렇게 만들었는지 안다**          | **여기** — 아래 원칙과 섹션                                                                                                                                                                                                                         |

이 wiki 는 리포의 `wiki/` 에서 생성된다. 합성·색인 레이어이므로 **거의 변하지 않는 것**만
직접 싣고 — 아키텍처 불변식, 결정과 그 근거, 두 번 밟지 말아야 할 함정 — 자주 변하는 것은
위 표의 canonical 한 집을 가리킨다.

## baram 의 모양

웹뷰의 React 프런트엔드와 Rust 백엔드가 Tauri IPC 로 이야기하고, 노트는 디스크의 마크다운 파일이다.
같은 실행 파일이 명령줄 도구로도 돌고, sandboxed 플러그인은 따로 떨어진 웹뷰에서 돈다.

```
앱 웹뷰 — React
│  에디터      Tiptap / ProseMirror
│  상태        Zustand
│  파이프라인  markdown → mdast → ProseMirror, 되돌릴 때는 그 역순 (remark)
│  trusted 플러그인 — 앱 코드와 같은 JS realm 에서 돈다
│
│  ▼ IPC 커맨드 (invoke)      ▲ 이벤트 (llm:token · file:changed …)
│
│        플러그인 웹뷰 plugin-<id> — sandboxed 플러그인, 플러그인마다 숨은 창 하나
│        │  ACL 이 허락하는 커맨드: 브로커 plugin_call, 전송 plugin_sandbox_connect ·
│        │  plugin_sandbox_report. 앱 웹뷰의 호스트와 주고받는 메시지도 Rust 를 거친다
│        │
│        │        CLI 모드 — 같은 실행 파일, argv 로 갈린다 (cli::mode_for)
│        │        │  Tauri 를 띄우지 않고 vault 를 조회하는 함수(파일 · 링크 인덱스 ·
│        │        │  검색 · 태그 · 태스크)를 직접 부른다. 읽기만 한다
▼        ▼        ▼
Rust 백엔드 — 웹뷰의 호출은 IPC 커맨드를 거쳐, CLI 의 호출은 곧장 모듈로
│  파일 · 파일 감시 · 링크 인덱스 · 검색 · 태그 인덱스 · 태스크 인덱스
│  플러그인 브로커 · vault 승인 저장소 · export · git · 스냅샷 …
│  LLM 스트리밍 ──▶ AI 프로바이더 (HTTP)
▼
디스크의 마크다운 파일 (vault)
```

에디터 위의 vim 은 [Vim](Vim-Overview), CLI 모드는 [CLI](CLI-Overview) 섹션이 잇는다. 파이프라인은
아래 원칙 1 이, trusted · sandboxed 티어는 원칙 3 과 사용자 문서
[신뢰 모델, 보안, 오류](https://baram.ing/ko/docs/plugin-dev/trust-model-and-errors/) 가 잇는다. 링크
인덱스 · vault 승인 저장소 · export 는 wiki 섹션이 없다 — 출처는 아래 표에 있다.

## 앱 전체에 걸친 원칙

원칙마다 그것을 지키는 관문과, 그 관문이 보지 못하는 것을 함께 적는다.

### 1. 마크다운 파일이 원본이고, WYSIWYG 의 저장은 그 파일을 §7.1 의 표기로 다시 쓴다

- **원칙** — WYSIWYG 에서의 저장은 문서 전체를 다시 직렬화하고 표기를 한 가지로 맞춘다: 목록 기호 `-`, 굵게 `**`, 기울임 `*`,
  구분선 `---`, `#` 제목, 코드 블록은 백틱 펜스. 그래서 다른 표기(`*` · `+` 목록, `__굵게__`, Setext 제목, 들여쓴
  코드, 문단 줄 끝의 공백 같은)로 쓴 파일은 첫 저장에서 그 줄들이 바뀐다. 그 표기로 쓴 원문은 왕복에서 바이트가
  바뀌지 않아야 한다. source mode 에서의 저장은 버퍼의 글을 그대로 쓴다.
- **왜** — 저장은 매번 문서 전체를 쓴다. 왕복이 무언가를 잃으면 사용자가 손대지 않은 곳에서 잃는다 — 굵게가 든
  하이라이트(`==**b**==`)를 읽으며 하이라이트를 버리고 다음 저장에 `\==**b**==` 를 쓰던 결함(#646 · #647)이
  그랬다. 그 수정은 하이라이트를 지키되 `<mark>**b**</mark>` 로 쓴다 — 이것도 첫 저장에서 바뀌는 표기다. 표기를
  맞추는 것은 잃는 것이 아니지만 diff 를 만든다 — 표 셀을 열 폭까지 채우던 정규화는 그래서 걷어 냈다(#645).
- **무엇이 지키나 · 보지 못하는 것** — 라운드트립 시험(`Roundtrip: Headings` · `Roundtrip: Lists` 같은
  vitest 묶음)이 제 입력의 바이트 일치를 단언하고, 확장마다 그 시험을 두는 것이 `CLAUDE.md` 의 규약이다. 시험한
  입력뿐이다 — 모든 문법을 훑는 관문은 없다. 표기가 바뀌는 자리 가운데 표 구분 행의 대시 수(mdast 가 기록하지
  않는다)와 후행 공백이 붙은 빈 체크박스는 시험이 정규화로 적어 둔다.

### 2. vault 경계는 자기를 인가할 수 없다 (§329–§336)

- **원칙** — 웹뷰가 넘긴 경로에 asset scope 를 열기 전에, Rust 가 소유한 승인 기록(`approved-roots.json`)이 그
  경로를 덮는지 본다. 덮지 않으면 `approval_cmd::ensure_approved` 는 사용자에게 묻고(경로를 풀지 못하면 거부),
  플러그인 dev 폴더의 부여(`admit_folder`)는 묻지 않고 거부한다.
- **왜** — 웹뷰는 `config.json` 에 임의 키를 쓸 수 있어, 승인을 거기 두면 인가받아야 할 쪽이 자기 인가를 쓴다.
- **무엇이 지키나 · 보지 못하는 것** — `no_new_asset_scope_grant_outside_the_allowlist` 가 크레이트 소스에서
  `.allow_directory(` · `.allow_file(` 이 든 줄을 훑어 (파일, 줄 텍스트) 허용 목록과 개수로 고정한다. 새 자리가
  승인 게이트를 먼저 지나는지는 목록에 올리는 사람이 보고, 목록에는 웹뷰 경로가 아닌 부여도 이유와 함께 있다.
  `no_new_scope_forbid_call_anywhere_in_the_crate` 는 `.forbid_directory(` · `.forbid_file(` 이 든 줄을 허용
  목록에 오른 줄 말고는 막는다 — forbid 는 allow 보다 우선하고 해제 API 가 없어, 회수가 그 세션의 재승인까지
  죽인다. 이쪽은 개수를 세지 않아, 허용된 줄과 같은 텍스트를 같은 파일에 하나 더 두면 지나간다. 두 시험이 보는
  것은 이 크레이트에 메서드 호출 꼴로 쓴 줄이다 — `Scope::allow_directory(&scope, …)` 처럼 달리 쓴 호출과
  의존성 안의 부여는 보지 못한다. 대화상자 플러그인의 `open` · `save` 는 사용자가 고른 경로를 asset scope 에
  더하고, 앱 창은 그 권한(`dialog:default`)을 가진다.

### 3. 플러그인 권한이 경계가 되는 것은 `sandboxed` 티어에서다 (§260)

- **원칙** — `sandboxed` 플러그인은 플러그인마다 숨은 `plugin-<id>` 웹뷰에서 돈다. 파일 · 네트워크 · 저장소는
  Rust 브로커 `plugin_call` 이 창 라벨과 승인한 capability 로, 에디터 · AI · 설정 · UI 는 앱 쪽 호스트가
  대조한다. `trusted` 플러그인은 앱 코드와 같은 JS realm 에서 돌고, 거기서 capability 검사는 API 관문일 뿐이다.
- **왜** — 같은 realm 의 코드는 `invoke` 를 직접 import 해 앱 창이 허락받은 커맨드(앱 커맨드 가운데서는 sandbox
  전용 커맨드를 뺀 전부)를 부를 수 있고, Rust 는 그 호출이 앱의 것인지 플러그인의 것인지 가를 수 없다.
- **무엇이 지키나 · 보지 못하는 것** — Rust 통합 시험 `acl_lockdown` 의 `sandbox_tier_grants_exactly_its_allowlist`
  가 `plugin-*` 창에 닿는 capability 를 모두 합친 권한이 정확히 `plugin_call` · `plugin_sandbox_connect` ·
  `plugin_sandbox_report` 의 allow 권한인지 보고, 브로커가 op 마다 요구하는 capability 는
  `required_capability_mapping_is_exhaustive_and_not_cross_wired` 가 고정한다. 그 시험이 보는 것은 허락된
  권한이다 — Tauri 가 ACL 을 거치지 않게 둔 채널 데이터 fetch 는 어느 웹뷰나 부를 수 있고, `acl_lockdown` 의
  주석이 그 한계를 적어 둔다.

### 4. 링크 이름은 한 접기로 비교한다 (§390)

- **원칙** — 링크가 가리키는 노트 이름 · 링크 대상 · 링크 앞의 vault alias 는 NFC → 소문자 → NFC 로 접어
  비교하고, 프런트의 `foldName` 과 Rust 의 `fold_name` 이 같은 접기다. 경로가 root 아래인지 묻는 판정은 이
  접기를 쓰지 않는다.
- **왜** — 키보드로 친 이름은 완성형(NFC)이고 macOS 의 일부 도구는 파일 이름을 분해형(NFD)으로 저장해, 한
  이름이 두 문자열이 된다.
- **무엇이 지키나 · 보지 못하는 것** — 두 언어의 시험(`fold_name_agrees_with_the_shared_fixture`, vitest 의
  `foldName and the fixture the backend reads`)이 같은 픽스처 파일을 읽는다. Rust 링크 인덱스 모듈 안에서
  `fold_name` 을 건너뛰는 대소문자 접기는 `no_name_comparison_in_the_index_folds_case_past_fold_name` 이(이유와
  함께 허용 목록에 오른 것 말고), ESLint 규칙이 지정한 프런트 파일의 맨 `toLowerCase` · `toLocaleLowerCase` 는
  `no-restricted-properties` 가 막는다(`eslint-disable-next-line` 을 단 줄 말고). 두 스캔은 정해 둔 꼴의 접기만
  찾는다 — 접기 없는 바이트 비교(`===` · `starts_with` 같은)는 보지 못한다. 그리고 스캔 범위 밖에서 이름을
  비교하는 코드가 있다 — 프런트는 ESLint 규칙의 파일 범위 밖, Rust 는 링크 인덱스 모듈 밖이다(링크 대상을 맨
  소문자로 파일 이름과 대조하는 `resolve_cross_vault_link` 처럼).

## 섹션

- **[Vim](Vim-Overview)** — WYSIWYG · source mode · 코드블록에서 켜지는 vim 모달 편집. 평문 표면은 기성
  어댑터를, WYSIWYG 는 자체 엔진을 쓴다 — 그 선이 왜 거기인지와 한국어 입력을 어느 층에서 받는지가 내용이다.
  [Overview](Vim-Overview) → [Architecture](Vim-Architecture) → [Decisions and history](Vim-Decisions-and-history).
  파일 위치는 [Code map](Vim-Code-map).
- **[CLI](CLI-Overview)** — 앱 실행 파일이 겸하는 읽기 전용 명령줄 도구. Tauri 를 띄우지 않고 앱과 같은
  Rust 함수로 디스크의 vault 를 읽는다 — 모드 분기, 앱과 같은 답과 일부러 다른 답, 그 모양을 지키는 불변식이
  내용이다. [Overview](CLI-Overview) → [Architecture](CLI-Architecture) → [Decisions and history](CLI-Decisions-and-history).

### wiki 섹션이 없는 영역 — 출처

| 영역                                    | 출처                                                                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 링크 인덱스와 파일 rename (#678 · #619) | `CLAUDE.md` Rust 절의 링크 index · 파일 rename 항목, `index::filing` 의 모듈 doc, 사용자 문서 [위키링크와 태그](https://baram.ing/ko/docs/linking/wikilinks-and-tags/)                                                                                               |
| 플러그인 실행 모델 (§260)               | 사용자 문서 [신뢰 모델, 보안, 오류](https://baram.ing/ko/docs/plugin-dev/trust-model-and-errors/), Rust 통합 시험 `acl_lockdown` 의 모듈 doc, `createExtensionContext` 위의 주석                                                                                     |
| 테마와 외관 (§355~§371)                 | 사용자 문서 [테마](https://baram.ing/ko/docs/customization/themes/) · [테마 만들기](https://baram.ing/ko/docs/customization/creating-themes/) · [설정과 외관](https://baram.ing/ko/docs/customization/settings-and-themes/), `installTheme` 이 사는 모듈의 헤더 주석 |
| export 정책 (#527 · #545)               | `CLAUDE.md` TypeScript 절의 "export 경로는 둘이다" 항목, 사용자 문서 [내보내기](https://baram.ing/ko/docs/export/)                                                                                                                                                   |
| vault 경계 인가 (§329–§336)             | `CLAUDE.md` Rust 절의 "vault 경계는 자기를 인가할 수 없다" 항목, `approval` 모듈의 헤더 주석, 사용자 문서 [볼트와 폴더 접근](https://baram.ing/ko/docs/workspace/vaults-and-approval/)                                                                               |

## 이 wiki 에 기여하기

리포의 `wiki/` 를 고쳐 PR 로 보낸다. PR 의 CI lint 잡이 `npm run lint` 안에서 wiki 게이트 `npm run lint:wiki`
와 prettier 검사를 돌리고, `wiki/` 의 변경이 main 에 들어오면 게시 워크플로가 wiki 게이트를 다시 돌린 뒤(prettier
검사는 다시 돌리지 않는다) GitHub wiki 로 게시한다. GitHub wiki 에서 직접 고친 것은 다음 게시가 알림 없이 덮는다.

- **합성 · 색인 레이어다.** 거의 변하지 않는 것만 직접 싣고, 쓰는 법은 사용자 문서로, 구현 현황은 이슈로 보낸다.
- **낡는 숫자(줄 수 · 개수)와 "예정 · 대기 · 진행 중" 을 쓰지 않는다.** § 번호와 이슈 · PR 번호는 식별자라 쓴다.
- **페이지 이름이 곧 계층이고, 바꾸지 않는다.** `Vim Architecture` 는 `Vim-Architecture.md` 다 — GitHub wiki
  에는 폴더가 없고 이름이 전역 유일해야 하며, 리다이렉트가 없어 이름을 바꾸면 밖에 남은 링크가 깨진다. 이름이
  틀렸으면 새 페이지를 만들고 옛 페이지를 한 줄 포인터로 남긴다 — 게이트는 그 포인터 페이지에도 길이와 사이드바
  등재를 요구하므로, `scripts/check-wiki.mjs` 의 `SIZE_EXCEPTIONS` 에 이유와 함께 올리고 사이드바에 링크한다.
- **페이지는 40~200줄이다** (Home · 사이드바 · 푸터는 게이트가 재지 않고, 정당한 예외는 `SIZE_EXCEPTIONS` 에
  이유와 함께 적는다). 새 페이지는 사이드바에 링크해야 게이트를 지난다.
- **내부 링크는 확장자 없이 `[Architecture](Vim-Architecture)` 꼴로 쓴다.** 게이트가 대상 페이지가 있는지
  보고, `baram.ing` 링크는 사용자 문서 소스에 그 페이지가 있는지 본다. 이중 대괄호 문법은 코드 안이어도
  게이트가 거부한다.

규칙의 출처는 `CLAUDE.md` 의 "개발자용 wiki 편집" 항목이고, wiki 게이트가 거는 검사는 `scripts/check-wiki.mjs`
에 있다 — 심볼릭 링크와 하위 디렉터리 금지처럼 이 페이지와 그 항목에 없는 것도 있다. 문장 하나하나에 걸리는
규칙은 같은 파일의 "주석·문서의 주장" 절에 있다.
