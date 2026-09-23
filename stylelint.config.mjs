/** @type {import('stylelint').Config} */
export default {
  extends: ["stylelint-config-standard", "stylelint-config-recess-order"],
  rules: {
    "at-rule-no-unknown": [true, { ignoreAtRules: ["theme", "apply"] }],
    "import-notation": null,
    "selector-class-pattern": null,
    "property-no-vendor-prefix": null,
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
    // §365.2 간격·모서리는 스케일을 거친다 — 다이얼이 돌릴 것이 있어야 한다(계획 0097).
    // 허용하는 것: 0 · 백분율(원) · em/rem(타이포 축) · calc()/clamp() · 음수.
    // 그 목록의 근거는 0097 의 R-C 에 있다.
    // ‼️ property 키는 끝을 닫는다(`$`) — 안 그러면 `radius` 가 `generated/primitives.css`
    // 의 토큰 정의(`--radius-sm: 2px` 등)에도 맞아 그 파일에서 7 errors, exit 2 를 낸다
    // (0097 Task 4 개정 1 실측). `lint:css` 는 `src/**/*.css` 라 `generated/` 도 검사한다.
    "declaration-property-value-disallowed-list": [
      {
        "/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/": [
          /\b\d*[1-9]\d*px\b/u,
        ],
        "/^border(-[a-z]+)*-radius$/": [/\b\d*[1-9]\d*px\b/u],
      },
      {
        message:
          "Use a --space-*/--radius-* token; see dev/plans/0097 R-C for what may stay literal.",
      },
    ],
  },
};
