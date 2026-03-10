/**
 * Key utilities for platform-independent keyboard shortcut notation.
 * §settings: keybinding customization support
 */

export interface ParsedKey {
  alt: boolean;
  key: string;
  mod: boolean;
  shift: boolean;
}

/** e.code values that are bare modifiers — produce no binding notation */
const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

/** Map e.code → display key string for non-letter/digit keys */
const CODE_TO_KEY: Record<string, string> = {
  Slash: "/",
  Period: ".",
  Comma: ",",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Space: "Space",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

/**
 * Convert a KeyboardEvent to a platform-independent notation string.
 * e.g. Cmd+S on macOS → "Mod+S", Ctrl+Shift+F → "Mod+Shift+F"
 *
 * Returns "" for bare modifier key presses.
 */
export function normalizeKeyEvent(e: KeyboardEvent, isMac: boolean): string {
  if (MODIFIER_CODES.has(e.code)) return "";

  const mod = isMac ? e.metaKey : e.ctrlKey;
  const shift = e.shiftKey;
  const alt = e.altKey;

  // Resolve key name from e.code (layout-independent)
  let key: string;
  if (e.code.startsWith("Key")) {
    // "KeyS" → "S"
    key = e.code.slice(3);
  } else if (e.code.startsWith("Digit")) {
    // "Digit1" → "1"
    key = e.code.slice(5);
  } else if (e.code.startsWith("Numpad")) {
    // "Numpad1" → "Numpad1"
    key = e.code;
  } else if (CODE_TO_KEY[e.code] !== undefined) {
    key = CODE_TO_KEY[e.code];
  } else {
    // Fallback: use e.key for unrecognized codes
    key = e.key;
  }

  const parts: string[] = [];
  if (mod) parts.push("Mod");
  if (shift) parts.push("Shift");
  if (alt) parts.push("Alt");
  parts.push(key);

  return parts.join("+");
}

/** macOS symbol map for display formatting */
const MAC_SPECIAL_DISPLAY: Record<string, string> = {
  Escape: "Esc",
  Enter: "↩",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const WIN_SPECIAL_DISPLAY: Record<string, string> = {
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/**
 * Format a notation string for human-readable display.
 * macOS: ⌘⇧F style (symbols, no separators for modifiers)
 * Others: Ctrl+Shift+F style (text with + separators)
 */
export function formatKeyForDisplay(notation: string, isMac: boolean): string {
  if (!notation) return "";

  const parsed = parseKeyNotation(notation);
  const { mod, shift, alt, key } = parsed;

  if (isMac) {
    const keyDisplay = MAC_SPECIAL_DISPLAY[key] ?? key;
    return (
      (mod ? "\u2318" : "") + // ⌘
      (shift ? "\u21E7" : "") + // ⇧
      (alt ? "\u2325" : "") + // ⌥
      keyDisplay
    );
  } else {
    const keyDisplay = WIN_SPECIAL_DISPLAY[key] ?? key;
    const parts: string[] = [];
    if (mod) parts.push("Ctrl");
    if (shift) parts.push("Shift");
    if (alt) parts.push("Alt");
    parts.push(keyDisplay);
    return parts.join("+");
  }
}

/**
 * Simple string equality check for two notation strings.
 */
export function keysMatch(a: string, b: string): boolean {
  return a === b;
}

/**
 * Parse a notation string like "Mod+Shift+S" into a ParsedKey object.
 */
export function parseKeyNotation(notation: string): ParsedKey {
  const parts = notation.split("+");
  let mod = false;
  let shift = false;
  let alt = false;
  const keyParts: string[] = [];

  for (const part of parts) {
    if (part === "Mod") mod = true;
    else if (part === "Shift") shift = true;
    else if (part === "Alt") alt = true;
    else keyParts.push(part);
  }

  // Rejoin in case the key itself contains "+" (unlikely but safe)
  const key = keyParts.join("+");

  return { mod, shift, alt, key };
}
