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
    // 이 규칙이 통과시키는 값: px 리터럴이 없는 값 전부 — 0 · 0px · 백분율 · em/rem 등
    // 다른 단위, 그리고 px 없는 var()/calc()/clamp(). 음수 px(`-1px`)와 px 를 담은
    // calc()/clamp()(`calc(24px + …)`)는 이 규칙이 막는다 — R-C 가 그 둘을 토큰화하지 않고
    // 리터럴로 남기는 정책이라 선언마다 disable 주석에 이유가 붙는다.
    // 그 정책의 근거는 0097 의 R-C 에 있다.
    // ‼️ property 키는 끝을 닫는다(`$`) — 안 그러면 `radius` 가 `generated/primitives.css`
    // 의 토큰 정의(`--radius-sm: 2px` 등)에도 맞아 그 파일에서 7 errors, exit 2 를 낸다
    // (실측: 모서리 키를 `/radius/` 로 바꾸고 `npx stylelint src/styles/generated/primitives.css`).
    // `lint:css` 는 `src/**/*.css` 라 `generated/` 도 검사한다.
    //
    // ‼️ 이 문단은 이 규칙이 아니라 §365.2 밀도·모서리 다이얼을 만드는 쪽에 남기는 것이다.
    // 이 규칙이 선언을 스케일로 보내지만, 스케일의 토큰 둘은 다이얼이 곱하면 안 된다(0097 R-C):
    //   - `--space-px` (1px) 는 헤어라인이다. 곱하면 1px 가 아니게 된다(× 0.75 → 0.75px).
    //     쓰는 선언 58개 — padding 계열 49 · gap 5 · margin 계열 4 (2026-09-23, `css-rules.ts` 의
    //     `cssRules`·`cssDeclarations` 로 편 선언 중 값에 `var(--space-px)` 가 있는 것).
    //   - `--radius-full` (9999px) 은 알약·원 sentinel 이다 — 둥글기 취향이 아니라 모양이다.
    //     배수가 0 으로 내려가는 설정이 있으면 토글·배지가 사각형이 된다. 쓰는 선언 15개
    //     (같은 날, 같은 방법).
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
