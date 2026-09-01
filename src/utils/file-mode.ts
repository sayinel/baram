// §89 File mode detection — resolved once at module load (URL params don't
// change). Shared by `use-plugin-lifecycle.ts` (the plugin runtime is
// disabled for a file-mode window) and `AppRoot` (routes to `FileEditorLayout`).
const _fileModeParams = new URLSearchParams(window.location.search);
export const FILE_MODE_PATH =
  _fileModeParams.get("mode") === "file" ? _fileModeParams.get("path") : null;
