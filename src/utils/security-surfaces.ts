// 테마 CSS가 닿으면 안 되는 화면의 단일 출처. "보안 표면"의 정의는 이름이 아니라 효과다:
// 동의·승인·회수 IPC를 호출하거나 회수 사실을 고지하는 컴포넌트. 코퍼스는 `src/components`
// 아래 `.ts`+`.tsx` 전부, `__tests__` 디렉터리는 제외한다 — 이 파일이 `src/utils/`에 있는
// 것은 그 코퍼스 **밖**에 두기 위해서다: 아래 네 효과 이름을 전부 담은 이 주석이
// `src/components/` 안에 있었다면 스스로를 표면으로 잡았을 것이다.
//
// 이 두 목록은 손으로 적었지만 `src/__tests__/security-surfaces.test.ts`가 매번 같은
// 코퍼스를 다시 스캔해 둘의 합집합과 대조하고, 둘이 겹치지 않는지도 검사한다 — 스캔이
// 찾은 파일을 빠뜨리거나 두 목록 모두에 넣을 수는 없다. 그것만으로는 **분류**까지
// 지키지 못한다: 그리는 파일을 `NON_RENDERING_EFFECT_CALLERS`로 옮겨도(또는 그
// 반대로) 두 검사 다 그대로 통과한다. 그래서 같은 테스트가 두 목록의 원소를 그
// **모양**으로도 검사한다 — `SECURITY_SURFACE_FILES`는 전부 `.tsx`(JSX를 담을 수
// 있다는 뜻), `NON_RENDERING_EFFECT_CALLERS`는 전부 `.ts`이면서 DOM 구성 마커 열두
// 개(`security-surfaces.test.ts`의 `DOM_CONSTRUCTION_MARKERS` — 그 파일 자체 코퍼스
// 명시와 함께) 중 아무것도 없다. 이 두 검사가 함께 막는 것: React 컴포넌트는
// `.ts`에 있을 수 없고(JSX는 `.ts`에서 TS1161 로 파싱조차 안 된다 — `npm run
// typecheck`가 강제), 그 열두 관용구로 명령형 DOM을 짓는 `.ts` 파일도 두 번째
// 목록에 못 들어간다. 막지 못하는 것 둘: (1) 그 열두 개 밖의 DOM 구성 방법 —
// 마커 목록은 이 코드베이스에서 실측한 관용구 기준이지 전체 DOM API 의 전수
// 목록이 아니다, (2) `NON_RENDERING_EFFECT_CALLERS`의 `.ts` 파일이 **다른 파일에
// 위임해** 무언가를 그리는 경로 — 이 스캔은 그 파일 자신의 소스만 본다.

/**
 * 그린다 — shadow DOM 대상. 셋(2026-09-19 실측, 위 테스트가 유지한다):
 *  - PluginConsentDialog.tsx — `consentCovers` 를 불러 이미 승인된 범위인지 판정한다
 *    (능력 목록 자체는 props 로 받는다 — `consentRequired`·`consentGaps` 는 안 부른다).
 *  - PluginRevokedNotice.tsx — `revocationReason` 을 불러 회수 사유를 고지한다.
 *  - ApprovedRootsSection.tsx — `listApprovedRoots`·`revokeApprovedRoot` 를 불러
 *    vault 승인 목록을 보여주고 회수한다(승인 자체는 네이티브 폴더 선택 대화상자다).
 */
export const SECURITY_SURFACE_FILES: readonly string[] = [
  "src/components/plugins/PluginConsentDialog.tsx",
  "src/components/plugins/PluginRevokedNotice.tsx",
  "src/components/settings/tabs/ApprovedRootsSection.tsx",
];

/**
 * 같은 코퍼스에서 같은 네 효과 중 하나를 부르지만, 텍스트를 계산해 다른 파일의
 * prop 으로 넘기거나 코드로 설치를 막을 뿐 자기 소스에는 JSX 도 DOM 구성 마커도
 * 없다(위 파일 헤더의 두 검사가 강제하는 것 — "아무것도 그리지 않는다"는 더 강한
 * 주장이고 여기서는 하지 않는다). shadow DOM 대상이 아니다.
 *
 *  - usePluginActions.ts(:187,:333) — `revocationReason`으로 "설치 차단" 에러 텍스트를
 *    만든다. 이 파일이 `.tsx`가 아니라 `.ts`인 것은 이 코퍼스 스캔과 무관한 기존
 *    관례다: 같은 디렉터리의 `plugin-ui-i18n.test.tsx`가 `.tsx`만 보므로, JSX를 담지
 *    않는 이 훅을 `.ts`로 분리해 뒀다(파일 자체 헤더 주석 :17-19). 코퍼스가 `.tsx`만
 *    봤다면 이 파일은 조용히 빠졌을 것 — 그래서 코퍼스를 `.ts`까지 넓혔다.
 */
export const NON_RENDERING_EFFECT_CALLERS: readonly string[] = [
  "src/components/plugins/usePluginActions.ts",
];
