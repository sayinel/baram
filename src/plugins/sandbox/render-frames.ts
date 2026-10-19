// §394 spec 0073 D13 — shape checks for the render frames and requests, for the host's
// `FRAME_VALIDATORS` / `HOST_REQUEST_VALIDATORS` and the sandbox's `invokeAction` handling. A file of
// its own so `tauri-host-transport.ts` grows by its record entries only.
import {
  MAX_CODE_BLOCK_LANG_CHARS,
  MAX_FRAME_ID_CHARS,
  MAX_RENDER_ERROR_CHARS,
  MAX_RENDERED_CSS_BYTES,
  MAX_RENDERED_HTML_BYTES,
} from "../rendered/limits";

type Fields = Record<string, unknown>;

/**
 * An `actionResult` frame. `error` gets 4 × `MAX_RENDER_ERROR_CHARS` for the reason
 * `isRenderResult`'s does: the client slices to the cap before sending, so the bound only refuses
 * a frame our client never sends — and a refused frame is dropped, which leaves the action to end
 * at `CALL_TIMEOUT_MS` instead of logging its error.
 */
export function isActionResult(m: Fields): boolean {
  return (
    isFrameId(m.id) &&
    (m.ok === true ||
      (m.ok === false &&
        typeof m.error === "string" &&
        m.error.length <= MAX_RENDER_ERROR_CHARS * 4))
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
  return isFrameId(r.id);
}

/** `render_invalidate`: no language, or one as long as a declared language can be. */
export function isRenderInvalidate(r: Fields): boolean {
  return (
    r.lang === undefined ||
    (typeof r.lang === "string" && r.lang.length <= MAX_CODE_BLOCK_LANG_CHARS)
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
  if (!isFrameId(m.id)) return false;
  if (m.ok === false) {
    return (
      typeof m.error === "string" &&
      m.error.length <= MAX_RENDER_ERROR_CHARS * 4
    );
  }
  return m.ok === true && isContentWithinFloor(m);
}

/**
 * `ui_set_panel` (§394 plan 0126 P8): a panel id and content within the floor `isRenderResult` checks,
 * for its reason. Whether the id is declared, and the exact byte counts, are the handler's
 * (`host-ui-bridge.ts`).
 */
export function isSetPanel(r: Fields): boolean {
  return typeof r.id === "string" && isContentWithinFloor(r);
}

/** `html` a string and `css` absent or a string, neither longer in UTF-16 units than its byte cap. */
function isContentWithinFloor(m: Fields): boolean {
  return (
    typeof m.html === "string" &&
    m.html.length <= MAX_RENDERED_HTML_BYTES &&
    (m.css === undefined ||
      (typeof m.css === "string" && m.css.length <= MAX_RENDERED_CSS_BYTES))
  );
}

/** An id the host minted, as a sandbox echoes it: a string of at most `MAX_FRAME_ID_CHARS`. */
function isFrameId(value: unknown): boolean {
  return typeof value === "string" && value.length <= MAX_FRAME_ID_CHARS;
}
