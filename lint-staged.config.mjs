export default {
  'src/**/*.{ts,tsx}': ['prettier --check', 'eslint --max-warnings=0'],
  'src/**/*.css': ['prettier --check', 'stylelint --max-warnings=0'],
  'src-tauri/src/**/*.rs': () => 'cargo fmt --manifest-path src-tauri/Cargo.toml --check',
}
