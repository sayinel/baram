// 테마 CSS가 닿으면 안 되는 화면의 단일 출처. "보안 표면"의 정의는 이름이 아니라 효과다:
// 동의·승인·회수 IPC를 호출하거나 회수 사실을 고지하는 컴포넌트. 이 목록은 손으로
// 적었지만 `src/__tests__/security-surfaces.test.ts` 가 `src/components` 전수 스캔의
// 효과(§ EFFECTS 상수)와 대조하므로 표류할 수 없다 — 새 화면이 그 효과를 부르면서
// 여기 없으면 테스트가 빨개진다.
//
// 세 파일과 그 효과(2026-09-19 실측, 위 테스트가 유지한다):
//  - PluginConsentDialog.tsx — `consentCovers` 를 불러 이미 승인된 범위인지 판정한다
//    (능력 목록 자체는 props 로 받는다 — `consentRequired`·`consentGaps` 는 안 부른다).
//  - PluginRevokedNotice.tsx — `revocationReason` 을 불러 회수 사유를 고지한다.
//  - ApprovedRootsSection.tsx — `listApprovedRoots`·`revokeApprovedRoot` 를 불러
//    vault 승인 목록을 보여주고 회수한다(승인 자체는 네이티브 폴더 선택 대화상자다).
export const SECURITY_SURFACE_FILES: readonly string[] = [
  "src/components/plugins/PluginConsentDialog.tsx",
  "src/components/plugins/PluginRevokedNotice.tsx",
  "src/components/settings/tabs/ApprovedRootsSection.tsx",
];
