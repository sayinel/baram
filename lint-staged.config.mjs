// Local hooks auto-fix what they can (lint-staged re-stages the fixes);
// CI stays read-only via `npm run lint` (--check / no --fix).
export default {
  'src/**/*.{ts,tsx}': ['prettier --write', 'eslint --fix --max-warnings=0'],
  'src/**/*.css': ['prettier --write', 'stylelint --fix --max-warnings=0'],
  'src-tauri/src/**/*.rs': () => 'cargo fmt --manifest-path src-tauri/Cargo.toml --check',
}
