// §379 — Rust's developer-mode refusal codes, and the words a user reads for each.
//
// ‼️ The codes must match `src-tauri/src/plugin/dev_mode.rs` letter for letter;
// `__tests__/dev-mode-error-codes.test.ts` scrapes that file and compares. A drifted code does
// not fail anywhere else — it reaches the user as the raw code.
const MESSAGE_KEYS = new Map<string, string>([
  ["DEV_FOLDER_MISSING", "plugin.dev.error.folderMissing"],
  ["DEV_FOLDER_NOT_APPROVED", "plugin.dev.error.notApproved"],
  ["DEV_FOLDER_NOT_LISTED", "plugin.dev.error.notListed"],
  ["DEV_MODE_INACTIVE", "plugin.dev.error.inactive"],
  ["DEV_PLUGIN_ID_HELD", "plugin.dev.error.idHeld"],
  ["DEV_PLUGIN_ID_INSTALLED", "plugin.dev.error.idInstalled"],
  ["DEV_PLUGIN_ID_RESERVED", "plugin.dev.error.idReserved"],
  ["DEV_PLUGIN_NOT_SANDBOXED", "plugin.dev.error.notSandboxed"],
  ["DEV_PLUGIN_STORAGE_TAKEN", "plugin.dev.error.storageTaken"],
]);

/**
 * What to show for a developer-mode failure: the translated sentence for a Rust code, and
 * anything else — a manifest Rust could not parse, a missing file — as it came (spec 0058
 * 6.3: "사라진 폴더·깨진 매니페스트는 지금처럼 행 오류"). A `Map`, not an object literal, so
 * "constructor" is not a code.
 */
export function describeDevError(
  error: unknown,
  translate: (key: string) => string,
): string {
  const text = error instanceof Error ? error.message : String(error);
  const key = MESSAGE_KEYS.get(text);
  return key === undefined ? text : translate(key);
}
