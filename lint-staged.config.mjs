// Local hooks auto-fix what they can (lint-staged re-stages the fixes);
// CI stays read-only via `npm run lint` (--check / no --fix).
export default {
  // `--no-warn-ignored`: this glob matches `src/{styles,types}/generated/`, which
  // `eslint.config.js` ignores on purpose (an `eslint --fix` there would fight
  // `tokens:build` over key order — the comment above that `ignores` block has the
  // detail). Without the flag ESLint answers with a "File ignored…" WARNING, and
  // `--max-warnings=0` turns that into a failed commit. It fires only when a commit
  // carries a regenerated palette, which is exactly what adding a design token does.
  // The flag keeps the single source of ignore truth in `eslint.config.js` rather
  // than restating the directory list here, where the two could drift.
  'src/**/*.{ts,tsx}': [
    'prettier --write',
    'eslint --fix --max-warnings=0 --no-warn-ignored',
  ],
  'src/**/*.css': ['prettier --write', 'stylelint --fix --max-warnings=0'],
  'src-tauri/src/**/*.rs': () => 'cargo fmt --manifest-path src-tauri/Cargo.toml --check',
}
