---
title: "레지스트리 불러오기와 로컬 시험"
sourceHash: "1c95704cc544"
---

## Baram이 레지스트리를 불러오는 방식

마켓플레이스(`PluginMarketplace.tsx`가 `src/plugins/registry-client.ts`의
`fetchRegistryIndex()`를 거쳐)는 플러그인 Zustand 스토어(`src/stores/system/plugin.ts`)의
`registryUrl`에 담긴 URL을 가져오고, 그것을 Rust `fetch_registry` 커맨드가 읽습니다. 값은
`DEFAULT_REGISTRY_URL`로 고정돼 있습니다.

```
https://sayinel.github.io/baram-plugins/index.json
```

**설계상 조정할 수 없습니다.** 설정 항목이 없고, 2026-08-04부터는 그 값을 일부러 영속화하지
않습니다 — `partialize`가 그것을 빼고 `merge`가 실행할 때마다 기본값을 되돌립니다. 재시작을
견디는 레지스트리 URL이 플러그인 체계의 다른 무엇보다 강한 발판이 된다는 것이 드러났기
때문입니다(`trusted` 플러그인이 앱을 자기 레지스트리로 한 번 돌려놓으면, 시작 검사가 그 레지스트리에
무엇이 폐기됐는지 묻게 됩니다 — 그것을 되돌릴 요청 자체가 오염된 것이므로 영구히 그렇습니다).
메모리에만 두면 그 범위가 한 세션으로 한정됩니다.

플러그인 저자에게 실질적으로 따라오는 것들:

- **직접 호스팅한 레지스트리는 지원되지 않습니다.** 어차피 레지스트리는 지금 1군 플러그인만
  받으므로, 갖고 있던 선택지를 없애는 것은 아닙니다.
- **`config.json`을 고쳐도 효과가 없습니다.** 거기 쓴 `registryUrl`은 앱이 재수화할 때 버려집니다.
- 레지스트리 밖으로 배포하는 것은 **설정 → 플러그인** 아래쪽의 **개발자** 구역을 뜻합니다 —
  사용자가 플러그인 폴더를 골라 직접 불러옵니다. 그 경로는 개발 빌드뿐 아니라 릴리스 빌드에서도
  쓸 수 있습니다.

레지스트리는 [`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins)에 있습니다 —
GitHub Pages로 서빙되는 공개 리포이고 `index.json`과 `plugins/` 아래의 플러그인 ZIP을
호스팅합니다. 지금은 **1군 플러그인만** 받고, 커뮤니티 제출은 앞으로 고려할 사항입니다.

배포는 이 리포의 CI가 몰아갑니다 — `plugin-<dir>-v<version>` 태그를 밀면
(예: `plugin-word-count-v1.0.0`. `<dir>`는 `examples/plugins/` 아래 디렉터리이고 버전은 그
플러그인의 `baram-plugin.json`과 같아야 합니다) `.github/workflows/plugin-release.yml`이 돌아
플러그인을 빌드하고 위 계약대로 ZIP을 만들고 SHA-256을 계산해, ZIP과 갱신된 `index.json`을
레지스트리 리포로 밀어 넣습니다.

무엇이든 빌드되기 전에 거부가 둘 일어납니다 — 유효한 `trust`가 없는 매니페스트는 릴리스를 아예
실패시키고(티어 없는 항목은 아무도 설치할 수 없는 플러그인만 기술할 수 있습니다),
`malicious-fixture`와 `sandbox-smoke` 디렉터리는 이름으로 거부되므로 태그를 잘못 쳐도 테스트
픽스처가 공개 레지스트리에 배포될 수 없습니다.

## 로컬 시험

살아 있는 레지스트리 없이 마켓플레이스 UI를 시험하려면, 기본값 대신 리포에 커밋된 시드를 가리키게
하십시오 — [`registry/index.json`](https://github.com/sayinel/baram/blob/main/registry/index.json).

> ⚠️ **옛 절차는 더 이상 동작하지 않습니다.** 이 페이지의 이전 버전은 앱을 닫고
> `app_data_dir/config.json` 안의 `state.registryUrl`을 고치라고 했습니다. 2026-08-04부터 그 값은
> 영속화되지 않고 실행할 때 버려지므로(위 *Baram이 레지스트리를 불러오는 방식* 참조) 그 편집이
> 조용히 무시됩니다 — 앱은 여전히 살아 있는 레지스트리를 가져오고 오류도 보이지 않습니다.

개발 체크아웃에서는 `src/stores/system/plugin.ts`의 `DEFAULT_REGISTRY_URL`을 바꾸고
`npm run tauri dev`를 돌리십시오. 그것이 스토어의 초기값이고, `merge`가 실행할 때마다 되돌리는
것이 바로 그 값입니다.

- **로컬 정적 서버**(권장) — 아무 정적 파일 서버로 `registry/`를 서빙하고(예: `npx serve registry`
  또는 `python3 -m http.server --directory registry 8000`) 상수를
  `http://localhost:8000/index.json`으로 둡니다.
- **파일 경로** — 어떤 플랫폼은 로컬 체크아웃의 `registry/index.json`에 대한 `file://` 경로를 바로
  받습니다. Tauri의 웹뷰가 `file://` 가져오기를 제한할 수 있으므로 로컬 정적 서버가 더 이식성이
  좋습니다.

1군이 아닌 URL은 폐기 서명 강제도 **끕니다** — Rust는 `FIRST_PARTY_REVOCATION_PREFIX` 아래로
서빙되는 목록만 검증하고, 그 밖의 것은 미검증으로 보고합니다. 의도한 동작이고, 로컬 실행의
"미검증" 상태를 결함으로 오해하지 않도록 알아 둘 만합니다.

상수가 로컬 시드를 가리키면 **설정 → 플러그인**("찾아보기" 탭)을 여십시오 — 마운트될 때
`fetchRegistryIndex()`를 호출합니다. 레지스트리 응답은 24시간 캐시된다는 점을 유의하십시오.
**찾아보기**와 **업데이트** 탭에는 늘 쓸 수 있는 **↻ 새로 고침** 버튼이 있어 캐시를 우회하고
(`fetchRegistryIndex(true)`) 새 색인으로 업데이트 검사를 다시 돌리므로(`checkForUpdates()`),
새 `registry/index.json`을 반영하려고 앱을 재시작할 필요가 없습니다. 가져오기가 실패했을 때 나오는
**다시 시도** 버튼도 같은 일을 합니다. 캐시는 메모리에만 있으므로, 필요하면 앱을 재시작해도 새로
가져옵니다. `registry/index.json`은 유효한 `RegistryIndex`의 canonical 예입니다 —
`baram-word-count`를 실제 매니페스트에서 채운 모든 필수 필드와 함께(`trust` 포함) 나열합니다.
다만 2.1.0이 배포될 때까지 그것에서 **설치**하는 것은 불가능합니다 — 아래를 보십시오.
