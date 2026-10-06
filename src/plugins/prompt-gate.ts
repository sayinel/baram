// §385 Who may open a plugin prompt, and when (spec 0061 §5).
//
// A prompt may open only while one of the plugin's USER commands is running AND nothing has
// been typed, clicked or dropped outside the prompt since that command started (D1). Both
// halves live here: `beginPluginInvocation` is called by `executePluginCommand` — the one
// HOST entry that grants prompt rights, its callers fixed by
// `execute-plugin-command-callers.test.ts` — and capture-phase listeners count the user's
// input. A trusted plugin's own panel clicks reach commands through `commands.execute` or a
// direct call, and grant nothing (spec 0061 §5.1). The open prompt is recorded here as well,
// so the teardown sweep (`unregisterPluginUI`) can close it without importing a component,
// and so input inside it is told apart.
//
// ‼️ Rights are PER PLUGIN, not per call: a sandbox frame names no invocation, so while a
// command runs the same plugin's event handlers may prompt too (spec 0061 §5.3).
import { deepActiveElement } from "../utils/deep-active-element";

export interface OpenPrompt {
  /** Settle the prompt with `undefined` — the teardown path. */
  close: () => void;
  pluginId: string;
  /**
   * Input whose target is a descendant of this element is the prompt's own and is not counted.
   * A target that IS this element is the backdrop around the dialog — outside the prompt — and
   * counts.
   */
  root: Element;
}

/** Keys that deliver nothing on their own; the rest of a chord is what counts. */
const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

/**
 * Live invocations per plugin — objects, not a count, so a `finally` that runs after a teardown
 * reset (a reload while a handler was pending) deletes from the OLD set and leaves the new one.
 */
const invocations = new Map<string, Set<object>>();
/** The input sequence at each plugin's latest invocation start. Absent = no rights (revoked). */
const baselines = new Map<string, number>();
let inputSeq = 0;
let watching = false;
let open: null | OpenPrompt = null;

/**
 * Enter a user-command invocation for `pluginId`; returns the exit to call in `finally`.
 *
 * Installs the input watcher on first use. Rights only ever begin here, so the watcher exists
 * whenever rights do — installing it anywhere else (app boot) is a path that can be skipped,
 * which would leave rights with nothing to end them (spec 0061 §5.2).
 */
export function beginPluginInvocation(pluginId: string): () => void {
  watchInput();
  let live = invocations.get(pluginId);
  if (!live) {
    live = new Set();
    invocations.set(pluginId, live);
  }
  const token = {};
  live.add(token);
  baselines.set(pluginId, inputSeq);
  const owner = live;
  return () => {
    owner.delete(token);
  };
}

/**
 * Forget everything held for `pluginId`, closing its prompt if one is open — the teardown sweep.
 *
 * Rights are dropped BEFORE `close()` runs, so a `close` that throws (a plugin's own teardown
 * code) cannot leave this plugin's prompt rights alive.
 */
export function clearPromptGate(pluginId: string): void {
  const toClose = open?.pluginId === pluginId ? open : null;
  invocations.delete(pluginId);
  baselines.delete(pluginId);
  toClose?.close();
}

/**
 * The prompt's own input is excluded only when its target is strictly INSIDE the overlay: the
 * overlay element itself is the backdrop, so a `drop` there must end rights like any other
 * outside drop. Focus never sits on the overlay (a `<div>` with no `tabindex`), so the keyboard
 * and `beforeinput` paths never target it; a `pointerdown` on it precedes the backdrop
 * `mousedown` that cancels the prompt anyway.
 */
function countInput(event: Event): void {
  if (event instanceof KeyboardEvent && MODIFIER_KEYS.has(event.key)) return;
  if (
    open &&
    event.target instanceof Node &&
    event.target !== open.root &&
    open.root.contains(event.target)
  )
    return;
  inputSeq += 1;
}

/**
 * §391 spec 0070 D17 — is a plugin prompt open? A plugin shortcut then leaves its key alone, so
 * a chord pressed in the prompt cannot start a second command over it.
 */
export function isPluginPromptOpen(): boolean {
  return open !== null;
}

/** The window module's hand-off when a prompt settles. */
export function markPromptClosed(prompt: OpenPrompt): void {
  if (open === prompt) open = null;
}

/** The window module's hand-off BEFORE it renders, so input inside it is never counted. */
export function markPromptOpen(prompt: OpenPrompt): void {
  open = prompt;
}

/**
 * Another surface covers where the prompt's input would be (spec 0061 D9).
 *
 * Its message is untranslated developer English, like every other string in this file — not a
 * claim that it is never SEEN. The palette's generic error toast (`CommandPalette.tsx`, which
 * shows `String(err)` for any plugin command that rejects) can and does render it verbatim, the
 * same as it would any other plugin error; there is no separate, translated path for this one.
 */
export class PromptOccludedError extends Error {
  constructor() {
    super(
      "prompt refused: another window covers where the prompt would appear",
    );
    this.name = "PromptOccludedError";
  }
}

/** Why `pluginId` may not open a prompt now, or `null` — spec 0061 §5.3 conditions 1–4. */
export function promptRefusal(pluginId: string): null | string {
  if (!invocations.get(pluginId)?.size) {
    return "a prompt can open only while one of this plugin's commands is running";
  }
  if (baselines.get(pluginId) !== inputSeq) {
    return "the user has typed, clicked or dropped something outside the prompt since the command started, or a prompt was cancelled or covered";
  }
  if (open) return "a plugin prompt is already open";
  if (deepActiveElement() instanceof HTMLIFrameElement) {
    return "focus is inside a frame, where the app cannot see what the user types";
  }
  return null;
}

/** Tests only: forget all state and remove the watcher. */
export function resetPromptGate(): void {
  if (watching) {
    window.removeEventListener("keydown", countInput, true);
    window.removeEventListener("pointerdown", countInput, true);
    window.removeEventListener("beforeinput", countInput, true);
    window.removeEventListener("drop", countInput, true);
  }
  watching = false;
  invocations.clear();
  baselines.clear();
  inputSeq = 0;
  open = null;
}

/** Take `pluginId`'s rights until its next invocation starts — a cancel or an occlusion refusal (spec 0061 §5.4). */
export function revokePromptRights(pluginId: string): void {
  baselines.delete(pluginId);
}

/**
 * Capture phase ON WINDOW: it runs before React's root listener, so the key that launches a
 * command from the palette counts BEFORE the invocation starts. In bubble phase it would count
 * after the start and revoke the rights it had just granted (spec 0061 §5.2).
 *
 * `beforeinput` and `drop` count too: macOS dictation, the character viewer and a drag-drop
 * reach the page as those with no `keydown` or `pointerdown`, and a delayed prompt would
 * otherwise take focus after them (spec 0061 D1, §5.2). A keystroke that also fires
 * `beforeinput` counts twice, which is harmless — the check is equality with the baseline, not
 * a count. Outside IME composition, the palette's launching Enter adds no `beforeinput` after
 * the start: its `keydown` is cancelled (`usePaletteListNav`), and a cancelled `keydown` fires
 * none — our half is pinned in `plugin-prompt-palette.test.tsx`; the browser's half is checked
 * by hand, by the sandbox-smoke README's steps that launch from the palette. A composing
 * Enter's commit is not stopped by `preventDefault`; that case is smoke step 8 (spec 0061
 * §5.2).
 */
function watchInput(): void {
  if (watching) return;
  watching = true;
  window.addEventListener("keydown", countInput, true);
  window.addEventListener("pointerdown", countInput, true);
  window.addEventListener("beforeinput", countInput, true);
  window.addEventListener("drop", countInput, true);
}
