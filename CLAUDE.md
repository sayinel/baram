# Baram — Lightweight WYSIWYG Markdown Editor

## 프로젝트 개요

Baram(바람)은 Tauri 2.0 + Tiptap/ProseMirror + React 기반의 경량 WYSIWYG 마크다운 에디터다.
Typora의 WYSIWYG 품질 + Obsidian의 확장성 + AI 네이티브 통합을 목표한다.

- **핵심 가치**: 가볍다(~10MB) / 아름답다(구문이 사라지는 WYSIWYG) / 연결된다(양방향 링크 + AI)
- **타겟 사용자**: AI 개발자(Skills 편집), 마크다운 파워유저(기술 문서), 연구자(수식+지식 링크)
- **라이선스**: Apache-2.0

## 기술 스택

| 영역                  | 기술                                 | 버전          |
| --------------------- | ------------------------------------ | ------------- |
| Desktop Framework     | Tauri                                | 2.0           |
| Backend               | Rust                                 | latest stable |
| Dev Runtime           | Node.js                              | 24 LTS        |
| Frontend              | React                                | 19            |
| Language              | TypeScript                           | 6.0           |
| Bundler               | Vite (rolldown)                      | 8             |
| Styling               | Tailwind CSS                         | 4             |
| Editor Engine         | Tiptap (ProseMirror)                 | v3            |
| Math / Code / Diagram | KaTeX / CodeMirror 6 / Mermaid.js    | latest        |
| State Management      | Zustand                              | latest        |
| Search / Link Index   | regex 검색 · 인메모리 HashMap (Rust) | —             |
| PDF Export            | chromiumoxide (headless)             | 0.9           |
| File Watcher          | notify (Rust)                        | 8             |
| Design Tokens         | Style Dictionary + W3C DTCG          | 5.x           |

## 디렉토리 구조

```
baram/
├── src-tauri/              # Rust 백엔드 (자체 CLAUDE.md)
│   └── src/
│       ├── commands/       # IPC 커맨드 핸들러 (thin layer): {approval,config,context,embedding,
│       │                   #   export,fs,git,index,keyring,llm,plugin,search,snapshot,tag,
│       │                   #   task,theme,thumbnail}_cmd.rs
│       ├── approval/       # vault 경계 승인 저장소 (§331) context/ # ContextManager (§88)
│       ├── search/         # regex 전문 검색 (§5.11)      index/     # 링크 인덱서 (§29)
│       ├── plugin/         # 플러그인 설치/레지스트리 (§69) snapshot/  # 버전 히스토리 (§71)
│       ├── tag/            # Vault 태그 인덱스 (§56m)     task/      # 태스크 인덱스 (§302~)
│       └── fs/ git/ llm/ export/ config/ embedding/ logging/ md/ protocol/ thumbnail/ menu.rs
├── src/                    # React 프론트엔드
│   ├── components/         # editor/ sidebar/ toolbar/ command/ ai/ settings/ layout/ journal/
│   │                       #   tasks/ zettelkasten/ plugins/ export/ help/ onboarding/
│   ├── extensions/         # Tiptap Extensions (자체 CLAUDE.md): nodes/ marks/ plugins/ __tests__/
│   │                       #   registry.json = Extension 메타데이터 레지스트리 (등록 필수)
│   ├── pipeline/           # MD ↔ ProseMirror: md-to-pm.ts / pm-to-md.ts / transformers/
│   ├── stores/             # Zustand: context/ editor/ file/ ui/ settings/ system/ zettelkasten/ ai/
│   │                       #   tasks/ + agent·authorship·knowledge·writing-flow-store.ts
│   │                       #   RightPanelMode·SidebarPanel canonical = ui/ui.ts
│   ├── styles/             # CSS 모듈(~68): index.css(@import) + base.css(토큰·유틸·다크모드)
│   │                       #   generated/ = Style Dictionary 자동 생성 (DO NOT EDIT)
│   ├── ipc/                # Tauri IPC 래퍼 (types.ts, invoke.ts)
│   ├── sandbox/            # 플러그인 샌드박스 호스트/브리지 (§260) — 신뢰 티어 경계
│   ├── themes/             # 테마 패키지 (§360): theme-manifest.ts 검증 · theme-install.ts
│   │                       #   위생 파이프라인(sanitize→inline→저장→commit) · theme-store-fs.ts 파일 접근
│   └── hooks/ contexts/ i18n/(en,ko) keybindings/ plugins/ services/ spaces/ utils/ types/ spike/
├── tokens/                 # W3C DTCG 디자인 토큰: primitive/ semantic/ tokens-studio.json
├── scripts/                # audit-css-vars.ts, export-tokens-studio.ts
├── docs/assets/            # README 가 직접 참조하는 이미지만 남는다 — 문서 본문은 site/ 로 이주했다
├── site/                   # 홈페이지 + 문서 사이트 — **독립 npm 프로젝트**(자체 package.json/lockfile)
│                           #   Astro + Starlight · 랜딩 `/{en,ko}/` · 문서 `/{locale}/docs/**`(57페이지)
│                           #   ia-tree.mjs = 사이드바·제목 canonical · help-routes.json = 앱 URL 계약
│                           #   routes.mjs = help-routes.json으로 URL을 조립하는 유일한 곳(withBase)
├── dev/                    # 내부 개발 문서 (public 배포 제외, git 밖 심볼릭 링크) — 성격별 5분류:
│                           #   design/(설계서 part1~20) design/specs/(기능별 설계) plans/(구현 계획)
│                           #   impl-notes/(구현 기록·렛저) guides/(런북) + backlog·next-steps·progress
│                           #   폴더마다 README.md가 주제별 색인 — 새 문서 위치는 dev/README.md 참조
├── skills/                 # Claude Code Skills (원주인 로컬 전용 — 의도적 추적 해제, 이 머신에 없어도 정상)
├── .claude/commands/       # 슬래시 커맨드 (동상 — dev/와 같은 부류)
└── .claude/docs/           # 상황별 지침 (CI 계약·성능 기준·설계 § 지도 — 해당 작업 전 필독)
```

- **AGENTS.md는 gitignore된 per-machine 생성물**(OMC deepinit) — 갱신은 이 머신의 문서 정확성용일 뿐, 커밋/PR에 포함하려 하지 말 것

## 코딩 컨벤션

### 주석·문서의 주장 (0089 에서 15건 실측)

주석과 문서는 **검증되지 않은 주장을 싣는 자리**다. 아래는 규칙이 없어서가 아니라 규칙이 _wiki 편집_ 절에 있어서 코드 주석에 적용된다고 읽힌 적이 없어 생긴 결함들의 대책이다. 근거는 `dev/impl-notes/0051-checks-that-cannot-fail.md`.

- **전칭 한정사(`전부`·`만`·`항상`·`뿐`·`유일한`·`못 한다`)는 주장이다.** 열거하거나 구조적 논거로 확인하고 **코퍼스와 그 경계를 함께 적는다.** 얼버무리지 말 것 — 근거 있는 전칭이 모호한 문장보다 낫다
- 입력을 **신뢰**하거나 게이트를 **제거**하는 것을 허가하는 전칭은 **열거**해야 한다. **거부**만 정당화하는 전칭은 명명된 코퍼스로 족하다 — 단 실패가 **조용하면** 그것도 열거한다
- 규칙은 **저자가 우리 코드를 읽어서 확인할 수 없는 주장**에 발동한다(파서·브라우저·컴파일러). ‼️ 우리 코드를 읽어 확인하는 것으로는 부족하다 — 관문이 옳아도 **모든 입력이 거기 도달하는지**는 다른 질문이다(실측: `verify.ts` 의 `!important` 검사는 옳았고, css-tree 가 중첩 규칙을 `Raw` 로 남겨 선언이 그 검사에 **도달하지 않았다**)
- **위치·개수·코퍼스는 쓰는 그 순간 파일에서 전사한다** — 기억에서도, 문서에서도 아니다. **자기가 쓴 문서도 포함한다**(실측: 스스로 "변경 전 숫자" 라고 적은 표에서 베낀 행 번호가 그대로 커밋됐다)
- **측정 출력을 산문으로 요약한 뒤 그 산문에서 추론하지 말 것.** 복수가 붕괴하는 자리가 문장이다 — "전부 재귀하지 않는다" 는 스캔 **하나**를 보고 쓴 문장이었고, 여덟 중 셋이 달랐다
- ‼️ **자기가 서술하는 파일 안의 인용은 스스로를 무효화한다.** 행 번호를 측정해 적으면 그 문단이 행을 민다 — 쓴 **뒤에** 다시 재거나, **표류하지 않는 좌표**(행 번호 대신 속성·심볼 이름)를 고른다
- **수정도 새 주장이다** — 고친 문장은 원본의 강도로 검증한다
- **인접은 범위가 아니다** — 둘 이상의 문장 위에 있는 주석은 **어느 것을 지배하는지 명시**한다. 범위가 모호한 주석은 저자가 의도한 것과 **정반대** 결정을 부른다(실측: `}` 균형에 대한 주석이 그 아래 두 호출 위에 있었고, 둘째가 빼면 33개가 열리는 관문이었다)
- **통과한 테스트는 "무엇이 이것을 실패시키는가" 에 답할 수 있어야 한다.** 답이 없으면 공허할 수 있다 — 가설을 **가르는** 프로브를 따로 돌린다. 부정 단언에는 그 메커니즘이 작동함을 보이는 **긍정** 단언이나 원본을 고정하는 형제 테스트가 짝지어져야 한다
- **조용히 덜 매치하는 스캔을 조심할 것**: `grep -- "$x" path --include=…`(`--` 가 옵션 파싱을 끝내 필터가 경로가 된다) · `className="…"` 만 매치(`={…}` 누락). 코퍼스 스캔은 `find … | xargs grep -F`
- **`stylelint --fix` 는 CSS 주석 안의 `<` 를 `\3c` 로 바꾼다** — `/* append a <style> */` → `/* append a \3c style> */`. CSS 주석에서 태그 이름은 산문으로 쓸 것

### TypeScript

- strict mode 필수
- `verbatimModuleSyntax` 활성 — 타입 전용 import는 반드시 `import type` 사용
- `npm run typecheck`는 3개 프로젝트(앱 / node 도구 / 테스트)를 모두 검사 — 테스트 코드도 타입 검사 대상
- React: 함수형 컴포넌트 + Hooks only (class 컴포넌트 사용 금지)
- 파일명: kebab-case (`math-block.ts`)
- export: PascalCase for 컴포넌트/Extension (`MathBlock`), camelCase for 함수/훅
- 타입: 인터페이스 우선, `I` 접두사 사용하지 않음
- **파일 크기**: 단일 파일 ~300줄 이하 유지. ~500줄 초과 시 집중 서브모듈로 분리
  - 단, Rust in-file `#[cfg(test)]`·사고 이력 주석은 카운트 제외하고 판단. **분리 금지 판정 파일**(응집이 본질): FileTree.tsx, viewport-virtualize.ts, vim/adapters/operations.ts, plugins/types.ts(공개 .d.ts 계약), plugin-loader.ts 동시성 클래스, Rust authorizer/task/write/logging
  - **부분 분리 완료·잔여는 응집 판정**(PR 519): mermaid-block-view.tsx(13-state 코어+훅 순서 계약), md-to-pm.ts(상호 재귀 블록 워커+공유 루프 카운터), App.tsx(useEditor 안정성 계약+keepalive/fileOps/navigation 순환 매듭) — 추가 분리는 시그니처 변경이 필요한 재설계
