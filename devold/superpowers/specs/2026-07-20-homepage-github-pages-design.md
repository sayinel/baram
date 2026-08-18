# Baram 홈페이지 (GitHub Pages) 설계

- **날짜**: 2026-07-20
- **참고 사이트**: <https://ai-scream.ai/Azimuth/> (단일 페이지 정적 랜딩, 미니멀, EN/KO 토글)
- **상태**: 사용자 설계 승인 완료 (2026-07-20)

## 목표

Baram 제품 소개용 정적 홈페이지를 `sayinel/baram` repo 안에서 GitHub Pages로 서빙한다.
URL: `https://sayinel.github.io/baram/`

핵심 원칙:

- **순수 정적** — 프레임워크/빌드체인 없음. HTML + CSS + 최소 vanilla JS. "가볍다"는 제품 철학과 일치
- **앱 룩 재사용** — 디자인 토큰(semantic light/dark)을 발췌해 사이트 자체가 제품 미리보기가 되도록
- **단일 소스** — `docs/*.md`는 canonical (앱 Help 패널 `?raw` 번들). 사이트는 배포 시점에 이를 소비만 하고 복제하지 않음

## 결정 사항 요약

<!-- colwidths:107,665 -->

| 항목         | 결정                                                                 |
| ---------- | ------------------------------------------------------------------ |
| 배포 위치      | `sayinel/baram` repo + `site/` 디렉토리 + GitHub Actions Pages 배포      |
| 기술 스택      | 순수 정적 HTML/CSS + vanilla JS (빌드 없음; docs 변환만 배포 시점 스크립트)           |
| 언어         | 랜딩 페이지 EN/KO 토글 (기본 EN), Docs 페이지는 EN 고정                           |
| 섹션         | 코어(히어로/기능/데모/푸터) + FAQ + 단축키 + 플러그인 생태계                  |
| 비주얼        | Baram 디자인 토큰 발췌, 라이트+다크 (`prefers-color-scheme` 자동, 토글 없음 — YAGNI) |
| User Guide | 배포 시점 사전 렌더링 (marked CLI) — 클라이언트 JS 렌더링 아님                        |

## 파일 구조

```
site/
├── index.html          # 단일 랜딩 페이지
├── style.css           # 토큰 발췌 + 사이트 스타일
├── main.js             # 언어 토글 · OS 감지 · 최신 릴리스 fetch
├── i18n.js             # EN/KO 문자열 사전
├── build-docs.mjs      # 배포 시점 docs → HTML 변환 스크립트 (Node + marked)
└── assets/             # logo(light/dark), hero.png, demo.gif, favicon, OG image
                        #   — hero/demo는 docs/assets에서, 로고는 src/assets에서 복사본
                        #     (Help 패널 번들·앱 번들과 결합도 제거)
```

배포 산출물(아티팩트)에는 추가로 `docs/user-guide.html`, `docs/keyboard-shortcuts.html`,
`docs/faq.html`과 문서 이미지(`docs/assets/`)가 포함된다. 이들은 repo에 커밋되지 않는다.

## 배포 워크플로우 — `.github/workflows/pages.yml`

- 트리거: `push` to `main` + `paths: [site/**, docs/**]`, 그리고 `workflow_dispatch`
- 잡 구성 (표준 3단 + 문서 빌드):
  1. checkout → Node setup
  2. `node site/build-docs.mjs` — 스테이징 디렉토리에 사이트 셸 + 변환된 docs 조립
  3. `actions/configure-pages` → `actions/upload-pages-artifact` → `actions/deploy-pages`
- **CI 계약 준수**: 모든 액션은 커밋 SHA 핀 + `# vN` 주석 (dependabot 갱신 대상)
- 기존 `ci.yml`과 완전 독립 (경로 필터로 앱 CI에 영향 없음)
- 권한: `pages: write`, `id-token: write` (Pages 배포 표준)
- **1회 수동 설정**: repo Settings → Pages → Source를 "GitHub Actions"로 지정

## 랜딩 페이지 구성 (앵커 네비 단일 페이지)

<!-- colwidths:60,95,899 -->

| # | 섹션        | 내용                                                                                                                                        |
| - | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | Nav       | 로고 · 앵커(Features / Shortcuts / Plugins / FAQ / Docs) · EN⇄KO 토글 · GitHub 링크                                                               |
| 1 | Hero      | 타이틀 + 태그라인("Like the wind, light and free") · OS 자동 감지 다운로드 버튼 + 전체 플랫폼 링크 · 버전/플랫폼/라이선스 뱃지 · hero.png                                    |
| 2 | Features  | 8개 카드 그리드: 구문이 사라지는 WYSIWYG · 무손실 라운드트립 · AI 네이티브(Ghost Text/Chat/Inline Edit) · 위키링크+그래프 · 수식/Mermaid/테이블 · Vault 시스템 · 플러그인 · \~10MB 경량 |
| 3 | In Action | demo.gif 중심 데모                                                                                                                            |
| 4 | Shortcuts | 대표 단축키 발췌 표(모노스페이스) + "전체 보기 →" docs 링크                                                                                                   |
| 5 | Plugins   | 마켓플레이스 소개(baram-plugins 레지스트리) + 플러그인 개발 가이드 링크                                                                                           |
| 6 | FAQ       | `docs/faq.md`에서 4\~6개 발췌, `<details>` 아코디언 + "전체 보기 →" docs 링크                                                                            |
| 7 | Footer    | Apache-2.0 · GitHub · Releases · ©                                                                                                        |

