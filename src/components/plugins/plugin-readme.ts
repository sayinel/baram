// §69 A plugin's README, read through the asset protocol.
//
// ‼️ NOT through `readFile`. That IPC is vault-constrained (`fs_cmd.rs:152` → `check_vault`
// → `validate_path_any`), and a plugin installs outside every registered context, so the
// read was denied and the caller's `.catch` reported it as "no README" — silently, for every
// installed plugin, not only for built-ins.
//
// The asset protocol is already permitted for exactly this directory:
// `plugin_prepare_scopes` grants it recursively and forbids `.staging`, and the app CSP
// lists `asset:` under `connect-src`. `plugin-loader.ts` loads plugin code the same way.
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Cap on the README handed to the renderer.
 *
 * The content is author-controlled and `MarkdownRenderer` parses it to mdast and then to
 * React elements on the main thread, so this bounds a freeze, not a disclosure. ‼️ It caps
 * what is RENDERED, not what is read: the response body is already in memory by the time
 * this applies. Bounding the read needs a streaming reader over `res.body`.
 */
export const MAX_README_BYTES = 256 * 1024;

/**
 * `installPath` empty means a built-in — compiled into the app, nothing on disk. Returning
 * early matters: joining onto "" asks for `/README.md`, the filesystem root.
 */
export async function readPluginReadme(
  installPath: string,
): Promise<null | string> {
  if (!installPath) return null;

  const res = await fetch(convertFileSrc(`${installPath}/README.md`));
  if (!res.ok) return null;

  const text = await res.text();
  return text.length > MAX_README_BYTES
    ? text.slice(0, MAX_README_BYTES)
    : text;
}
