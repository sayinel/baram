# 플러그인 레지스트리 호스팅 설계 (§69 후속)

- 날짜: 2026-07-16
- 상태: 설계 확정 (구현 전)
- 선행: §69 Plugin Dev Environment Phase A–F (PR #216, #223–#228)

## 1. 배경과 목적

§69로 마켓플레이스 클라이언트는 완성되어 있다: 마켓플레이스 UI(`PluginMarketplace.tsx`),
레지스트리 fetch(Rust `fetch_registry` → `RegistryIndex`), ZIP 다운로드 + SHA-256 검증 +
설치(`install_plugin`), 업데이트 체커, capability 승인. 그러나 레지스트리 자체가 없다:

- `DEFAULT_REGISTRY_URL`(`src/stores/system/plugin.ts:42`)이 존재하지 않는
  `baram-community/plugin-registry` repo를 가리킴 (aspirational)
- 시드 `registry/index.json`의 `downloadUrl`/`checksum`이 `"TBD"` (Phase F deferred 항목)

이 설계는 **실제 레지스트리와 플러그인 배포 채널을 GitHub Pages로 호스팅**하여
마켓플레이스를 end-to-end로 동작시키는 것을 목표로 한다.

## 2. 결정 사항과 근거

<!-- colwidths:165,578 -->

| 결정                                                        | 근거                                                                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 운영 범위: 퍼스트파티 전용                                           | 커뮤니티 제출 파이프라인은 수요 발생 시 추가 (YAGNI)                                                                                                                                                  |
| 호스팅: 새 public repo `sayinel/baram-plugins` + GitHub Pages | 메인 repo가 private이라 raw URL/Release asset은 공개 접근 불가. 별도 repo는 메인 repo의 public 전환 방식(clean mirror vs flip, 이름 변경)과 레지스트리 URL을 절연시키고, 메인 repo의 Pages 슬롯(repo당 1개)을 향후 문서/랜딩 사이트용으로 보존 |
| index.json과 ZIP을 같은 Pages 사이트에서 서빙                        | 한 번의 배포로 index와 ZIP이 원자적으로 갱신 — 불일치 창 제거                                                                                                                                           |
| 기존 배포 버전 마이그레이션 없음                                        | v0.1.0/v0.3.0은 공식 배포가 아님 (사용자 확인). `DEFAULT_REGISTRY_URL` 단순 교체로 충분, persisted store 마이그레이션 불필요                                                                                    |
| `baram-community` 방어 등록 안 함                               | 같은 이유로 옛 기본 URL을 바라보는 실사용자가 없음                                                                                                                                                     |
| ZIP 빌드는 메인 repo CI, 산출물만 baram-plugins에 push              | 플러그인 소스(`examples/plugins/`)는 메인 repo에 유지 — 소스 이원화 방지                                                                                                                              |

## 3. 아키텍처

```
sayinel/baram (private, 소스)                sayinel/baram-plugins (public, 배포)
├── examples/plugins/                        ├── index.json          ← 레지스트리
│   ├── word-count/     ── plugin-release ─▶ ├── plugins/
│   └── ai-summary/        (태그 push 시     │   ├── baram-word-count-1.0.0.zip
├── .github/workflows/      빌드→체크섬→     │   └── baram-ai-summary-1.0.0.zip
│   └── plugin-release.yml  deploy-key push) ├── README.md
└── registry/index.json (시드/스키마 픽스처)  └── .nojekyll
                                                  │
                                             GitHub Pages (main 브랜치 배포)
                                                  │
                              https://sayinel.github.io/baram-plugins/
                                                  ▲
Baram 앱: DEFAULT_REGISTRY_URL fetch ─ 설치 클릭 ─┘ (ZIP 다운로드 → SHA-256 대조 → 설치)
```

앱의 설치/검증/업데이트 로직은 **코드 변경 없이** 그대로 사용한다.

## 4. 구성 요소

### 4.1 `sayinel/baram-plugins` repo (신규, public)

- 내용: `index.json`, `plugins/*.zip`, `README.md`(레지스트리 운영 정책 — 퍼스트파티 전용 명시), `.nojekyll`
- Pages 설정: `main` 브랜치 루트에서 배포 (자체 CI 없음 — 브랜치 내용이 곧 사이트)
- ZIP 파일은 브랜치에 커밋된 정적 파일. 이전 버전 ZIP은 삭제하지 않고 유지 (롤백 여지, KB 단위라 용량 무관)
- 커밋 주체: 메인 repo 워크플로우가 write 권한 deploy key로 push

### 4.2 `plugin-release.yml` (메인 repo, 신규 워크플로우)

트리거: `plugin-<id>-v<version>` 태그 push (예: `plugin-word-count-v1.0.0`).
`plugin-*` 네임스페이스는 기존 앱 릴리스 태그 규칙(`v*` → verify-tag 잡)과 충돌하지 않는다.

동작 순서:

태그의 `<id>`는 **디렉토리명**(`examples/plugins/<id>`, 예: `word-count`)을 가리키고,
ZIP 파일명과 레지스트리 엔트리는 **매니페스트&#x20;**`id`(예: `baram-word-count`)를 사용한다.

1. 태그에서 `<id>`, `<version>` 파싱 → `examples/plugins/<id>/baram-plugin.json`의
   `version`과 일치 검증 (불일치 시 즉시 실패 — 앱 릴리스의 version:check와 동일한 원칙)
2. `examples/plugins/<id>`에서 `npm ci && npm run build` (esbuild → `dist/index.mjs`)
3. ZIP 패키징 — **§5의 패키징 계약** 준수
4. `sha256sum`으로 체크섬 계산
5. `baram-plugins`를 clone → `plugins/<manifest.id>-<version>.zip` 추가 →
   `index.json`에서 해당 플러그인 엔트리의 `version`/`downloadUrl`/`checksum`/`updatedAt` 갱신
   (jq; 다른 플러그인 엔트리는 보존) → JSON 유효성 + 필수 필드 검증 → commit & push
6. push 전 `concurrency` 그룹으로 동시 릴리스 간 race 방지

CI 계약 준수: 액션은 커밋 SHA 핀 + `# vN` 주석. 이 워크플로우는 태그 트리거이므로
"push CI는 main만" 계약과 무관하게 동작한다.

### 4.3 앱 변경 (메인 repo, 1줄 + 문서)

- `src/stores/system/plugin.ts`: `DEFAULT_REGISTRY_URL` →
  `https://sayinel.github.io/baram-plugins/index.json`
- `registry/index.json` 시드: 첫 릴리스 후 실제 `downloadUrl`/`checksum`으로 TBD 교체
  (Phase F deferred 해소). 시드는 스키마 픽스처 역할을 유지하며 drift-guard Rust 테스트가
  계속 실제 경로를 검증한다
- `docs/plugin-development.md`: "aspirational, not yet created" 문구를 실제 레지스트리
  안내(URL, 퍼스트파티 정책, ZIP 계약)로 갱신

## 5. ZIP 패키징 계약

Rust `install_plugin`(`src-tauri/src/plugin/mod.rs:159`)이 요구하는 구조:

- `baram-plugin.json`**이 ZIP 루트에 위치** (임시 디렉토리에 압축 해제 후
  `<root>/baram-plugin.json`을 읽음) — 플러그인 디렉토리를 폴더째 압축하지 말고
  **내용물을 직접 압축**할 것
- 포함 파일: `baram-plugin.json`, `dist/`(매니페스트 `main`이 참조), `README.md`
- 제외: `src/`, `node_modules/`, `package.json`, `tsconfig.json`, `styles.css`
  (매니페스트에 `styles` 필드가 없고 로더는 `main`만 로드 — 스타일은 런타임에
  `context.ui.addStyle`로 주입되므로 런타임 불필요)
- 체크섬: ZIP 바이트 전체의 SHA-256 hex — 레지스트리 `checksum` 필드와 일치해야 설치 성공

## 6. 에러 처리 / 보안

- 체크섬 불일치: 기존 Rust 코드가 `ChecksumMismatch`로 거부 (변경 없음)
- 잘못된 index push 방지: 워크플로우 5단계에서 push 전 JSON 파싱 + 필수 필드 검증
- 태그-매니페스트 버전 불일치: 워크플로우 1단계에서 실패
- capability 승인: 기존 설치 플로우 그대로 (레지스트리 `capabilities` 표시 → 사용자 승인)
- Pages CDN 캐시(\~10분): 릴리스 직후 구버전 index가 잠시 보일 수 있으나, index와 ZIP이
  같은 커밋으로 배포되므로 "index는 신버전, ZIP은 구버전" 불일치는 발생하지 않음

## 7. 비범위 (Non-goals)

- 커뮤니티/서드파티 플러그인 제출 파이프라인 (제출 템플릿, 리뷰 정책, CI 검증)
- 커스텀 도메인 (CNAME) — 필요 시 URL 변경 없이 추가 가능
- 사람이 보는 플러그인 갤러리 웹페이지 (같은 Pages 사이트에 후속 추가 가능)
- SHA-256 이상의 코드 서명
- 플러그인 버전 히스토리 서빙 (레지스트리는 최신 버전만 노출 — 기존 `RegistryEntry` 스키마 유지)

## 8. 검증 계획

1. **워크플로우 검증**: `plugin-word-count-v1.0.0` 태그 push → Actions 성공 →
   baram-plugins에 ZIP + 갱신된 index.json 커밋 확인 → Pages URL에서 두 파일 fetch 확인
2. **앱 E2E (수동, 실제 앱)**: 기본 URL로 마켓플레이스 열기 → word-count 표시 확인 →
   설치 → capability 승인 → 상태바에 단어 수 표시 확인
3. **업데이트 체커**: word-count `1.0.1` bump 릴리스 → 앱에서 업데이트 감지 → 업데이트 설치 동작 확인
4. **체크섬 방어 확인**: index의 checksum을 의도적으로 틀리게 한 로컬 레지스트리로
   설치 시도 → `ChecksumMismatch` 거부 확인 (로컬 registryUrl 교체로 테스트)
5. **기존 게이트**: `npm test`, `npm run typecheck`, cargo test 전부 그린 (앱 변경은 1줄이지만 확인)

## 9. 실행 순서

1. `sayinel/baram-plugins` repo 생성 + Pages 활성화 + deploy key 등록 (메인 repo secret)
2. 메인 repo: `plugin-release.yml` 추가 + `DEFAULT_REGISTRY_URL` 교체 + 문서 갱신 (PR)
3. `plugin-word-count-v1.0.0`, `plugin-ai-summary-v1.0.0` 태그 push → 첫 릴리스
4. `registry/index.json` 시드 TBD를 실제 값으로 교체 (후속 커밋)
5. §8 검증 수행
