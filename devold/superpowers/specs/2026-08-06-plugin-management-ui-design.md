# 플러그인 관리 UI 재설계 — Built-in vs Community 구분 + 설정 단일화

- **날짜**: 2026-08-06
- **설계 문서 참조**: §69 (플러그인 마켓플레이스), §260 (플러그인 실행 모델)
- **상태**: 설계 확정, 구현 계획 대기

## 1. 동기

§260 6개 페이즈가 v0.5.0으로 출하되면서 플러그인의 **실행 모델**(trusted/sandboxed 두 티어, 설치 동의, ACL 락다운)은 완성됐다. 그 과정에서 다루지 않은 것이 **관리 UI의 정보 구조**다. 직전 작업(#373까지)은 개별 결함을 닫았고 — Installed 탭의 상세 경로(`014949da`), i18n을 안 거친 메시지(`649f1f3a`, `916df712`) — 구분 체계 자체는 손대지 않았다.

구체적으로 지금 잘못된 것:

1. **내장 플러그인이 UI에 존재하지 않는다.** `BUILTIN_PLUGINS`(현재 Media Viewer 1개)는 `installedPlugins` 스토어에 들어가지 않으므로 Browse·Installed·Updates·상세 어디에도 나타나지 않는다. 사용자는 PNG/SVG를 무엇이 렌더링하는지 알 수 없고, 끌 수도 없다.

2. **그래서 커뮤니티 뷰어 플러그인은 구조적으로 무력하다.** `matchFileViewer`는 먼저 등록된 뷰어가 이기고(`plugin-ui-store.ts:97`), 내장은 설치 플러그인보다 먼저 로드된다(`plugin-lifecycle.ts:72`). `viewer`는 공개 확장점인데 내장이 잡은 확장자는 3자 플러그인이 절대 가져올 수 없다. 내장을 끄는 것이 유일한 길이며, 그 수단이 없다.

3. **"플러그인 설정"이 두 메커니즘으로 갈라져 서로 다른 곳에 산다.** (§4 참조) 사이드바에서 마켓플레이스를 연 사용자는 플러그인이 등록한 설정 탭의 존재 자체를 알 수 없다.

4. **`PluginMarketplace.tsx`가 1,309줄**이다(컨벤션 ~300줄의 4배). 셸·핸들러·세 목록·행 마크업을 한 파일이 안고 있고, 각 목록이 자기 마크업에서 버튼을 개별 판단한다. 그래서 Installed 탭이 상세 경로를 최근까지 갖지 못했고, Updates 탭은 `onInstall={() => {}}`라는 죽은 콜백을 넘긴다.

5. **마켓플레이스 셸과 카드/행이 100% 인라인 스타일**이다(`STYLES` 194줄 + `PluginCard` 전체). `plugins.css` 506줄은 consent 다이얼로그·capability 배지·폐기 안내·개발자 섹션만 다룬다. 디자인 토큰 시스템을 우회하고 있다.

## 2. 레퍼런스 조사

| | 구분 위치 | Built-in 허용 조작 | 특징 |
|---|---|---|---|
| **VS Code** | 검색창 필터 토큰(`@builtin`/`@installed`/`@outdated`). 기본 목록에서 built-in은 숨김 | Disable만 | 상세는 사이드바가 아니라 에디터 탭. 톱니 → "Extension Settings"는 **Settings UI로 점프**(`@ext:` 필터) |
| **Obsidian** | 설정 모달 좌측 내비에 "Core plugins"/"Community plugins" 별도 페이지 | 토글만 (설치·삭제 개념 없음) | Community만 Restricted mode + Browse 모달 + 3rd-party 경고. 톱니는 좌측 내비의 그 플러그인 항목으로 **이동** |
| **Logseq** | 별도 Plugins 모달, Installed/Marketplace 탭 | built-in을 플러그인으로 노출 안 함 | 카드 "..." 메뉴, Developer mode 토글 |
| **JetBrains** | **Installed 탭 안에서 "Downloaded"/"Bundled" 두 섹션** | Disable만, 그룹 단위 일괄 | 탭을 늘리지 않고 한 목록 안에서 provenance로 그룹핑 |

수렴하는 두 원칙:

- **built-in과 community는 액션 세트가 다르다** (삭제·업데이트·동의는 community만) → 목록을 섞지 않는다.
- **목록은 런처이고, 설정은 단일 장소에 있다** → 목록의 톱니는 설정 화면으로 라우팅한다. VS Code도 사이드바에서 설정하지 않는다.

## 3. 결정 사항

| 질문 | 결정 |
|---|---|
| 내장에 허용할 조작 | **토글 + 설정 + 상세** (삭제·업데이트 없음) |
| 구분을 둘 계층 | **Installed 탭 안의 섹션 그룹** (JetBrains Bundled/Downloaded 방식) |
| 내장 상태 저장 | **`builtinDisabled: string[]`** — `installedPlugins` 주입 안 함 (§5) |
| 설정 배치 | **Settings 창 단일화, 목록은 런처** (§4) |
| 개발 중 플러그인 | 세 번째 섹션. **토글 없음** — 다시 로드 / 설정 / 폴더 제거 |

### 3.1 액션 세트 (`source`에서 파생)

| | 토글 | 설정 | 상세 | 업데이트 | 삭제 | 동의 이력 | 다시 로드 |
|---|---|---|---|---|---|---|---|
| **내장** | ✓ | ✓ | ✓ | — | — | — | — |
| **커뮤니티** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **개발 중** | — | ✓ | ✓ | — | 폴더 제거 | — | ✓ |

개발 중에 토글이 없는 이유: dev 플러그인은 Rust에서 매 실행마다 목록을 받아 무조건 로드되며(`plugin-lifecycle.ts:142-157`) `enabled`는 이름만 있는 필드다. 토글을 추가하면 영속화할 자리가 없는 상태를 새로 만들게 된다.

섹션은 **Installed 탭에만** 둔다. Browse는 레지스트리만 나열하므로 커뮤니티뿐이고, Updates에는 내장이 원리상 등장하지 않는다.

## 4. 두 설정 메커니즘

| | 메커니즘 1 — 선언 필드 | 메커니즘 2 — 등록 탭 |
|---|---|---|
| 출처 | `manifest.contributions.settings` | `ctx.ui.addSettingsTab()` |
| 렌더 | 앱이 자동 생성 (`PluginSettingsForm`) | 플러그인이 직접 (`PluginSettingsTabHost`) |
| 값 소유 | 앱 (플러그인은 읽기만, `plugin-settings.ts`) | 플러그인 |
| **현재 위치** | Installed 행 인라인 · 상세 화면 · 개발자 상세 **(3중)** | **설정 창 좌측 내비 전용** |

결과적으로 지금:
- 사이드바에서는 선언 필드만 보이고 등록 탭은 존재를 알 수 없다.
- 설정 창의 등록 탭은 플러그인 목록과 별개 위치라 어느 플러그인 것인지 제목으로만 짐작한다.
- `activePluginTab`은 `SettingsModal`의 로컬 state(`SettingsModal.tsx:42`)이고 **tabId 기준**이라, 외부에서 특정 플러그인 설정으로 보낼 수단이 없고 등록 탭이 없는 플러그인(대부분)은 애초에 가리킬 수 없다.

## 5. 아키텍처 — 내장 상태

### 5.1 검토한 대안

**A. 내장을 `installedPlugins`에 합성 레코드로 주입** — 목록·토글·설정이 자동으로 균일해진다. 그러나 `installedPlugins`는 영속화되며(`plugin.ts:392`) 세 소비처가 "디스크에 설치된 플러그인"을 가정한다:

- `plugin-lifecycle.ts:99` → `loadPlugin(installPath, manifest)`에 `main: "(builtin)"`을 넘겨 실패
- `registry-client.ts:19` → 레지스트리에 없는 id를 업데이트 조회
- `plugin-loader.ts:829` → consent 조회 (내장은 consent가 없음)

게다가 영속화되므로 앱 업데이트로 내장 매니페스트가 바뀌어도 디스크의 낡은 레코드가 남는다. 콜사이트를 전부 가드해야 하는 형태.

**B. `BUILTIN_PLUGINS`를 매니페스트의 유일한 출처로 유지하고 `builtinDisabled: string[]`만 영속화** ← **채택**

매니페스트가 항상 번들에서 신선하게 온다. 새 콜사이트는 `loadBuiltinPlugins()` 필터와 토글 액션 둘. **enabled 맵이 아니라 disabled 목록**인 것이 핵심: 다음 릴리스에 내장이 추가돼도 마이그레이션 없이 기본 켜짐이 된다.

**C. settings 스토어 보관** — 플러그인 상태가 두 스토어로 쪼개지고 settings store version을 13으로 올려야 한다. 이점 없음.

### 5.2 B안이 만드는 콜사이트 (닫아야 함)

`PluginSettingsForm`은 매니페스트를 `installedPlugins[id] ?? devPlugins[id]`에서만 찾는다(`PluginSettingsForm.tsx:44`). B안은 내장을 `installedPlugins`에 넣지 않으므로 **내장의 설정 폼이 영원히 안 그려진다 — 조용히, 오류 없이.**

해결: `plugin-sources.ts`에 `manifestFor(pluginId)`(installed → dev → builtin 순 조회)를 두고 이 한 줄이 그것을 쓴다.

### 5.3 데이터 모델

```ts
// src/plugins/plugin-sources.ts (신설)
type PluginSource = "builtin" | "community" | "dev";

interface PluginRow {
  source: PluginSource;
  manifest: PluginManifest;
  /**
   * builtin: `builtinDisabled`에 없으면 true
   * community: `InstalledPlugin.enabled`
   * dev: 항상 true — 토글로 렌더되지 않는다 (§3.1)
   */
  enabled: boolean;
  error?: string;
  /** community만 채워짐 */
  installed?: InstalledPlugin;
  updateVersion?: string;
  revocation?: Revocation | null;
}

/** installed → dev → builtin 순 조회. §5.2의 콜사이트가 이것을 쓴다. */
function manifestFor(pluginId: string): PluginManifest | undefined;
```

행이 무엇을 할 수 있는지는 `source`에서 파생되며, 컴포넌트가 개별 판단하지 않는다.

### 5.4 lifecycle 변경 (세 곳)

1. `loadBuiltinPlugins()` — `builtinDisabled`에 없는 것만 활성화
2. `deactivateBuiltin(id)` **신설** — 현재 `shutdownBuiltinPlugins()`는 `activeBuiltins.splice(0)`로 전체를 비우므로 하나만 떼어내는 함수를 분리하고, 전체 종료는 그것을 반복 호출한다
3. 내장 매니페스트도 `validateManifest()`를 통과시킨다 — Media Viewer가 `engines: ">=0.4.0"`(그 built-in을 담은 적 없는 두 릴리스를 가리키는 거짓 floor)으로 출하된 이유는 **아무것도 내장 매니페스트를 검증하지 않기 때문**이다.

   ‼️ **정정 (2026-08-06, 계획 작성 중 실측)**: 그 값은 **이미 `>=0.5.0`으로 고쳐져 있다**(`media-viewer.ts:30`). 없는 것은 검증뿐이므로 이 항목은 수정이 아니라 **가드 추가**다. 그리고 `validateManifest(MEDIA_VIEWER_MANIFEST)`는 오늘 통과한다(`main: "(builtin)"`은 비어 있지 않은 문자열이고, 경로 이탈 검사는 `sandboxed` 티어에만 걸린다). 즉시 통과하는 가드는 비어 있을 수 있으므로 mutation으로 실패를 확인하는 단계가 필수다.

   부수 사실: `validateManifest`는 성공 시 `{ valid: true }`를 반환하며 **`errors` 키가 없다** — `toEqual([])`로 단정하면 항상 실패한다.

내장 비활성은 재시작이 필요 없다: Media Viewer는 `tiptapExtensions`가 없고 `unregisterPluginUI(id)`가 뷰어 등록을 걷어낸다. 내장이 tiptap 확장을 기여하게 되면 커뮤니티와 같은 재시작 안내가 필요하며, 그 조건은 이미 `manifest.tiptapExtensions?.length`로 존재한다.

## 6. 컴포넌트 분해

| 파일 | 역할 | 대략 |
|---|---|---|
| `PluginMarketplace.tsx` | 셸: 탭, 검색, 폐기 목록 안내문, 상세 라우팅 | ~150줄 |
| `usePluginActions.ts` (신설) | install/update/uninstall/toggle + consent 프로미스 | ~450줄 |
| `PluginInstalledList.tsx` (신설) | `PluginRow[]`를 세 섹션으로 그룹핑 | ~90줄 |
| `PluginRow.tsx` (신설) | 행 하나. 액션 세트를 `source`에서 파생 | ~120줄 |
| `PluginBrowseList.tsx` (신설) | 레지스트리 카드 목록 | ~60줄 |
| `plugin-sources.ts` (신설) | 세 출처 → `PluginRow[]` 파생 + `manifestFor` | ~80줄 |
| `PluginSettingsPage.tsx` (신설) | 플러그인당 설정 페이지 (§7) | ~70줄 |

**핸들러는 훅으로 순수 이동한다.** 그 450줄은 §260/#261 리뷰 6라운드가 쌓은 보안 로직이고(스테이징, consent 재검증, in-flight 가드, 언로드 복구), 기존 테스트는 UI를 통해 그 동작을 검증한다 — 훅으로 옮기면 테스트가 그대로 유효하다. 재작성 대상이 아니다.

**액션 세트 판단은 `PluginRow` 안의 `source` 스위치 하나로 모은다.** 판단 지점이 하나면 다음 탭이 같은 누락을 되풀이할 수 없다.

**CSS**: `.plugin-row`, `.plugin-section` 계열을 `plugins.css`로 내리고 토큰(`--color-*`, `--shadow-*`)을 쓴다. `PluginCard`의 인라인 hover(`onMouseEnter`로 배경색 직접 대입)도 CSS `:hover`로 바뀐다.

**좁은 폭 제약**: 같은 컴포넌트가 사이드바(~280px)와 설정 모달(넓음) 양쪽에 뜨므로, 행은 단일 컬럼 + 오른쪽 정렬 액션으로 설계하고 설명문만 잘린다. 폭에 따라 레이아웃을 분기하지 않는다.

**섹션 접기 상태는 영속화하지 않는다.** 컴포넌트 state, 기본 전부 펼침.

**개발 중 섹션**은 `PluginDeveloperSection`을 통째로 유지하되 세 번째 섹션 자리에 놓는다. 폴더 불러오기 버튼이 유일한 진입점이므로 목록이 비어도 표시한다.

## 7. 설정 단일화

1. **`activePluginTab`(로컬, tabId) → `activePluginSettings: string | null`(UI 스토어, pluginId)**. pluginId여야 하는 이유: 선언 필드만 가진 플러그인은 tabId가 없어 가리킬 수 없다. **영속화하지 않는다**(§9 R2).

2. **`openSettings()` 신설.** UI 스토어에는 `toggleSettings`만 있다(`ui.ts:214`) — 사이드바 ⚙가 그걸 쓰면 이미 열린 창을 닫아버린다. 사이드바 ⚙ = `setActivePluginSettings(id)` + `openSettings()`.

3. **`PluginSettingsPage.tsx`** — 플러그인 이름 헤더 + `PluginSettingsForm`(선언 필드) + 그 플러그인의 등록 탭 **전부**. `addSettingsTab`은 `${pluginId}:${opts.id}`로 네임스페이스를 붙여 배열에 push하므로(`extension-context.ts:689`) 한 플러그인이 탭을 여러 개 등록할 수 있다.

4. **좌측 내비 "플러그인" 그룹의 나열 기준 변경.** 지금은 등록 탭이 있는 것만(`pluginTabs.length > 0`, `SettingsModal.tsx:128`). 앞으로는 **설정 UI를 가진 모든 플러그인** — `declaredSettingsFor(manifest).length > 0 || 등록 탭 존재` — 이고 세 출처 전부 포함한다.

5. **인라인 폼 3곳 제거**: `PluginMarketplace.tsx:1216`, `PluginDetail.tsx:333`, `PluginDeveloperSection.tsx:206`. 셋 다 ⚙ 라우팅으로 대체한다. 상세 화면에서도 제거하는 것이 이 결정의 요점 — 설정 장소가 둘이면 단일화가 아니다.

6. **⚙는 설정 UI가 있는 플러그인에만 표시.** 판정은 4번과 같은 함수를 쓴다 — 두 곳이 다른 답을 내면 "⚙를 눌렀는데 빈 페이지"가 된다.

7. **정리 effect의 기준 이동.** `SettingsModal.tsx:50-55`를 pluginId 기준으로 옮긴다. 사유가 하나 늘어난다: **비활성화**도 등록 탭을 걷어낸다(`unregisterPluginUI`). 이때 선언 필드는 `installedPlugins`에 남으므로 페이지는 유지되고 등록 탭 부분만 사라지는 게 맞다 — 껐다고 값을 잃으면 안 된다.

## 8. 테스트 계획

### A. 구분과 액션 세트
1. 내장이 Installed 탭에 나타난다 (현재 나타나지 않음 — 이 작업의 회귀 앵커)
2. **내장 섹션 안에서** 삭제·업데이트 버튼이 0개. ‼️ 전역 부재 단정 금지 — 같은 목록의 커뮤니티 행이 삭제 버튼을 갖고 있어 전역 질의는 결과가 뒤집힌다. `within(builtinSection)` + 개수 단정
3. 커뮤니티 섹션 안에서 삭제·업데이트가 각각 정확히 1개
4. 섹션 **순서**가 내장 → 커뮤니티 → 개발 중 (순서를 안 고정하면 우연히 맞는 상태가 통과)

### B. 내장 토글 lifecycle
5. off → `builtinDisabled` 기록 + `matchFileViewer`가 png에 null. **그리고 다시 on → 뷰어 복귀** (한 방향만 보면 재활성 경로가 죽어도 통과)
6. 스토어 재수화 후 `initializePlugins` → 비활성 내장의 `activate` 호출 0회
7. **새 내장 추가 시 기본 켜짐** — `builtinDisabled`가 다른 id를 담고 있어도 새 픽스처가 활성돼야 한다 (disabled 목록 방식의 핵심 보장)
8. 내장 비활성 → 커뮤니티 뷰어가 png를 잡는다 (지금은 불가능한 시나리오 = 이 작업의 사용자 가치)

### C. 매니페스트 검증
9. `BUILTIN_PLUGINS` **전원**이 `validateManifest` 통과. 픽스처가 아니라 실제 배열을 순회해야 의미가 있다

### D. 설정 단일화
10. 내장의 선언 필드 폼이 렌더된다 (`manifestFor`의 builtin 조회)
11. 선언 필드만 가진 플러그인이 좌측 내비에 나타난다
12. 한 플러그인의 등록 탭 2개가 한 페이지에 둘 다 렌더된다
13. 사이드바 ⚙ → 설정 창이 열린다. **그리고 이미 열려 있을 때 닫히지 않는다** (`toggleSettings` 오용을 잡는 유일한 테스트)
14. 비활성화 → 등록 탭은 사라지고 선언 필드는 남는다
15. 가리키던 플러그인 삭제 → 초기화, 크래시 없음

### E. 기존 보안 동작 회귀
16. 훅 추출 후 §260/#261 테스트들의 **assertion이 하나도 바뀌지 않고** 통과 — `plugin-install-consent`, `plugin-engines-gate`, `plugin-revoked-gates`, `plugin-marketplace-toggle`, `plugin-installed-detail-route`, `legacy-install-upgrade`. assertion이 바뀌면 리팩터가 아니라 동작 변경이다

   ‼️ **정정 (2026-08-06, 계획 작성 중 실측)**: "파일이 수정 없이 통과"는 성립하지 않는다. `plugin-marketplace-toggle.test.tsx:57`의 헬퍼가 `screen.findByRole("checkbox")` — **단수** — 이므로, 내장이 Installed 탭에서 토글을 갖는 순간 "found multiple elements"로 던진다. 실측으로 이 파일이 **유일한** 모호 질의다(`plugin-install-consent`의 `getByRole("checkbox")`는 `within(dialog)`로 스코핑돼 안전하다).

   그래서 E16이 실제로 보증하는 것은 **질의 스코핑만 좁히고 assertion은 그대로 둔다**이며, 그 한 헬퍼가 유일한 허용 변경이다.

## 9. 위험

| | 위험 | 완화 |
|---|---|---|
| R1 | **훅 추출이 보안 로직을 미묘하게 바꿈** — in-flight 가드·스테이징 discard·언로드 복구·consent 프로미스 수명이 얽혀 있고 전부 리뷰 라운드의 산물 | 순수 이동만, 같은 커밋에서 리팩터 금지. E16이 게이트 |
| R2 | `activePluginSettings` 영속화 시 삭제된 플러그인 id가 디스크에 남아 다음 실행에 빈 페이지로 열림 | `partialize`에서 제외 |
| R3 | 내장을 끈 뒤 PNG를 열면 `viewer.noPlugin`이 뜨는데, 문구가 "내장 뷰어를 껐다"를 말하지 않으면 버그로 읽힘 | 문구 수정 포함 |
| R4 | CSS 인라인 → 클래스 이관의 시각적 회귀는 테스트로 안 잡힘 (`audit:css-vars`는 미정의 변수만) | 사이드바·설정 양쪽 폭에서 실제 앱 육안 확인 |

## 10. 작업 순서

의존성: 1·2 독립 / 3은 1 의존 / 4는 3 이후 / 5는 1의 `manifestFor` 의존

**PR 두 개로 나눈다.** 단계 1~4(구분 + 분해)와 단계 5(설정 단일화)는 `manifestFor` 하나로만 이어져 있고, 각자 독립적으로 리뷰 가능한 크기다. 하나의 PR로 묶으면 R1(보안 로직 순수 이동)의 리뷰가 설정 라우팅 변경에 섞여 흐려진다. 단계 6의 i18n 키는 각 PR이 자기 것을 가져간다.

1. `plugin-sources.ts` + `manifestFor` + `builtinDisabled` 스토어 + 내장 개별 lifecycle (§5)
2. 내장 매니페스트 검증 테스트 + mutation 확인 (§5.4-3 — `engines`는 이미 고쳐져 있어 수정 대상이 아니다)
3. `PluginRow` / `PluginInstalledList` / 섹션 CSS (§6)
4. 핸들러 → `usePluginActions` 순수 이동, 셸 축소 (§6)
5. 설정 단일화 (§7)
6. i18n 키 en/ko: `plugin.section.builtin`/`.community`/`.dev`, `plugin.builtin.badge`, 내장에 삭제가 없는 이유 툴팁, `viewer.noPlugin` 문구 수정

## 11. 범위 밖 (백로그)

- **설정 검색이 플러그인 설정 필드까지 색인** — 지금 `SettingsSearchResults`는 앱 설정만 다루며, 확장하면 이 작업이 설정 검색 리팩터로 번진다
- **`baram-word-count`를 내장으로 승격** — 현재 라이브 레지스트리에 발행된 커뮤니티 플러그인이며, 승격은 별개의 제품 결정
- **내장 그룹 단위 일괄 Enable/Disable** (JetBrains에 있음) — 내장이 1개인 지금은 무의미
- **폭에 따른 레이아웃 분기** — 행은 280px에서 동작하도록 설계하고 분기하지 않는다
