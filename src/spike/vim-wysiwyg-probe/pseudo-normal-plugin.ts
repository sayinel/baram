// §298 Vim Phase 1 WYSIWYG probe — the instrument.
//
// This plugin implements the P3 MECHANISM from the design (§3) and nothing
// else: no motions, no operators, no vim semantics. It exists so a real
// device can answer two questions that decide whether P3 survives:
//
//   1. Does `handleDOMEvents.keydown` still fire while `view.editable` is
//      false? (prosemirror-view runs custom handlers before the editable
//      gate — but the source saying so is not WKWebView doing so.)
//   2. Does `view.dispatch` still mutate a non-editable view?
//
// Every handler records what it saw, so the judgment layer can require that
// a keystroke ARRIVED before crediting anything as "blocked".

import type { ProbeEvent, ProbeMode, ProbeSource } from "./types";
import type { EditorView } from "@tiptap/pm/view";

import { Plugin, PluginKey } from "@tiptap/pm/state";

interface ProbeState {
  mode: ProbeMode;
}

export const vimProbeKey = new PluginKey<ProbeState>("vimWysiwygProbe");

// ── recorder ───────────────────────────────────────────────────────────────

let events: ProbeEvent[] = [];
let armedAt = 0;
let seq = 0;

/** Start a fresh recording window (called at the start of each step). */
export function armProbeRecorder(): void {
  events = [];
  seq = 0;
  armedAt = performance.now();
}

export function createPseudoNormalPlugin(): Plugin<ProbeState> {
  return new Plugin<ProbeState>({
    key: vimProbeKey,

    state: {
      apply(tr, value) {
        const next = tr.getMeta(vimProbeKey) as ProbeMode | undefined;
        return next ? { mode: next } : value;
      },
      init: () => ({ mode: "insert" }),
    },

    props: {
      // The declarative IME block: in normal mode the editing host goes away,
      // so WKWebView's non-cancelable composition path can never start.
      editable(state) {
        return (vimProbeKey.getState(state)?.mode ?? "insert") !== "normal";
      },

      handleDOMEvents: {
        compositionend(view, event) {
          record("dom.compositionend", probeMode(view), { data: event.data });
          return false;
        },
        compositionstart(view, event) {
          record("dom.compositionstart", probeMode(view), { data: event.data });
          return false;
        },
        copy(view) {
          // §5: copy is SUPPORTED in normal mode — never consumed.
          record("handleDOMEvents.copy", probeMode(view), { consumed: false });
          return false;
        },
        cut(view, event) {
          const mode = probeMode(view);
          const consume = mode === "normal";
          if (consume) event.preventDefault();
          record("handleDOMEvents.cut", mode, { consumed: consume });
          return consume;
        },
        drop(view, event) {
          const mode = probeMode(view);
          const consume = mode === "normal";
          if (consume) {
            event.preventDefault();
            event.stopPropagation();
          }
          record("handleDOMEvents.drop", mode, { consumed: consume });
          return consume;
        },
        keydown(view, event) {
          const mode = probeMode(view);
          // Clipboard chords stay with the browser (design §5 modifier pin);
          // everything else in normal mode belongs to the probe.
          const consume = mode === "normal" && !isClipboardChord(event);
          if (consume) event.preventDefault();
          record("handleDOMEvents.keydown", mode, {
            code: event.code,
            consumed: consume,
            isComposing: event.isComposing,
            key: event.key,
          });
          return consume;
        },
        paste(view, event) {
          const mode = probeMode(view);
          const consume = mode === "normal";
          if (consume) event.preventDefault();
          record("handleDOMEvents.paste", mode, { consumed: consume });
          return consume;
        },
      },

      // PM's editHandlers path — only reached while editable, which is
      // exactly why the design routes INSERT-mode Escape here: it inherits
      // PM's composition preprocessing.
      handleKeyDown(view, event) {
        record("handleKeyDown", probeMode(view), {
          code: event.code,
          consumed: false,
          isComposing: event.isComposing,
          key: event.key,
        });
        return false;
      },

      handleTextInput(view, _from, _to, text) {
        const mode = probeMode(view);
        record("handleTextInput", mode, {
          consumed: mode === "normal",
          data: text,
        });
        return mode === "normal";
      },
    },
  });
}

export function probeMode(view: EditorView): ProbeMode {
  return vimProbeKey.getState(view.state)?.mode ?? "insert";
}

// ── mode control ───────────────────────────────────────────────────────────

export function recordedEvents(): ProbeEvent[] {
  return [...events];
}

export function setProbeMode(view: EditorView, mode: ProbeMode): void {
  view.dispatch(view.state.tr.setMeta(vimProbeKey, mode));
  // Design §3: a non-editable host loses its natural focusability, so the
  // mechanism has to hand focus back manually via tabindex. If this does not
  // hold, no key ever arrives and step 1 fails for the wrong reason.
  if (mode === "normal") {
    view.dom.setAttribute("tabindex", "0");
    (view.dom as HTMLElement).focus();
  } else {
    view.dom.removeAttribute("tabindex");
    view.focus();
  }
}

/** True for a platform clipboard chord that §5 says must pass through. */
function isClipboardChord(event: KeyboardEvent): boolean {
  const mod = navigator.platform.includes("Mac")
    ? event.metaKey
    : event.ctrlKey;
  return mod && ["c", "v", "x"].includes(event.key.toLowerCase());
}

function record(
  source: ProbeSource,
  mode: ProbeMode,
  detail: Partial<ProbeEvent> = {},
): void {
  events.push({
    mode,
    seq: seq++,
    source,
    t: Math.round(performance.now() - armedAt),
    ...detail,
  });
}
