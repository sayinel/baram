---
title: "플러그인 배포하기"
sourceHash: "57cbc575c73e"
---

## 커밋된 시드

시드가 있는 이유는 리포에 오프라인이면서 스키마가 올바른 `RegistryIndex` 픽스처를 두기 위함입니다.
Rust 드리프트 가드 테스트(`test_committed_registry_seed_deserializes`)가 테스트를 돌릴 때마다
그것을 역직렬화하고, 모양이 살아 있는 레지스트리와 달라지면 실패합니다 — `trust`가 없는 것도
포함해서입니다. 티어가 없는 항목은 앱이 설치를 거부하는 플러그인을 기술하는 것이기 때문입니다.

**시드의 항목은 라이브 레지스트리의 항목과 같고, 그 로컬 사본에서 설치하는 것은 여전히 실패합니다 —
의도된 동작입니다.** 각 항목은 라이브 `index.json`과 같은 버전·체크섬을 싣고, `downloadUrl`은 라이브
레지스트리를 가리킵니다. 앱은 색인을 가져온
레지스트리 아래에서만 아카이브를 내려받으므로(`src-tauri/src/plugin/origin.rs`의 `registry_base` /
`is_within_registry`), 로컬 서버를 가리키는 앱([로컬 시험](/ko/docs/plugin-dev/registry-loading-and-testing/#로컬-시험)
참조)은 그 항목을 목록에 띄우되 설치는 거부합니다. 시드로는 마켓플레이스 **UI**를 시험하고(목록,
권한·티어 배지, 레거시 상태, 새로고침), 플러그인이 실제로 도는 것은 소스에서 개발 모드로 불러와
(**설정 → 플러그인 → 개발자**) 시험하십시오. 설치 경로 자체를 시험하려면 색인 사본 옆에서 ZIP을
서빙하고 각 `downloadUrl`을 그 서버로 고쳐 쓰십시오.

시드가 **아닌** 것 두 가지를 더 적어 둡니다.

- 살아 있는 색인의 바이트 단위 사본이 아닙니다. Prettier로 서식이 잡혀 있고(살아 있는 파일은
  `update-registry-index.mjs`가 씁니다), 배포할 만한 항목만 담습니다 — `baram-ai-summary`는
  배포된 적이 없어서가 아니라(1.0.0 아카이브는 레지스트리에 여전히 남아 있습니다) 철회되어서
  없습니다(`registry/revoked.json` 참고).
- 체크섬은 자동으로 채워지지 **않습니다**. 릴리스 워크플로는
  `sayinel/baram-plugins`를 클론해 **그** 리포의 `index.json`만 갱신하고, 여기로 되쓰는 것은
  없습니다. 버전을 배포한 뒤 관리자가 워크플로의 `sha256sum` 출력을 이 파일에 손으로 옮깁니다.
  잊는 것은 이제 **보고되지만 막히지는 않습니다** — `validate-index.ts`가 `npm run lint`마다
  전부 0인 체크섬을 경고하면서도, ZIP이 아직 없는 릴리스를 가리키는 시드는 허용합니다. 16진수
  64자 모양 검사만으로는 이것을 결코 볼 수 없습니다 — 0도 그 모양을 만족하기 때문입니다.

## 내 플러그인 배포하기

1. 플러그인용 GitHub 저장소를 만듭니다.
2. 플러그인을 빌드합니다 — `npm run build`.
3. `baram-plugin.json`, 빌드된 `main` 번들(예: `dist/index.mjs`), 그리고 `assets/`(있다면)를 담은
   ZIP을 만듭니다.
4. 그 ZIP을 자산으로 붙인 GitHub 릴리스를 만들고 SHA-256 체크섬을 계산합니다
   (예: `shasum -a 256 your-plugin-1.0.0.zip`).
5. 배포하려는 `RegistryIndex`에 `RegistryEntry`를 추가합니다. ⚠️ 오늘은 그것이 1군 레지스트리만을
   뜻합니다 — Baram이 고정된 URL을 가져오고 직접 호스팅한 `index.json`을 가리킬 수 없으므로
   (*Baram이 레지스트리를 불러오는 방식* 참조), 자기 색인에 넣은 항목은 아무 사용자에게도 닿지
   않습니다. 커뮤니티 제출이 열리기 전까지 누군가에게 플러그인을 건넬 유일한 방법은
   **설정 → 플러그인**의 **개발자** 구역입니다 — 릴리스 빌드에서는 사용자가 먼저 **개발자 모드**를
   켜야 하고, 그 길로는 `sandboxed` 플러그인만 불러옵니다. (이 리포의 1군 플러그인은 항목을 손으로 넣지 않습니다 —
   `plugin-<dir>-v<version>` 태그를 밀면 위에 적은 대로
   [`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins)의 `index.json`이 자동으로
   갱신됩니다.)

```json
{
  "id": "my-word-count",
  "name": "Word Count",
  "description": "Displays word and character count",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "downloadUrl": "https://sayinel.github.io/baram-plugins/plugins/my-word-count-1.0.0.zip",
  "checksum": "sha256-hash-of-zip",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "trust": "sandboxed",
  "keywords": ["word", "count"],
  "engines": { "baram": ">=0.5.0" }
}
```

`downloadUrl`은 레지스트리 자신의 기준 URL 아래에 있어야 합니다. 앱은 색인을 가져온 레지스트리
아래에서만 아카이브를 내려받고 다른 호스트는 거부합니다(`src-tauri/src/plugin/origin.rs`의
`registry_base` / `is_within_registry`). 예시가 4단계의 GitHub 릴리스가 아니라
`sayinel.github.io/baram-plugins/plugins/`를 가리키는 이유입니다 — 릴리스 URL을 그대로 적은 항목은
목록에는 뜨지만 설치에서 실패합니다.
