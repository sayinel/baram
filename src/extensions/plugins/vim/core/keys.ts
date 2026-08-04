// §298 Vim Phase 1 core — keystroke normalization.
//
// Kept apart from the state machine so platform quirks live in one place and
// the machine can be driven from plain object literals in tests.

import type { KeyToken } from "./types";

/** The subset of KeyboardEvent the core needs. Structural on purpose: tests
 *  build these as literals instead of synthesizing DOM events. */
export interface KeyLike {
  altKey: boolean;
  /** Physical key (KeyboardEvent.code) — the Korean-layout fallback needs
   *  it; optional so object-literal tests without it stay valid. */
  code?: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Detect the current platform once, at the call site that owns the event. */
export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.includes("Mac");
}

/**
 * Design §5 modifier pin. On macOS `Mod` is Command and the physical Control
 * stays available as a vim modifier (<C-r>). Everywhere else Control plays
 * both parts, so a token can be `mod` and `ctrl` at once — the state machine
 * resolves that by matching vim's chords first and passing the rest through.
 */
export function toKeyToken(event: KeyLike, isMac: boolean): KeyToken {
  const key = layoutKey(event);
  return {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    key,
    mod: isMac ? event.metaKey : event.ctrlKey,
    ...(key === event.key ? {} : { raw: event.key }),
    shift: event.shiftKey,
  };
}

/** Hangul jamo, compatibility jamo, and syllables — what a letter key
 *  produces while the Korean input source is active. */
const HANGUL_CHAR = /^[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]$/;
const LETTER_CODE = /^Key([A-Z])$/;

/**
 * vim's langmap idea, scoped to the one case we can decide safely: the
 * produced character is HANGUL and the physical key is a plain letter —
 * then the user pressed `j`, the layout just spelled it `ㅓ`. Everything
 * else (latin letters on any layout, symbols, digits, controls) keeps
 * event.key, so dvorak-style remappings and shift-symbols stay untouched.
 * Insert mode never sees this: its keys go through PM as real typing.
 */
function layoutKey(event: KeyLike): string {
  if (!HANGUL_CHAR.test(event.key)) return event.key;
  const letter = LETTER_CODE.exec(event.code ?? "");
  if (!letter) return event.key;
  return event.shiftKey ? letter[1] : letter[1].toLowerCase();
}
