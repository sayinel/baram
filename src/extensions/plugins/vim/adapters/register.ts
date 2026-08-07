// §298 Vim Phase 1 — the vim register (design §6 F7).
//
// One global register with vim semantics, shared across editors. Char yanks
// keep the full Slice (marks, inline atoms, open depths) as JSON; reviving
// with anything but the TARGET editor's schema silently drops content
// (spike #7 proved the fitter eats foreign nodes with steps=0), so revival
// happens at paste time, in operations.ts, from state.schema.

export type LineContext = "listItem" | "tableRow" | "top";

export type VimRegister =
  | {
      /** One node JSON per yanked line unit (3dd carries three). */
      content: unknown[];
      context: LineContext;
      kind: "line";
    }
  | {
      kind: "char";
      /** Slice.toJSON() — null encodes the empty slice. */
      slice: null | unknown;
    };

let current: null | VimRegister = null;

export function readVimRegister(): null | VimRegister {
  return current;
}

/** Test seam — the register is process-global on purpose. */
export function resetVimRegister(): void {
  current = null;
}

export function writeVimRegister(next: VimRegister): void {
  current = next;
}
