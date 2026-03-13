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
  },
};