## Docs 페이지 (사전 렌더링)

`site/build-docs.mjs`가 배포 시점에 수행:

- `docs/user-guide.md`, `docs/keyboard-shortcuts.md`, `docs/faq.md` → `marked`로 HTML 변환
- 사이트 셸(nav + footer + style.css) 래핑
- h2/h3 헤딩 기반 **사이드 TOC 자동 생성** (user-guide 분량 대응)
- 문서 간 상대 링크 재작성: `*.md` → `*.html`
- `docs/assets/` 이미지를 아티팩트에 복사해 상대 경로 유지
- 원본 md는 무수정 — Help 패널 번들과 무간섭

로컬 재현: `node site/build-docs.mjs && python3 -m http.server` (배포 결과물 동일)

### Docs 페이지 네비게이션

- **상단 네비 (사이트 셸 공유)**: 로고 → `index.html`(랜딩), 섹션 링크는 `index.html#features` 형태의 절대 앵커. 언어 토글은 docs에서 숨김 (EN 고정)
- **왼쪽 사이드바 (빌드 스크립트가 생성, 2단)**:
  1. Docs 목록 — User Guide / Keyboard Shortcuts / FAQ, 현재 페이지 하이라이트
  2. 현재 문서의 TOC — h2/h3 앵커 링크
- **모바일**: 사이드바를 `<details>` 접이식으로 본문 상단에 배치 (JS 불필요)
- 스크롤스파이·prev/next 링크는 비범위 (문서 3개 규모에 과함)

## 비주얼 — 토큰 발췌

`src/styles/generated/semantic-light.css` / `semantic-dark.css`는 Tailwind `@theme` /
`[data-theme]` 셀렉터에 묶여 있으므로 직접 import하지 않고, 필요한 변수만 발췌해 재구성:

- `:root` = 라이트 값, `@media (prefers-color-scheme: dark)` = 다크 값
- 대상: `--color-bg-default/subtle/panel/elevated`, `--color-text-primary/muted`,
  `--color-accent-default`, `--color-border-*`, `--shadow-sm/md/lg/xl` 등 사용분만
- 네이밍은 앱 컨벤션(`--color-{category}-{qualifier}`) 유지
- 로고: `<picture>` + `prefers-color-scheme`로 라이트/다크 스위칭 (README와 동일 패턴)
- 토큰 원본이 바뀌어도 사이트는 독립 (수동 발췌 — 자동 동기화는 YAGNI)

## 동적 요소 (vanilla JS 3가지)

1. **언어 토글** (`i18n.js` + `main.js`)
   - 모든 번역 대상 요소에 `data-i18n="key"` 속성, i18n.js에 `{ en: {...}, ko: {...} }` 사전
   - 초기값: localStorage → 없으면 `navigator.language`(ko\* → KO, 그 외 EN)
   - `<html lang>` 속성 동기화
2. **다운로드 버튼** (`main.js`)
   - `GET https://api.github.com/repos/sayinel/baram/releases/latest` (비인증, 60 req/hr/IP로 충분)
   - 버전 표시 + 에셋 매핑:
     - macOS: `*_universal.dmg` 우선 → 없으면 `*_aarch64.dmg` 폴백 (v0.3.0 대응)
     - Windows: `*_x64-setup.exe` (msi는 전체 링크 목록에)
     - Linux: `*_amd64.AppImage` 주 버튼, `deb`/`rpm`은 목록에
   - OS 감지: `navigator.userAgentData?.platform` → `navigator.platform` 폴백
   - API 실패 시: 버튼이 GitHub Releases 페이지 링크로 폴백 (JS 없이도 링크는 동작해야 함 —
     기본 href를 releases 페이지로 두고 JS가 향상)
3. **앵커 스크롤 + 모바일 네비**: `scroll-behavior: smooth` CSS 우선, 모바일 햄버거 최소 구현

## SEO / 메타

- `<title>`, meta description, canonical URL
- Open Graph: `og:title`, `og:description`, `og:image`(hero.png), `twitter:card`
- favicon (로고 기반)

## 에러 처리

- 릴리스 API 실패/rate limit: 정적 폴백 링크 (releases 페이지) — 항상 동작
- JS 비활성: 모든 콘텐츠·링크는 HTML에 존재 (EN 기본), JS는 순수 향상(progressive enhancement)
- 이미지 로드 실패: 의미 있는 alt 텍스트

## 검증 계획

- 로컬: `node site/build-docs.mjs` + `python3 -m http.server`로 4조합(라이트/다크 × EN/KO) 확인
- 링크 체크: 내부 앵커, docs 상호 링크, 외부(GitHub/releases) 링크
- 반응형: 모바일 뷰포트(\~375px) 확인
- 툴링 무간섭 확인: `npx knip`(pre-push hook)과 `npm run audit:css-vars`가 `site/`를
  오탐하지 않는지 확인, 필요 시 ignore 설정 추가
- 배포 후: 실제 Pages URL에서 다운로드 버튼 에셋 매핑 + OG 태그(카드 미리보기) 확인

## 명시적 비범위 (YAGNI)

- 다크/라이트 수동 토글 (시스템 자동만)
- 블로그/뉴스, 애널리틱스, 커스텀 도메인
- Docs 페이지 KO 번역 (원본이 EN)
- 토큰 자동 동기화 파이프라인
- 스크롤 애니메이션 등 마케팅형 연출
- 에디터 비교 포지셔닝 섹션(Why Baram) — 2026-07-20 사용자 결정으로 제외
