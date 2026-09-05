// issue 539 — the app's answer to a right-click nobody else answered.
//
// WKWebView shows its own page menu for every `contextmenu` event that is not
// default-prevented. On the editor's chrome that menu is one item, "Reload",
// which restarts the webview and drops the session (debug builds add "Inspect
// Element"). The editor body has its own menu (ContextMenu.tsx), and so do the
// tab bars, the file tree, the tag panel and task rows — each prevents the
// default. Everything else — panels, toolbars, the status bar, settings, the
// fullscreen diagram modals' empty areas — showed Reload.
//
// One listener on document, bubble phase, mounted once at the app root (every
// route, the standalone file window included). Order of decisions:
//   1. an owner already prevented → not ours;
//   2. a text-entry control or a contenteditable → the browser's edit menu
//      (copy, paste, spelling) is the right one, exactly as ContextMenu.tsx
//      steps aside for the editor's own textareas;
//   3. a <select> → nothing (it has no text, and the page menu is all the
//      browser offers; the editor applies the same rule);
//   4. a dev build → keep the page menu so Inspect Element stays reachable;
//   5. otherwise prevent.
// The target is taken from `composedPath()`, not `event.target`: plugin panels
// render inside Shadow DOM, where `event.target` is retargeted to the host and
// an inner text input would look like chrome.
//
// The text-entry test here is narrower than the editor's blanket
// `isInNativeTextControl` (every input but checkbox/radio): the editor's inputs
// are all textual, the app's are not — a range slider or a colour picker has
// nothing to copy, so it falls through to step 5 like any other chrome.
//
// Not covered, by construction: the HTML file preview. It is an opaque-origin
// iframe whose events never reach this document; its right-click policy would
// have to live in the protocol handler's shim.
import { useEffect } from "react";

import { isInNativeSelect } from "../utils/editor/native-text-control";

/** `input` types that hold text a user may want to copy or paste. */
const TEXT_ENTRY_INPUT_TYPES: ReadonlySet<string> = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

export function useNativeContextMenuPolicy(): void {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const el = elementUnderPointer(e);
      if (el && (isTextEntry(el) || isInContentEditable(el))) return;
      if (el && isInNativeSelect(el)) {
        e.preventDefault();
        return;
      }
      // Read inside the handler so tests can stub it per case.
      if (import.meta.env.DEV) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
}

/** The element the pointer was actually over, through any Shadow DOM. */
function elementUnderPointer(e: Event): Element | null {
  const first = e.composedPath()[0] ?? e.target;
  if (first instanceof Element) return first;
  if (first instanceof Node) return first.parentElement;
  return null;
}

function isTextEntry(el: Element): boolean {
  const control = el.closest("textarea, input");
  if (control instanceof HTMLTextAreaElement) return true;
  if (control instanceof HTMLInputElement) {
    return TEXT_ENTRY_INPUT_TYPES.has(control.type);
  }
  return false;
}

/** Inside an editing host, unless the nearest `contenteditable` says "false"
 *  (a read-only island inside an editor is chrome again). */
function isInContentEditable(el: Element): boolean {
  const host = el.closest("[contenteditable]");
  return host !== null && host.getAttribute("contenteditable") !== "false";
}
