// §298 Vim Phase 1 core — keystroke normalization.
//
// Kept apart from the state machine so platform quirks live in one place and
// the machine can be driven from plain object literals in tests.

import type { KeyToken } from "./types";

/** The subset of KeyboardEvent the core needs. Structural on purpose: tests
 *  build these as literals instead of synthesizing DOM events. */
export interface KeyLike {
  altKey: boolean;
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
  return {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    key: event.key,
    mod: isMac ? event.metaKey : event.ctrlKey,
    shift: event.shiftKey,
  };
}