- **Zustand 셀렉터**: 컴포넌트에서 `useStore()` bare call 금지. 반드시 `useShallow((s) => ({...}))` 셀렉터 사용 — `eslint.config.js` 의 `no-restricted-syntax` 가 인자 없는 `use*Store()` 를 error 로 막는다(#267). action 만 필요하면 `useXStore.getState()`. 규칙은 이름으로 판정하므로 **Zustand hook 은 반드시 `use…Store` 로 이름 짓는다** — `src/__tests__/bare-store-lint-rule.test.ts` 가 `create` 로 만든 hook 전부를 훑어 고정한다
  ```ts
  import { useShallow } from "zustand/shallow";
  const { foo, bar } = useUIStore(
    useShallow((s) => ({ foo: s.foo, bar: s.bar })),
  );
  ```
- **고빈도 경로의 store write는 동등성 관문 필수**: 값이 같으면 `set`을 호출하지 말 것 (partial은 새 root가 되어 모든 리스너를 깨운다)
- **Tauri 이벤트 cleanup**: `createLLMStream()` 반환값은 반드시 `try/finally`로 호출할 것 (`.catch()` 단독 사용 금지)
  ```ts
  const cleanup = await createLLMStream(id, { ... });
  try { await llmComplete(...); } catch { ... } finally { cleanup(); }
  ```
- **`openUrl()`(plugin-opener)은 capability `opener:default` 범위인 http·https·mailto·tel만 연다** — 다른 scheme은 Tauri ACL이 거부한다. 테스트에서 mock `openUrl` 호출을 단언해도 실제로 열린다는 증거가 아니다
- **export 경로는 둘이다**: HTML·PDF는 `captureEditorHTML`(에디터 DOM 복제 — 후행 패스 `resolveVideoSources`가 `<a>`를 새로 만드니 최종 정리는 `innerHTML` 직전), Pandoc·Notion은 `serializeLiveDoc` markdown 직행. 출력 정책은 두 경로에 각각 걸어야 한다(#527) — 링크 정책은 `src/utils/export/`의 DOM 쪽 `export-html-links.ts`, markdown 쪽 `export-markdown-links.ts`(변환기·mermaid 자산 재작성 뒤 **마지막** 패스)에 있다. 새 export 경로나 후행 패스를 추가하면 그 뒤에 다시 걸 것. Pandoc 이미지 정책(#545)은 **세 층**이고 각 층은 앞 층을 신뢰하지 않는다 — frontend `export-markdown-images.ts`(UX: 문자열로 판정해 alt 텍스트로 degrade, `<img>` 태그도 여기서 markdown 이미지로 — 단 html 노드가 `export-html-fragment.ts`의 지원 문법(태그·주석·캡션 글뿐) 안일 때만, 밖이면 노드 통째로 불변 + 별도 toast; 빠진 개수는 toast), Rust `src-tauri/src/export/pandoc_images.rs`(경계: canonical 경로로 재판정·tempdir 복사), 그리고 `pandoc.rs`가 export마다 생성해 `--lua-filter`로 넘기는 Lua 정책 필터(마지막 관문: pandoc이 파싱한 Image가 묶인 경로 집합 밖이면 alt, Link scheme 정책, raw HTML 제거·`<br>`만 LineBreak, 파일을 가리키는 metadata key 제거 — `<div>` 안 markdown처럼 문자열 패스가 못 보는 것을 잡는다). 새 이미지 입구는 세 층에 다 걸고, pandoc이 파일을 읽는 새 채널(writer 옵션·metadata key)은 Lua 필터와 extra-arg allowlist에 걸 것
- **공유 유틸리티 위치** — 로컬 재구현 금지:
  - `basename()` / `dirname()` → `src/utils/path-utils.ts`
  - Journal 날짜 regex → `src/utils/journal/journal.ts` (`JOURNAL_FILENAME_RE`, `JOURNAL_DATE_PARTS_RE`, `JOURNAL_FILENAME_COMPACT_RE`)
  - `fuzzyMatch()` → `src/utils/file-search.ts`
  - `RightPanelMode` / `SidebarPanel` 타입 → `src/stores/ui/ui.ts`
  - PM 뷰 포커스 → `src/utils/editor/focus-editor-view.ts` (`focusEditorView`) — bare `view.focus()`는 non-editable 뷰에서 no-op
  - 링크 destination 정책 → `src/utils/link-href.ts` (`isAllowedLinkHref`) — `<a href>`로 내보내거나 opener에 넘기기 전 판정. 문서 모델은 건드리지 않는다(byte-exact roundtrip). 거부되면 `href` 대신 inert한 `data-href`로 렌더(클립보드 복원·CSS 훅)하고 export scrub이 제거한다. scheme allowlist는 HTML 블록 sanitizer(DOMPurify 기본)와 동일 — regex/substring 검사로 재구현 금지(`java\tscript:` 우회)
- **i18n(en/ko.json) 키는 알파벳 정렬** — 추가 시 정렬 자리에 삽입, 두 카탈로그 동시(parity 테스트 있음)
- **공개 문서 편집**은 `site/src/content/docs/{en,ko}/docs/**` 에서 한다 (`docs/*.md` 는 이주 후 삭제됐다). prettier·lint 대상 밖이고 검증은 **`cd site && npm run verify`** — 빌드 · 산출물 게이트 · 페이지 게이트 · 테스트 · `astro check`. `pages.yml` 이 `site/**`·`docs/**` PR 에서 돌린다
  - **새 페이지를 만들면 `site/ia-tree.mjs` 의 `PAGES`·`TITLES` 에 등록해야 한다** — `check:pages` 가 매니페스트↔디스크 양방향을 실패시킨다. 페이지 크기는 40~200줄(예외는 그 스크립트에 이유와 함께 명시)
  - 내부 링크는 `/en/docs/<slug>/#anchor` 형태다 — 커스텀 도메인(`baram.ing`) 이후 base 세그먼트가 없다(`site/help-routes.json` 이 출처, 리포명 아래로 서빙되던 시절의 `/baram/…` 가 아니다). 코드에서 URL 을 만들 때는 `site/routes.mjs` 의 `withBase`·`BASE` 를 쓴다 — 각자 문자열을 이어붙이면 base 누락이 한 소비자에게만 생긴다(Astro redirects 가 실제로 그렇게 깨졌다). 앵커 slug 는 Starlight 의 github-slugger 가 정하고, 빌드의 `starlight-links-validator` 가 깨진 링크·앵커를 실패시킨다 — 실제로 이주 때 `invalid hash` 를 전부 잡았다
  - **앱 Help URL 은 `src/utils/help-urls.ts`** 이고 `site/help-routes.json` 과 짝이다. 한쪽만 바꾸면 앱이 404 를 연다 — `help-urls.test.ts` 가 그 JSON 에서 파생 검증한다
  - **원문(en)을 기계적으로 일괄 편집하면 한국어 번역이 전부 "낡음"으로 뒤집힌다** — 신선도 판정은 ko 프론트매터의 `sourceHash`(번역 시점 en 파일 **전체**의 해시)와 현재 해시를 비교하므로, 링크 치환·경로 변경처럼 산문과 무관한 편집도 독자에게 낡음 배너를 띄운다. **`npm run verify` 는 이걸 못 잡는다** — 판정은 보고만 하고 종료 코드를 내지 않는다(게이트는 `check-pages.mjs` 하나로 몰아 둔 설계). 원문을 손댄 PR 은 `cd site && npm run i18n:status` 를 따로 볼 것. 번역이 같은 편집을 함께 받았다면 `npm run i18n:stamp -- --all` 로 되돌리되, 스탬프를 덮는 것은 '번역을 원문에 맞게 고쳤다'는 선언이므로 **원래부터 낡았던 페이지가 섞여 있지 않은지 먼저 전수 확인**할 것 (도메인 이전 PR #605 가 실제로 27개를 이렇게 뒤집었다)
- **개발자용 wiki 편집**은 `wiki/*.md` 에서 한다 — 리포 안 소스이고 `npm run lint`(→ `lint:wiki`)가 검사하며, main merge 시 `wiki.yml` 이 `baram.wiki.git` 으로 게시한다. **GitHub wiki 에서 직접 편집하지 말 것** (다음 게시가 덮는다). 설계·결정은 `.docs/decisions/2026-09-12-vim-wiki-structure.md`
  - **wiki 는 합성·색인 레이어다** — 거의 변하지 않는 것(아키텍처 불변식·결정과 근거·전쟁 기록)만 직접 싣고, 자주 변하는 것은 canonical 한 집을 가리킨다: 사용법 → `site/`, 구현 현황 → 이슈, **파일 경로 → `Vim-Code-map.md` 한 페이지에만**. 숫자(줄 수·개수)와 "예정·대기·진행 중" 을 쓰지 않는다
  - 페이지 이름이 곧 계층이다(`Vim Architecture` → `Vim-Architecture.md`). GitHub wiki 는 폴더 계층이 없고 이름이 전역 유일해야 한다. 내부 링크는 확장자 없이 `[텍스트](Page-Name)`, `[[…]]` 는 게이트가 거부한다. 페이지 40~200줄
  - **`.docs` 를 증류할 때 한정절이 사라진다** — 실측 사례: 검증 가능한 주장 70개 중 11개가 결함이었고 셋은 `.docs` 가 범위를 명시 한정한 것을 wiki 가 일반화한 결과였다. **규칙은 위 "주석·문서의 주장" 절에 있다** — wiki 만의 규칙이 아니라 주석·설계서·PR 본문에 모두 걸린다(그 절이 생긴 이유가 여기 묻혀 있어서 코드에 적용된다고 읽힌 적이 없다는 것이다). 이 항목의 실측 근거: 11건을 고쳤더니 새 오류 10건. 함정 상세는 `.docs/gotchas.md` "문서 수정 — 고치는 문장도 새 주장이다"
  - **페이지 이름을 바꾸지 말 것** — GitHub wiki 에는 리다이렉트가 없다. 이슈·PR·채팅에 남은 외부 링크가 전부 404 가 되고 게이트는 내부 링크만 본다. 이름이 정말 틀렸으면 새 페이지를 만들고 옛 페이지를 한 줄 포인터로 남긴다
  - **wiki 에서 직접 편집한 내용은 다음 게시가 조용히 덮는다** — 편집자에게 알림이 가지 않는다. `_Footer.md` 가 경고하지만, 누가 그렇게 편집한 것을 발견하면 그 내용을 `wiki/` 로 옮긴 뒤 게시할 것
  - **새 페이지를 쓰면 그 페이지가 이름 붙여 설명하는 동작의 집이 Code map 에 있는지 확인할 것** — 게이트의 전수 검사는 `src/extensions/plugins/vim/**` 과 basename 이 vim 인 파일까지고, 그 밖의 협력자(`use-source-mode.ts` 등)는 사람이 고른 목록이라 누락을 게이트가 못 잡는다
- **단축키 추가**: `keybinding-registry.ts` 등록이 규약(Settings 표시·리매핑 가능) — menu.rs accelerator만 달면 안 보인다. 네이티브 accelerator는 DOM과 별개 레이어라 조건부 양보 불가·리바인드 후에도 fallback 잔존; registry 경로는 상위 stopPropagation에 자동 양보된다. 충돌 조사 필수(Ctrl+R=vim redo, Mod+Shift+R=Memories 등) — 함정 상세는 menu.rs 상단 주석
- **perfectionist autofix는 주석을 안 옮긴다** — sort-modules는 doc 주석-함수 짝을 깨고, sort-imports는 파일 헤더 주석 **위로** import를 올린다. `--fix` 후 diff로 주석 위치 확인 (분리 캠페인 한 세션에서만 사고 6건) · sort-modules는 모듈 레벨 함수 선언도 알파벳 순을 요구한다 — helper를 추가할 때 자리를 맞출 것
- **madge --circular는 dynamic import·`import type`도 간선으로 센다** — 순환 판단은 static 값 간선만 손으로 분류해서 (TDZ 위험은 static 간선만이 만든다)
- **CSS 변수 네이밍**: `--color-{category}-{qualifier}` 패턴. **category는 정해진 9개뿐이다** — `accent` `bg` `border` `callout` `editor` `git` `graph` `status` `text` (`tokens/semantic/color-light.json`이 canonical). 위험/오류색은 `status` 아래에 있다: `--color-status-danger` (`--color-danger-*`는 없다)
- **공유 CSS 유틸리티**: `base.css`의 `.btn-unstyled`, `.flex-header`, `.text-truncate`, `.icon-btn`, `.flex-col` 사용
- **Shadow 토큰**: `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`
- **CSS 파일 크기**: 단일 CSS 파일 ~1,500줄 이하 유지

### Rust

- 모듈 구조: `mod.rs` 패턴 사용
- zip 추출은 `fs/archive.rs`의 `ExtractBounds` 공용 코어 경유 (6종 폭탄 방어 — fs·plugin 공유; 경로 봉쇄는 호출자 책임)
- 에러 처리: `thiserror` crate으로 커스텀 에러 타입 정의
- IPC 커맨드: `Result<T, String>` 반환 (Tauri 직렬화 제약)
- **링크 index 와 rewriter 는 `md::literal` 을 통과한다 (#620)**: `[[…]]`·`((…#^id))` 후보는 regex 로 찾되, 매치 **구간**을
  `Literal::overlaps` 로 검사해 코드·HTML·수식·이미지·링크 정의 안이면 버린다 — 점 검사 금지(`((n#^id|`x`))` 처럼 걸치는 후보는
  불변), 줄 단위 스캔은 `content.lines()` 가 아니라 `source_lines`(CRLF 에서 오프셋이 샌다). frontmatter 는 잘라내되 텍스트(속성
  링크는 링크). 프런트 `block-id-rename-markdown.ts` 와의 계약은 `src-tauri/src/md/fixtures/literal-regions.json` 이 양쪽에서 읽힌다.
  tag·task 스캐너의 느슨한 fence 규칙은 별개 계약이라 여기 얹지 말 것
- **파일 rename 은 index 가 세는 것을 전부 고치거나, 못 고친 것을 보고한다 (#678)**: 불변식 셋이다 — ① index 가 세는 것 = rename 이 고치는 것, ② 문법이 쓸 수 없는 이름은 쓰지 말고
  남긴다, ③ 남긴 것은 보고한다.
  - ‼️ **링크 종류를 더하면 ①이 먼저 깨진다** — `mod.rs` 의 `incoming` 은 `extract_links` 가 내는 **모든** 항목을 `filing_key` 가 준 키 아래 담으므로 새 종류는 추출되는
    순간 바구니에 들어오는데, `rewriter.rs` 의 치환은 문법별 패스의 합집합이다. 그래서 종류는 문자열이 아니라 `mod.rs` 의 `LinkKind` 다 — `link_kinds!` 한 목록이 enum 과 테스트용
    `ALL` 을 함께 만들고, `LinkKind::pass()` 가 `_` 없는 `match` 로 종류마다 패스를 지정하며, `rewriter.rs` 의 후보 필터 둘은 그 `pass()` 를 읽는다. 변형을 더하면
    `pass()`·테스트의 `spelled()` 에서 **컴파일이 멎는다**. 컴파일러가 못 보는 나머지 반 — 지정한 패스의 regex 가 정말 그 문법을 읽는가 — 는 `mod.rs` 의
    `every_reference_the_index_files_under_a_stem_is_visited_by_one_rewrite_pass` 가 `ALL` 로 픽스처를 짜서 개수로 비교한다(실측: `@@target@@`
    종류를 BlockReferences 에 배선하면 3 != 4. `<<target>>` 은 literal 분석이 HTML 로 읽어 색인되지 않으니 프로브로 쓰지 말 것). 손댈 곳 순서: `LinkKind` 변형 →
    컴파일러가 가리키는 `pass()`·`spelled()` → `extractor.rs`(regex + arm) → 그 패스의 regex 가 새 문법을 읽게(못 읽으면 위 테스트) → `…_can_spell` →
    `own_block_reference_lines`(같은 stem 예외가 새 종류의 자기 참조를 놓치면 과소 계수). ② 의 판정은 두 층이다 — stem 만 보는 `…_can_spell`(본체는 문자 열거가 아니라
    `link_reads_back_as_the_file`)과, 두 패스가 낸 내용을 `extract_links` 로 **되읽는** `index_reads_the_rename_back`(`LinkPasses::rewrite`).
    술어를 통과한 stem 도 referrer 줄의 백틱과 짝을 지어 링크를 literal 로 만들 수 있고, 그건 stem 이 아니라 **줄**의 성질이라 되읽어야 보인다. ③ 의 `skipped.push` 는 한 곳이
    아니다 — `rename/referrers.rs` 에 referrer 의 원인마다 하나씩(덮는 context 가 없는 referrer 도 그중 하나다)과 `rename/passes.rs`(rename 되는 노트);
    `LinkPasses` 는 `left_behind` 플래그만 세운다
    ‼️ **② 의 두 층(`…_can_spell`·`index_reads_the_rename_back`)은 파일 rename 입구에만 있다** — 디렉터리 rename 이 `relative_links.rs` 로 고쳐 쓰는
    `[[./x]]`·`[[../x]]` 는 거치지 않고(폴더를 `C# notes` 로 바꾸면 `[[./C# notes/x]]` 가 쓰여 `./C` 로 읽힌다 — 실측), block ID rename 의 새 id 는 프런트
    `BLOCK_ID_PATTERN` 이 거르며 Rust 는 재검증하지 않는다. 프런트의 블록 메뉴 "링크 복사" 도 판정 없이 쓴다. 링크를 쓰는 입구를 더하거나 고칠 때 이 층을 같이 걸 것
  - ‼️ **index 의 키는 `filing.rs` 가 정한다 (#619)** — `incoming` 의 키는 문자열이 아니라 `FilingKey`(`Stem`·`Path`·`Foreign`)다. 참조를 키로 바꾸는 함수는
    `filing_key` 하나다 — filing(`file_incoming`), rewriter 판정(`RenameTarget::judge`·`BlockTarget::judge` 가 함께 쓰는 `keyed_under`,
    모호성 판정 `read_as_another_note`), 되읽기 관문(`index_reads_the_rename_back`)이 모두 그것을 부른다. 파일이 읽히는 키는 `keys_for` 가 낸다 —
    조회(`filing_keys_of` 를 거치는 `referring_lines_to`, `backlink_keys` 를 거치는 `get_backlinks`·`block_reference_lines`)와 block ID
    rename 의 `block_target`. 그래서 `[[dir/note]]`·`[[./note]]`·`((dir/note#^id))` 같은 경로·상대 참조도 백링크이고 두 rename 이 고쳐 쓴다.
    키 모양을 `keys_for` 밖에서 따로 짓는 자리 목록, `FilingKey` 를 가르는 `match` 가 컴파일을 멈추는 자리, `mod.rs` 의 개수 게이트 둘이 잡는 범위는 `filing.rs` 모듈 doc 에
    있다 — 새 키 모양이나 표기를 더하기 전에 읽을 것.
    키는 **등록된 root 표기에 대해 어휘적으로** 계산한다 — symlink 인 root 의 다른 표기(`/tmp` 에 대한 `/private/tmp`)로 주어진 파일은 `Path` 키를 얻지 못해 경로 링크가 **놓칠
    뿐** 잘못 고쳐 쓰이지는 않는다
  - 링크가 이 파일을 가리키는지(match)는 referrer 를 **덮는** root 의 index 로만 판정한다 — `/v` 와 `/v/sub` 가 둘 다 root 일 때 `/v/r.md` 의 `[[a/old]]` 는
    `/v` 아래에서만 읽혀 `/v/a/old.md` 를 가리키므로, 자식 root 아래 경로가 같은 `/v/sub/a/old.md` 의 rename 은 그것을 **고치지 않는다**
    (`service/tests/nested_roots.rs` 의 `nested_roots_a_rename_leaves_the_parents_colliding_link_alone`). 되읽기 관문도 덮는 root 마다 따로
    읽는다. ‼️ **경로 링크를 다른 root 가 실재하는 다른 노트로 읽으면 고치지 않고 보고한다** — 두 root 가 함께 덮는 `/v/sub/r.md` 의 `[[a/old]]` 는 자식 아래에서
    `/v/sub/a/old.md`, 부모 아래에서 `/v/a/old.md` 다. 둘 다 있으면 어느 쪽을 rename 하든 그 링크는 **모호하므로 그대로 두고** 파일을 `skipped_files` 에
    올린다(`judgement.rs` 의 `Judgement::Ambiguous`·`read_as_another_note`). 부모에 `a/old.md` 가 없으면 모호하지 않으므로 고쳐 쓴다. 한 root 안에서도 같다 —
    대소문자를 지키는 파일 시스템에서 `A/note.md` 와 `a/note.md` 는 둘 다 `Path("a/note")` 로 접히므로 `[[A/note]]`·`[[a/note]]` 는 어느 한쪽의 링크가 아니다.
    `registered_path_keys` 가 키마다 그리로 접히는 노트 수를 내고, 둘 이상이면 그 키로 읽히는 경로 링크는 모호하다. referrer 와 파일을 담는 root 가 하나뿐이면 다른 root 의 읽기가
    없으므로 겹치는 키만 모은다(`colliding_path_keys` → `RootNotes::Sole`) — index 잠금 아래에서 노트마다가 아니라 이름이 같은 노트마다 키를 짓는다. 존재 판정은 rename 되는
    파일이나 referrer 를 **담는 모든 directory context** 의 노트 목록(`LinkIndex::registered_path_keys`)으로 한다 — rename 되는 파일의 context 만이 아니다.
    부모의 `a/old.md` 를 rename 할 때 자식 root 는 그 파일을 담지 않지만 referrer 를 담는다. 한 번도 열리지 않아 index 가 없는 context 는 판정 전에 **그 자리에서 build
    한다**(`service/rename/scope.rs` 의 `holding_contexts` → `ensure_indexes`). build 할 수 없으면 그 root 는 `RootNotes::Unknown` 이 되어 그
    root 가 읽을 수 있는 경로 링크는 **그대로 두고 파일을 보고한다** — 비어 있다고 가정하지 않는다(`known_paths_of`). referrer 를 담는지는 `contexts_containing` 으로 찾고,
    판정 안에서는 root 표기에 대해 어휘적으로 본다. bare 이름(`[[old]]`)은 이 판정 밖이다 — stem 은 모든 root 에서 같게 읽히고 rename 은 그것을 고쳐 쓴다
  - **vault 자신의 alias(`[[work::note]]`, §87)는 등록된 vault 들 사이에서 대소문자 무시로 유일한 alias 일 때만 로컬이다 (#717)** — `service/keys.rs` 의
    `local_aliases_of`. journal·zettelkasten space 는 vault type 으로 `Journal::`·`Zettel::` 에도 답한다 — 같은 유일성 규칙 아래이고(두 journal
    space 면 둘 다 외부), 어느 vault 든 그 이름을 explicit alias 로 달면 그 alias 가 이긴다 (`findAliasContext` 의 두 패스, 이름 짝은 `keys.rs` 의
    `space_names_match_the_frontends` 가 고정). 다른 vault 가 같은 alias 를 달고 있으면(`work` 와 `work`, 또는 대소문자만 다른 `Work`) 그 alias 는 **모호하므로
    양쪽 모두에게 외부다** — 프런트 `findAliasContext` 는 대소문자 무시로 목록의 첫 context 를, backend alias 맵은 정확한 문자열로 마지막 등록을 고르니 둘이 다른 vault 를 가리킬 수
    있다. 그런 링크는 rename 이 건드리지 않고 백링크도 주장하지 않는다 — 단 그 이름이 자기 vault 의 것이면 그 referrer 를 `skipped_files` 로 보고한다(모호한 경로 링크와 같은 규칙, 고쳐 쓴 파일이어도). alias 맵의 소유(`resolve_alias`)로 판정하지 않는다 — last-writer-wins 맵은 낡는다(나중 vault 가 이름을
    가져간 뒤 제거되면 맵 항목이 사라져, 이제 그 이름을 단 유일한 vault 도 외부로 남는다). 등록은 rename 이 **시작할 때** 한 번 읽으므로 rename 도중의 등록은 보이지 않는다. 로컬 alias 는
    `LocalAlias { alias, root }` 로 다니고, alias 뒤 경로의 `Foreign` 키는 읽는 index 의 root 가 아니라 **그 alias 가 가리키는 vault 의 root 로** 계산한다 —
    중첩 vault 에서 부모의 `[[p::a/old]]` 가 자식의 `a/old.md` 로 읽히지 않게. block reference·embed 문법에는 alias 자리가 없어(`extractor.rs` 의
    `BLOCK_REF_RE`·`BLOCK_EMBED_RE`) block ID rename 은 alias 를 넘기지 않는다
  - **파일 rename 은 디렉터리를 바꾸지 않는다** — `rename/destination.rs` 의 `stays_in_its_directory` 가 부모가 다르면 쓰기 전에 `Err` 를 낸다. 경로·상대 참조는 노트를
    지금 자리로 부르고, 이동은 옮겨진 노트 자신의 상대 링크까지 고쳐야 하므로 별도 패스다. 부모는 resolve 한 것이 아니라 **적힌 대로** 비교한다 — respell 이 `new_path` 의 성분을 링크에 쓰므로,
    resolve 하면 같은 폴더인 `a/../a/new.md` 도 `[[a/../a/new]]` 를 써 아무 노트도 가리키지 않는다. 그래서 두 rename 은 절대 경로가 아닌 경로를 먼저 거부한다
    (`rename/mod.rs` 의 `absolute`) — 상대 경로는 작업 디렉터리 기준으로 resolve 되어 적힌 비교를 빠져나간다. 목적지에 **다른** 디렉터리 항목이 있으면
    거부한다(`another_entry_at`, 이동 직전에 판정). 같은 항목인지는 **마지막 성분을 따라가지 않고** 본다 — Unix 에서는 `symlink_metadata` 의 dev·inode 가 같고 이름이
    ASCII 대소문자만 다를 때(대소문자를 접는 파일 시스템의 `Note.md` → `note.md`)만 같은 항목이다. **ASCII** 대소문자만 본다 — `Élan.md` → `élan.md` 는 그 파일 시스템에서
    목적지가 있고 이름 비교에 걸려 거부된다. 같은 inode 에 ASCII 대소문자 이상 다른 이름은 hard link 라 거부한다. 대소문자를 지키는 파일 시스템에서 이름이 ASCII 대소문자만 다른 hard link 는
    두 읽기로는 case alias 와 구별되지 않아 **통과한다** — 이동은 no-op 이고 `Ok` 를 내며 링크는 respell 된다(내용 손실은 없다). 가르려면 파일 시스템이 대소문자를 접는지 물어야 하고, 아직
    하지 않았다. resolve 한 경로로 비교하면 `note.md -> x.md` 를 `x.md` 로 바꾸는 rename 이 진짜 `x.md` 를 링크로 덮는다. Windows 에는 inode 비교가 없어 이름이 ASCII
    대소문자만 다르고 두 경로를 `canonicalize` 한 결과가 같고, `canonicalize` 가 링크를 따라가므로 두 항목이 둘 다 링크이거나 둘 다 아닐 때만 같은
    항목이다(`same_entry_by_canonical`) — 대소문자를 구분하는 폴더에 `Note.md` 와 `note.md` 가 함께 있으면 두 경로로 갈려 거부된다. hard link 도 두 이름이 두 canonical
    경로로 갈려 거부될 것으로 본다(std 의 `GetFinalPathNameByHandleW` 사용에서 읽은 것, Windows 호스트 미검증). 그 API 가 두 링크에 이름 하나를 준다면 rename 이 통과해 목적지를
    덮고, 이름 하나가 사라질 뿐 내용 손실은 없다. 목적지의 **dangling symlink** 도 항목이라 거부한다 — 따라가는 `Path::exists` 로 보면 그것을 덮어쓴다.
  - index 는 노트를 **경로가 resolve 되는 곳으로** 안다 — build 는 symlink 항목을 색인하지 않고(`collect_md_files` 가 `metadata()` 로 링크를 따라가지 않는다) save 는
    resolve 한 경로로 넣는다(`service/state.rs` 의 `Mutation::update`). 파일 rename 도 같아서 옛 경로가 이동 전에 resolve 되던 곳을 빼고, 새 경로가 **이동 뒤에**
    resolve 되는 곳으로 넣는다 — symlink 인 노트는 대상 아래 그대로다. 경계는 반대로 **항목 자체**(canonical 부모 + 적힌 이름, `entry_path`)도 안이어야 한다 — 옛 경로는
    항목으로(`rename/destination.rs` 의 `entry_confined`; resolve 한 파일은 `owning_contexts` 가 이미 그 경로로 context 를 찾았으니 안이다), 새 경로는
    resolve 한 파일과 항목 **두 관점 모두**로(`confined_both_ways`, 이동 전과 노트를 쓰기 직전). rename 은 항목을 옮기고 그 항목을 통해 쓰므로, vault 밖의
    `/outside/Link.md` 가 vault 안을 가리켜도 거부한다(대소문자를 접는 파일 시스템의 case-only rename 이 그 링크를 vault 밖의 일반 파일로 바꿔 쓰는 구멍을 막는다)
  - **`rename/file.rs` 를 베껴 "폴더로 이동" 을 만들면 상대 경로 링크가 조용히 끊긴다** — 베낀 코드는 먼저 위의 `Err` 에 막히고, 그것을 떼어도 두 패스는 옮겨지는 노트를 **가리키는** 참조만
    고친다(옮겨진 노트 자신에게 도는 `rewrite_renamed_note` 도 같은 `passes.rewrite` 다). 이동은 stem 을 바꾸지 않아 `stem_unchanged` 가 `Unchanged::Ignore`
    로 간다. `rewrite_relative_wikilinks` (호출자는 `rename/namespace.rs` 하나)도 답이 아니다 — 그건 _옮겨진 디렉터리로 들어가는_ 링크를 고치지, 옮겨진 노트 자신의
    `[[./sibling]]` 을 고치지 않는다
- **vault 경계는 자기를 인가할 수 없다 (§329–§336)**: 웹뷰가 준 경로로 asset scope를 부여하는
  커맨드는 부여 **전에** `approval_cmd::ensure_approved`를 통과해야 한다. 승인 기록은 Rust 소유
  `{app_data_dir}/approved-roots.json` — `config.json`은 웹뷰가 임의 키로 쓸 수 있어 거기 두면 무효다
  - `Scope::forbid_*` **호출 금지**: 영구적이고 allow보다 우선하며 해제 API가 없다 — 회수가
    그 세션의 재승인까지 죽인다. `approval/mod.rs`의 `no_new_scope_forbid_call_anywhere_in_the_crate`가 막는다
  - 새 `allow_directory`/`allow_file` 호출부는 `no_new_asset_scope_grant_outside_the_allowlist`가
    깨뜨린다. allowlist에 넣기 전에 게이트를 먼저 달 것 — **입구 열거가 다섯 번 틀렸고**, 매번
    심볼 grep이 아니라 효과 grep·전수 스캔이 잡았다

### Extension

- 모든 Tiptap Extension은 `Node.create()` / `Mark.create()` / `Extension.create()` 패턴
- 반드시 라운드트립 테스트(`__tests__/{name}.test.ts`) + 파이프라인 변환기(`pipeline/transformers/{name}-transformer.ts`) 포함
- `registry.json`에 메타데이터 등록 필수
- **NodeView chrome의 문서 속성 커밋은 `updateNodeAttributesWithVim`(vim-keys.ts) 하나로** — 이 헬퍼가 `canUseEditorChrome` 관문이고 dispatch 여부를 boolean으로 돌려준다. 커밋 성공을 전제로 로컬 상태를 바꾸는 호출자(dirty 해제·모달 닫기·builder 미러)는 반드시 반환값으로 분기할 것 — 거부 시 조용히 넘어가면 "저장됨" UI와 문서가 어긋난다(#531)

### 로컬 실행

- **프로젝트 루트에서** `npm run dev`(백그라운드) + `./src-tauri/target/debug/baram` — `npm run tauri dev`는 cwd가 `src-tauri/`로 바뀐다
- **프런트엔드 출처는 실행법이 아니라 빌드법이 정한다** — `tauri-build`가 `cfg(dev)`를 붙였는지로 갈리고, 바이너리에 고정된다
  - `npm run tauri dev`로 빌드한 바이너리: dev 서버가 서빙 → TS/CSS 변경이 재빌드 없이 반영
  - 맨 `cargo build`로 빌드한 바이너리: 컴파일 시점의 `dist/`를 **내장** → dev 서버가 떠 있어도 무시한다. 프런트 변경을 보려면 `npm run build && (cd src-tauri && cargo build)` 후 재실행
  - 증상: 고친 게 화면에 안 나온다. 확인법은 `lsof -nP -p $(pgrep -f target/debug/baram) | grep 1420` — 연결이 없으면 내장 자산을 쓰는 바이너리다

### 테스트

- **Vitest** (TypeScript 단위/통합) — `npm test` → `vitest run`. `npx jest` 사용 금지 (Babel 파싱 실패)
- **게이트 exit code는 파이프 없이 캡처**: `cmd | tail`은 tail의 exit를 반환한다 — `cmd > /tmp/log; echo $?` 또는 zsh `pipestatus` 사용
- cargo test (Rust 단위) — `npm run rust:test`
- **E2E는 없다**: `tests/e2e/`는 M1(2026-02-14) 스캐폴드 이후 한 번도 채워지지 않아 제거했다.
  Playwright 미설치. 실제 React 트리가 필요한 커버리지는 현재 **비어 있는 구멍**이다
  (`use-auto-save.test.ts`가 save() 전체 흐름을 여기로 미뤄 두었다). 도입하려면 새로 세운다
- **라운드트립 보존이 최우선 품질 기준**: MD → ProseMirror → MD 변환 시 원본과 정확히 일치해야 함
- **성능 회귀 테스트는 타이밍이 아니라 카운트로 고정**: 분절·순회·dispatch 횟수를 세고, 결함 재도입으로 핀 민감도까지 확인. DOM 유지 회귀는 리렌더 전에 잡은 요소의 `isConnected` + 재조회 `toBe` + `MutationObserver` childList 0건으로
- **jsdom 에디터 픽스처**: `focus()`는 DOM에 붙은 요소만 · contenteditable은 `tabindex` 없으면 포커스 불가 · `focusin`은 수동 dispatch · `Range.getClientRects` 없음(폴리필 필요) · 리사이즈 드래그를 mouseup으로 끝내면 `swallowNextClick`이 window capture click 리스너(300ms)를 무장한다 — 다음 테스트 전에 throwaway click으로 소비 · mermaid는 `setNodeSelection`이 render effect를 재실행해 새 svg id가 비동기로 착지한다 — 그 뒤에 요소를 잡을 것
- **리터럴 경로 스캔 테스트**: revocation 테스트 2개·`scripts/rust-constants.ts`는 `src-tauri/src/plugin/mod.rs`를 경로로 읽어 스캔(REVOCATION 상수 3개는 그 파일에 고정), vim `editable-ownership.test.tsx`의 REGISTER_ALLOW는 경로 allowlist — 심볼을 옮기면 컴파일은 통과해도 검증이 조용히 죽는다. 이동 시 스캔 경로 동반 갱신 · 발견한 경로를 문자열 키와 비교하는 스캔은 `path.posix.join`(Windows에서 `join`은 역슬래시)
  - media-toolbar-reveal.test.ts는 소스 텍스트를 스캔해 NodeViewWrapper+MediaToolbar 파일 수 ≥4를 요구 — 뷰에서 toolbar 블록을 다른 파일로 빼면 깨진다
  - pipeline/에 프로덕션 파일을 추가하면 import-boundary의 `MD_TO_PM_ROUTE_FILES` Set(+감사 주석의 개수·날짜)을 갱신해야 한다 — allowlist를 넓히는 우회는 금지. 타입으로만 쓰는 항목은 `{ typeOnly: true }` 로 등록한다 — 값 import 는 red, barrel 재export 는 값 접근으로 판정된다(#637)
  - 반대로 transformer가 `src/utils/`의 leaf 모듈을 import하는 것은 경계 위반이 아니다 — 금지 closure는 `pm-to-md.ts`에서 출발해 `src/pipeline/` 안으로만 BFS한다

### 의존성 관리

- **tiptap 그룹 업데이트**: `@tiptap/*`는 core·extensions·bubble/floating-menu(숨은 멤버)까지 exact-version peer로 묶여 있어 `npm update`/`npm install`이 ERESOLVE로 교착한다. package-lock에서 `node_modules/@tiptap/*` 항목을 삭제한 뒤 `npm install`로 전체 재해결할 것
- 설치 버전 확인은 `npm ls <pkg>` — exports 제한 패키지(@tiptap/react 등)는 `require('pkg/package.json')`이 실패

### Git

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- 커밋 메시지에 설계 문서 섹션 참조 포함 (예: `feat(§5.3): implement KaTeX math block`)
- **§ 번호는 추측 금지** — 커밋 전 대상 파일 헤더 주석 또는 `git log --format=%s -- <파일>`로 실측 (fold=§4.2, slash=§4.6처럼 직관과 다른 경우 다수)
- **커밋 메시지는 미리 검증**: `npx --no -- commitlint < msg.txt`. 본문에서 줄 시작 `단어:`는 footer로 오인되므로 줄바꿈 위치를 조정할 것
- 브랜치: `feature/m2-basic-editing`, `fix/roundtrip-heading-whitespace`
- **pre-push hook**: `npm run lint`(CI lint 잡 전체, knip 포함) + `cargo clippy --all-targets` 실행 — push당 ~2분+, cargo cold면 5~7분. push는 백그라운드로 실행할 것
- **push 전 `npm run lint` 필수**: CI lint 잡은 pre-push hook보다 넓다 — `lint:doc-comments`(doc 주석 바로 뒤 doc 주석 금지, 함수 이동·cherry-pick 시 잘 깨짐)·stylelint·audit까지. "테스트 그린 ≠ CI 그린"
- **PR CI는 브랜치가 아니라 "브랜치+최신 main 머지 트리"를 검증한다** — base가 낡으면 로컬 전부 그린이어도 CI만 깨질 수 있다(옮겨진 심볼 import 등). origin/main 전진을 발견하면 rebase 여부를 논의할 것
  - 사전 검증: `git merge-tree --write-tree origin/main <branch>`(exit 0=충돌 없음) → `git commit-tree <tree> -p origin/main -p <branch> -m tmp` → **메인 worktree에서 `git switch --detach <commit>`** 후 tsc·관련 vitest → 복귀. 별도 worktree에 node_modules를 심볼릭 링크하면 React·`?raw` import 테스트가 로드 단계에서 거짓 실패한다

### 디자인 토큰

- **3-tier 계층**: Primitive (raw values) → Semantic (meaning) → Component CSS
- **소스**: `tokens/*.json` (W3C DTCG) → **빌드** `npm run tokens:build` → `src/styles/generated/` 자동 생성
- **감사** `npm run audit:css-vars` (미정의 CSS 변수 검출) · **Figma export** `npm run tokens:export` → `tokens/tokens-studio.json`
- **Settings store version**: `src/stores/settings/store.ts`의 `version:`이 유일한 출처다 — 여기 숫자를 적어 두면 반드시 낡는다(그렇게 두 번 틀렸다). 새 키를 더할 때 기본값이 오늘 동작과 같으면 마이그레이션이 필요 없다 — 기존 사용자에게 **다른** 기본값을 보여야 할 때만 backfill이 필요하다

## 설계 문서 참조 규칙

구현 시 반드시 해당 설계 문서 섹션을 참조할 것. `§` 번호를 코드 주석과 커밋에 유지한다.
어떤 §가 어느 문서(part1~part20)에 있는지는 **`.claude/docs/design-doc-map.md`** 참조 —
단 이 지도는 20개 중 9개 Part만 싣고 있다. 없으면 `dev/design/README.md`의 목차를 볼 것.

## 성능 기준 (Part 8 §8.4)

핵심: **타이핑 레이턴시 < 16ms** · 10,000줄 파일 열기 < 1초. 전체 지표 표는 **`.claude/docs/performance-budgets.md`** 참조 — 성능 작업·회귀 판단 시 먼저 읽을 것.

## CI/CD 계약 (이슈 207 / PR 208)

PR에서 rust skip이 허용되는 유일한 경우는 "rust 관련 경로를 안 건드린 PR" — 그 외 모든 skip/실패는 빨간불.
릴리스·워크플로(.github/) 작업 전에는 반드시 **`.claude/docs/ci-contract.md`** 를 읽을 것 (reusable workflow 함정, SHA 핀 규칙, 러너 고정 등).

## 현재 Phase 및 마일스톤

- **Phase 1 (MVP, M1~M6)** · **Phase 2 (확장, M7~M9)** — ✅ 완료
- **Phase 3 (고급 기능)** — 진행 중
  - ✅ ~v0.4: 테이블 고급(셀 병합만 — **가상 스크롤 §5.5는 구현된 적이 없고 PR #643에서 제거했다.**
    `content-visibility`는 `<tr>`(internal table box)에 규격상 무효라 동작하지 않았고, 대신 50행부터
    앱을 영구 정지시켰다), 쿼리 블록(§5.13), Git 고급(§67), 파일 스냅샷(§71),
    네임스페이스(§61, P2 보류), Skills 모드(§72), Settings UI 리디자인, 단축키 커스터마이징,
    Heading/List Folding, CSS 디자인 토큰 시스템, Vault System(§80~§90), macOS Universal Binary
  - ✅ **v0.5.0** (2026-07-30): 플러그인 실행 모델 **§260** 6개 페이즈 — trusted/sandboxed 두 티어,
    per-plugin WebviewWindow + Rust `plugin_call` 브로커, 설치 동의 게이트, 앱 커맨드 ACL 락다운.
    파일 뷰어(PDF 읽기 전용 · HTML 샌드박스 프리뷰 · 이미지/SVG media-viewer 플러그인, §69)
  - ✅ **v0.6.0** (2026-08-18): PDF 뷰어 고도화 **§270–§283** (하이라이트·사이드 레일·줌), 파일 트리 §4.3
  - ✅ **v0.6.1** (2026-08-20): 탭 표면 유지 **§284–§291**, 그래프 색 토큰 §30, 단어 수 통일 §4.8
  - ✅ **v0.6.2** (2026-08-23): 동영상 임베딩 **§292–§301**
  - ✅ **v0.7.0** (2026-09-06): 태스크 관리 **§302–§318**, 캡처 → 허브 노트 **§319–§328**,
    vault 경계 인가 **§329–§336**(PR #551), 전 플랫폼 자동 설치 **§206**(PR #560)
  - ✅ **v0.7.1** (2026-09-08): 문서 사이트 Astro+Starlight 이주(57페이지 en/ko) + 커스텀 도메인
    `baram.ing`, 앱 용어 통일·툴바/블록 크롬 i18n, 링크 인덱스 키 #263 · 참조 링크 #546
  - ✅ **v0.7.2** (2026-09-12): `v0.7.1..v0.7.2` 144커밋 — 폰트 시스템 **§346–§354**(번들 서체·
    서체 브라우저·export 반출), 기능 토글 UI 가시성 **§337–§345**, OpenRouter 프로바이더 **§6.3**,
    Pandoc 이미지 정책 3층(#545) · raw 통과 정책(#544). 서명·배포 런북은 `dev/guides/`
  - ✅ **v0.7.3** (2026-09-14): `v0.7.2..v0.7.3` 125커밋, 거의 전부 **수정**이다 — 라운드트립
    데이터 손실 3종(표 셀을 열 폭만큼 공백으로 채워 저장 · 인라인 코드가 공존하는 마크를 삼킴 ·
    마크를 감싼 커스텀 인라인 마크가 되읽히지 않음, #645·#646·#647), 50행 표 영구 정지
    (§5.5 가상 스크롤 제거, #643), 포인터만 지나가도 colwidths를 쓰던 문제(#645),
    Pandoc export 이미지 정책 확장 **§55**(#642), html 블록 src 재해석을 React에서 회수
    (§294, #657), 릴리스 노트를 리포에서 읽기(#641 — 업데이트 대화상자가 처음으로 실제 노트를
    보여 준다), vim wiki(#644). 릴리스 PR #659, 수정 PR #660
  - ✅ **v0.7.4** (2026-09-22): `v0.7.3..v0.7.4` 270커밋, 배포 경로 둘이 열렸다: **테마 배포**
    (§355~§363 — 모델 통일·CSS 위생 파이프라인·마켓플레이스·패키지 내보내기, #689·#697·#709)와
    **플러그인이 에디터를 확장**(§260 — `tiptapExtensions` 배선·`extensions` capability·trusted
    티어 게시, #693·#694·#696·#701). 여기에 **외관 모델 기반**(§364·§366·§369 — 기본→테마→사용자
    3층 병합과 출처 표시, 다이얼 둘, #712. settings store 26→27). 수정: 같은 줄 이미지가 자동저장에
    escape 로 굳던 파일 손상(#672), 링크 인덱스를 `md::literal` 로 통일(#662·#674), Windows 폴더
    rename 4중 결함(#671) 외. 릴리스 PR #713, 발행 뒤 노트를 기능·수정 두 부로 나눈 PR #714
  - ✅ **v0.7.5** (2026-09-25): `v0.7.4..v0.7.5` 214커밋. **입력 보조**(스펙 0056 — 스마트 구두점을 처음으로
    실제 입력 규칙으로 §373–§374 #725, `:` 기호·이모지 제안 §375–§376 #729, 격자 선택기와 최근 기호
    §377 #731, 사용자 문서 #734)와 **외관 다이얼 2→14**(스펙 0055 — 한글 본문 조판 넷 §368 #718,
    시드 25키에서 29키 파생과 강조색 다이얼 둘 §367 #727, 리스트 안내선 농도·번호 정렬 §5.1
    #722·#723, 간격·모서리를 토큰 스케일로 §365 #730 → 밀도·모서리 #737 → 배경 대비 둘 #740),
    **크롬 숨기기와 포커스 화면구성**(§370 #728 — Writing 이 처음으로 사이드바를 실제로 닫는다,
    설정 탭 `Activity Bar` → `Layout`). 수정: 파일 rename 이 block 참조·embed 를 함께 고친다(#710,
    #678), Windows 폴더 rename 대소문자(#721), 수평선 뒤 캐럿(#726), macOS Option+←/→ 와 Ctrl+-
    이중 동작(#732·#733), 릴리스 빌드가 `config.json` 의 dev 플러그인 폴더를 읽던 문제(#738, §260),
    이 범위 안에서 생긴 24키 테마 팔레트 결함은 태그 전에 고쳤다(#741, §361). 릴리스 PR #742
  - ✅ **v0.7.6** (2026-09-27): `v0.7.5..v0.7.6` 129커밋. **외관을 테마로 내보내기 · 파일에서 테마 설치**
    (§371 6a #752 — 입은 테마의 색 · 기본값과 다른 다이얼 · 고르면 숨긴 표시줄을 `.zip` 패키지로 쓰고,
    `테마 가져오기...` 가 패키지도 받는다), **본문 타이포를 다이얼로**(§365 #749 — 본문 · 코드 서체와 크기 ·
    줄 높이가 에디터 설정에서 다이얼로 옮겨 가 다이얼 14→18, settings store 27→28. 본문 폭을 글자 수로도
    보이고, 테마 CSS 의 `@font-face` 서체를 "From theme" 으로 판정), **커뮤니티 플러그인 0~2단계**(스펙
    0058 — 레지스트리 검증기 상한 · 폐기 목록 서명 environment · `community.json` 시드 §378 #745, 릴리스
    빌드의 개발자 모드 §379 #750, 출처 표시와 게시자 변경 재확인 §382 #753), 테마 갤러리 미리보기와 설정
    창 720→880px(§356 #746), 남은 문자 기호 아이콘을 lucide 로(§342 #751). 수정: 설정 검색이 26행을 더
    찾는다(#744), 한국어 UI 의 공간 이름 Zettel → 제텔(§342 #743), 폐기 목록 게시 워크플로의 배포 키
    개행(§69 #747)과 서명 단계를 돌리려고 올린 sequence 2(§69 #748). 릴리스 PR #754
  - 🚢 **미발행** — `v0.7.6..main` 80커밋(#767 머지 시점). **플러그인이 묻고 답을 받는다**(§385 #755 — 두 티어
    모두에 `ctx.prompts.showQuickPick` · `showInputBox`. 창은 호스트가 그리고, 사용자가 시작한 그 플러그인의
    커맨드가 도는 동안, 사용자가 창 밖을 건드리기 전까지만 열린다), **커뮤니티 제출 게이트 개방**(스펙 0058
    §380 · §381, 2026-09-28 — #765 게이트 0~9 와 발행 CLI, #767 템플릿 `examples/plugins/community-template/` 과
    문서 `plugin-dev/community-registry`, `baram-plugins` #4 워크플로. 게이트를 통과한 업데이트 중 승격이 없고
    표시 필드 다섯 · 게시자 · 저장소가 발행본과 같은 것만 자동 머지하고, 신규 등록과 나머지는 `needs-review` 로
    사람이 본다. 발행은 push 가 아니라 PR 로 전달한다 — 같은 소유 형태의 실험 저장소에서 Actions 를 ruleset
    우회 주체로 등록하자 422 가 났다), **레퍼런스 테마 준비**(§371 6b — #756: 테마가 숨긴 표시줄을 도로 켠 선택이 재시작 뒤에도
    남는다(§370.3), 파일로 설치한 테마의 출처 배지와 레지스트리가 같은 id 로 덮기 전 확인, 테마 찾아보기가
    레지스트리 항목의 미리보기 팔레트를 보인다(§356), 문서 `테마` · `테마 만들기` 두 페이지. #766: 레퍼런스
    테마를 `Baram Hangul` 1.0.0 으로 다듬어 게시 원본 자리 `examples/themes/hangul/` 로 옮겼다), dependabot 8건
    (#757~#764)
    ‼️ **라이브 `community.json` 은 여전히 빈 목록이다**(`{ "communityPlugins": [] }`) — 게이트는 열렸지만 제출이
    0건이라, 포크 PR 이 게이트를 지나 머지되고 PR 전달로 발행되는 경로와 §382 의 Community 표시 · 게시자 변경
    재확인은 실제 게시물로 돈 적이 없다. **테마 레지스트리도 비어 있다**(라이브 `index.json` 에 `kind: "theme"`
    항목 0) — Baram Hangul 의 게시 파이프라인은 아직 없고, `engines.baram` 하한이 `>=0.7.7` 이며 스펙 0063 §7.6 이
    v0.7.7 릴리스를 그 게시 앞에 둔다. `테마 만들기` 페이지가 적는 배포 길은 `.zip` 전달 하나다 — 테마 찾아보기는
    Baram 이 게시한 테마만 싣고, 커뮤니티 목록은 테마를 받지 않는다
  - 🚧 미착수: Canvas, Agent Mode(§11.6), Knowledge Q&A(§11.4), 실시간 협업, E2E 스위트

> 버전 번호는 추측하지 말 것 — `git tag --sort=-creatordate`와 `package.json`의 `version`이 출처다.
> 완료 항목의 상세 이력은 git 히스토리 · `dev/next-steps.md` · `dev/progress.json` 참조.
