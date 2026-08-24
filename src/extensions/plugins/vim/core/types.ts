// §298 Vim Phase 1 — core vocabulary (design §2: "순수 상태머신, PM import 0").
//
// The core translates keystrokes into INTENTS. It knows nothing about
// ProseMirror: no positions are resolved here, no transactions are built. That
// boundary is what makes the whole modal layer unit-testable without a DOM,
// and it is why VisualState carries opaque numbers the adapters supply.

/**
 * What the core asks the adapters to do. One keystroke yields at most one
 * command; multi-key sequences (`dd`, `gg`) emit only on completion.
 */
export type CoreCommand =
  | { after: boolean; count: number; type: "paste" }
  | { at: InsertAnchor; type: "enterInsert" }
  | { below: boolean; type: "openLine" }
  | {
      char: string;
      count: number;
      kind: FindKind;
      op: OperatorKey;
      type: "operatorFind";
    }
  | {
      char: string;
      count: number;
      kind: FindKind;
      repeat?: boolean;
      type: "findChar";
    }
  | {
      count: number;
      direction: SearchDirection;
      pattern: string;
      type: "search";
    }
  | { count: number; motion: Motion; op: OperatorKey; type: "operatorMotion" }
  | { count: number; motion: Motion; type: "move" }
  | { count: number; type: "changeLine" }
  | { count: number; type: "deleteCharForward" }
  | { count: number; type: "deleteLine" }
  | { count: number; type: "redo" }
  | { count: number; type: "undo" }
  | { count: number; type: "yankLine" }
  | { firstNonBlank: boolean; type: "scrollCursor" }
  | { name: string; type: "exCommand" }
  | { type: "deleteVisual" }
  | { type: "enterVisual" }
  | { type: "leaveVisual" }
  | { type: "yankVisual" };

/** f/F = to the char, t/T = till just before it; capitals go backward. */
export type FindKind = "f" | "F" | "t" | "T";

/** Where `i a I A` place the cursor before entering insert. */
export type InsertAnchor = "afterCursor" | "atCursor" | "lineEnd" | "lineStart";

/** A keystroke, already normalized for the platform's Mod key. */
export interface KeyToken {
  alt: boolean;
  /** The PHYSICAL control key. On macOS this is a vim modifier in its own
   *  right (<C-r>), distinct from Mod — mixing them would misread Ctrl+C as
   *  a clipboard chord (design §5 modifier pin). */
  ctrl: boolean;
  /** `event.key`, e.g. "j", "Escape", "$". */
  key: string;
  /** The platform command modifier: metaKey on macOS, ctrlKey elsewhere. */
  mod: boolean;
  /** Pre-layout-remap event.key — find arguments must stay literal (a
   *  hangul target searches hangul), so f/F/t/T read this when present. */
  raw?: string;
  shift: boolean;
}

/** Cursor movements the adapters resolve against the document. */
export type Motion =
  | "charLeft"
  | "charRight"
  | "docEnd"
  | "docStart"
  | "lineDown"
  | "lineEnd"
  | "lineFirstNonBlank"
  | "lineStart"
  | "lineUp"
  | "wordBack"
  | "wordForward";

/** Change/delete/yank — the charwise-capable operators. */
export type OperatorKey = "c" | "d" | "y";

/** Operators and prefixes waiting for their next key. `cg`/`dg`/`yg` are an
 *  operator holding a g-prefix (dgg); `z` awaits its scroll variant. */
export type PendingKey =
  | "g"
  | "z"
  | `${OperatorKey}${FindKind}`
  | `${OperatorKey}g`
  | FindKind
  | OperatorKey;

/** `/` = forward, `?` = backward — vim's buffer-local search (§298 tier 3). */
export type SearchDirection = "backward" | "forward";

/**
 * The result of feeding one key to the core.
 *
 * `handled: false` means the core wants nothing to do with this keystroke —
 * the caller must let it through to the rest of the app (menu accelerators,
 * clipboard chords). Anything else would swallow Cmd+S in normal mode.
 */
export interface StepResult {
  command: CoreCommand | null;
  handled: boolean;
  state: VimCoreState;
}

export interface VimCoreState {
  /** Accumulated count prefix, or null when none is being typed. */
  count: null | number;
  /** Text typed after `:`, WITHOUT the colon — null when no ex line is open.
   *  An empty string means the user has typed `:` and nothing else. */
  exLine: null | string;
  /** Last f/F/t/T target, for ; and , repeats. */
  lastFind: null | { char: string; kind: FindKind };
  /** Last executed search — `n`/`N` replay it (vim's search register). */
  lastSearch: null | { direction: SearchDirection; pattern: string };
  mode: VimMode;
  pending: null | PendingKey;
  /** Digits typed AFTER an operator (d2w) — multiplied with `count` at
   *  resolution, per vim (2d3w = 6). */
  pendingCount: null | number;
  /** Open `/` or `?` line — the StatusBar shows it instead of the mode. */
  searchLine: null | { direction: SearchDirection; text: string };
  visual: null | VisualState;
}

export type VimMode = "insert" | "normal" | "visual";

/**
 * Visual-mode selection in vim terms (design §6). PM's TextSelection carries
 * no vim meaning: the anchor stays put while the head moves, and the rendered
 * selection is inclusive of the unit under the head. Both fields are opaque
 * document positions the adapters hand back to the core.
 */
export interface VisualState {
  anchorCursor: number;
  headCursor: number;
  /** v = charwise, V = linewise (§6). */
  kind: "char" | "line";
}

export function initialCoreState(mode: VimMode = "normal"): VimCoreState {
  return {
    count: null,
    exLine: null,
    lastFind: null,
    lastSearch: null,
    mode,
    pending: null,
    pendingCount: null,
    searchLine: null,
    visual: null,
  };
}
