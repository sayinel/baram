// §394 spec 0073 D13 — shape checks for the render frames and requests, for the host's
// `FRAME_VALIDATORS` / `HOST_REQUEST_VALIDATORS` and the sandbox's `invokeAction` handling. A file of
// its own so `tauri-host-transport.ts` grows by its record entries only.
import {
  MAX_FRAME_ID_CHARS,
  MAX_RENDER_ERROR_CHARS,
  MAX_RENDERED_CSS_BYTES,
  MAX_RENDERED_HTML_BYTES,
} from "../rendered/limits";

type Fields = Record<string, unknown>;

/** An `actionResult` frame. */
export function isActionResult(m: Fields): boolean {
  return (
    typeof m.id === "string" &&
    (m.ok === true || (m.ok === false && typeof m.error === "string"))
  );
}

/** The target of an `invokeAction` — one of the two kinds, every field the right type. */
export function isActionTarget(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Fields;
  if (t.kind === "panel") return typeof t.panelId === "string";
  return (
    t.kind === "codeBlock" &&
    typeof t.lang === "string" &&
    (t.context === null || typeof t.context === "string") &&
    (t.path === null || typeof t.path === "string")
  );
}

/** `render_get_source`: an id the host minted (`render-<n>`), bounded. */
export function isRenderGetSource(r: Fields): boolean {
  return typeof r.id === "string" && r.id.length <= MAX_FRAME_ID_CHARS;
}

/**
 * `render_invalidate`: no language, or one as long as a declared language can be — 32 characters,
 * what `CODE_BLOCK_LANG` (`manifest-code-blocks.ts`) admits. Not imported: that module reaches the
 * editor's language list, and this one is in the sandbox realm.
 */
export function isRenderInvalidate(r: Fields): boolean {
  return (
    r.lang === undefined || (typeof r.lang === "string" && r.lang.length <= 32)
  );
}

/**
 * A `renderResult` frame. A string's `.length` is a floor on its UTF-8 bytes, so a frame whose
 * UTF-16 length is already over a byte cap is refused here; the exact check is the render queue's
 * (`renderedContentProblem`).
 *
 * `error` gets 4 × `MAX_RENDER_ERROR_CHARS`, not the cap itself: the client slices to the cap before
 * sending (`sandbox-code-blocks.ts`) and the host caps the text again for the chrome (`failureText`
 * → `sanitizePluginText`), so this bound only refuses a frame our client never sends — and a
 * refused frame is dropped, which the block would show as a timeout instead of the error. Change
 * one of the three and read the other two.
 */
export function isRenderResult(m: Fields): boolean {
  if (typeof m.id !== "string") return false;
  if (m.ok === false) {
    return (
      typeof m.error === "string" &&
      m.error.length <= MAX_RENDER_ERROR_CHARS * 4
    );
  }
  return (
    m.ok === true &&
    typeof m.html === "string" &&
    m.html.length <= MAX_RENDERED_HTML_BYTES &&
    (m.css === undefined ||
      (typeof m.css === "string" && m.css.length <= MAX_RENDERED_CSS_BYTES))
  );
}
