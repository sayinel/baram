// §298 vim §12-⑪ — editable ownership (design v7.7).
//
// Three pins, one contract: only the core Editable extension (options-driven)
// and the vim plugin may decide `view.editable`.
//
// ⓐ Deadlock regression — useEditor re-compares options every render and, on
//    mismatch, calls setOptions({ ..., editable: editor.isEditable }), copying
//    a modal view.editable=false into options.editable permanently (no event
//    fires). Stable extensions must survive a re-render during modal; the
//    CONTROL demonstrates the copy so the pin cannot pass vacuously — and if
//    a future Tiptap release stops copying, the control fails and tells us
//    the rule can be relaxed.
// ⓑ Suppressor-absence invariant — with the production extension set and vim
//    off, nothing else may veto editability. canUseEditorChrome's "modal is
//    the only suppressor" premise rests on this.
// ⓒ Architecture scan — the silent third paths (registerPlugin/unregister-
//    Plugin, view.setProps, editable inside editorProps) are banned in src.

import { useEffect, useMemo } from "react";

import type { Editor } from "@tiptap/core";

import { act, cleanup, render } from "@testing-library/react";
import { Extension, Editor as TiptapEditor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useEditor } from "@tiptap/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";

// ── test suppressor: the same mechanism the vim plugin will use ────────────

const suppressKey = new PluginKey<boolean>("testEditableSuppressor");

interface OwnerProps {
  onEditor: (editor: Editor) => void;
  /** Bumped by the test to force a re-render of the owner. */
  tick: number;
}

function makeSuppressor() {
  return Extension.create({
    name: "testEditableSuppressor",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: suppressKey,
          props: {
            editable: (state) => !(suppressKey.getState(state) ?? false),
          },
          state: {
            apply: (tr, value) =>
              (tr.getMeta(suppressKey) as boolean | undefined) ?? value,
            init: () => false,
          },
        }),
      ];
    },
  });
}

function setSuppressed(editor: Editor, suppressed: boolean) {
  act(() => {
    editor.view.dispatch(editor.state.tr.setMeta(suppressKey, suppressed));
  });
}

/** Owner following the §12-⑪ rule: extensions memoized once. */
function StableOwner({ onEditor }: OwnerProps) {
  const extensions = useMemo(
    () => [...createBaramExtensions(), makeSuppressor()],
    [],
  );
  const editor = useEditor({ extensions, immediatelyRender: true });
  useEffect(() => {
    if (editor) onEditor(editor);
  }, [editor, onEditor]);
  return null;
}

/** Owner reproducing the defect: a fresh extensions array every render. */
function UnstableOwner({ onEditor }: OwnerProps) {
  const editor = useEditor({
    extensions: [...createBaramExtensions(), makeSuppressor()],
    immediatelyRender: true,
  });
  useEffect(() => {
    if (editor) onEditor(editor);
  }, [editor, onEditor]);
  return null;
}

afterEach(cleanup);

describe("ⓐ useEditor option-sync deadlock (§12-⑪)", () => {
  it("stable extensions survive a re-render during modal", () => {
    let editor: Editor | null = null;
    const capture = (e: Editor) => {
      editor = e;
    };
    const { rerender } = render(<StableOwner onEditor={capture} tick={0} />);
    if (!editor) throw new Error("editor not created");
    const ed: Editor = editor;
    expect(ed.view.editable).toBe(true);

    setSuppressed(ed, true);
    expect(ed.view.editable).toBe(false);
    expect(ed.isEditable).toBe(false);

    // The moment of truth: a re-render while modal. With stable extensions
    // the option comparison passes and the sync setOptions never runs.
    rerender(<StableOwner onEditor={capture} tick={1} />);
    expect(ed.options.editable).toBe(true);

    setSuppressed(ed, false);
    expect(ed.view.editable).toBe(true);
  });

  it("CONTROL: per-render extensions brick the editor (the defect is real)", () => {
    let editor: Editor | null = null;
    const capture = (e: Editor) => {
      editor = e;
    };
    const { rerender } = render(<UnstableOwner onEditor={capture} tick={0} />);
    if (!editor) throw new Error("editor not created");
    const ed: Editor = editor;

    setSuppressed(ed, true);
    rerender(<UnstableOwner onEditor={capture} tick={1} />);
    // Tiptap copied the modal view.editable into options.editable…
    expect(ed.options.editable).toBe(false);

    // …so releasing the suppressor can no longer restore editability.
    setSuppressed(ed, false);
    expect(ed.view.editable).toBe(false);
  });
});

describe("ⓑ suppressor-absence invariant (§12-⑪)", () => {
  it("with the production extension set and vim off, the view is editable", () => {
    const editor = new TiptapEditor({ extensions: createBaramExtensions() });
    try {
      expect(editor.view.editable).toBe(true);
    } finally {
      editor.destroy();
    }
  });
});

// ── ⓒ architecture scan ────────────────────────────────────────────────────

const SRC_DIR = join(import.meta.dirname, "..", "..", "..", "..");

// Regex-level enforcement, biased to over-block; receiver-agnostic where a
// rename could dodge it (impl review R1). An AST/ESLint rule is the §12b
// follow-up — these scans back the BEHAVIORAL pins above, they do not stand
// alone.

/** Any .registerPlugin/.unregisterPlugin — silent reconfigure path. */
const REGISTER_RE = /\.(un)?registerPlugin\s*\(/;
/** Baram's plugin-UI store shares the method name; not Tiptap's editor. */
const REGISTER_ALLOW = [join("plugins", "extension-context.ts")];
/** Direct view.setProps — bypasses every signal. */
const SET_PROPS_RE = /\.setProps\s*\(/;
/** Direct setEditable — silent with emitUpdate=false; the wrapper notifies. */
const SET_EDITABLE_RE = /\.setEditable\s*\(/;
const SET_EDITABLE_OWNER = join("utils", "editor", "editor-editable.ts");

/** True when the pattern matches outside a line comment. */
function matchesCode(line: string, re: RegExp): boolean {
  const match = re.exec(line);
  if (!match) return false;
  const comment = line.indexOf("//");
  return comment === -1 || match.index < comment;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "spike") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("ⓒ editable third-path ban (§12-⑪ 규약)", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans a real tree (guards against an empty-glob false pass)", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("no runtime registerPlugin/unregisterPlugin, no view.setProps", () => {
    const offending: string[] = [];
    for (const file of files) {
      const skipRegister = REGISTER_ALLOW.some((a) => file.endsWith(a));
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (
          (!skipRegister && matchesCode(line, REGISTER_RE)) ||
          matchesCode(line, SET_PROPS_RE)
        ) {
          offending.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offending).toEqual([]);
  });

  it("no setOptions call in a file that also says `editable`", () => {
    // Coarse on purpose: setOptions({ editable }) usually spans lines, so a
    // per-line regex cannot see it. Needing both words in one file is the
    // moment to revisit §12-⑪ consciously.
    const offending = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes(".setOptions(") && /\beditable\b/.test(source);
    });
    expect(offending).toEqual([]);
  });

  it("setEditable is called only by the setEditorEditable wrapper", () => {
    const offending: string[] = [];
    for (const file of files) {
      if (file.endsWith(SET_EDITABLE_OWNER)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (matchesCode(line, SET_EDITABLE_RE)) {
          offending.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offending).toEqual([]);
  });

  it("files touching editorProps never mention editable", () => {
    // Deliberately whole-file coarse: needing both in one file is the moment
    // to consciously revisit the §12-⑪ ownership contract.
    const offending = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes("editorProps") && /\beditable\b/.test(source);
    });
    expect(offending).toEqual([]);
  });

  it("useEditor callers never build extensions inline", () => {
    // The deadlock needs BOTH the Tiptap copy (pinned by the CONTROL above)
    // and an option mismatch. This locks the mismatch half at the call sites:
    // extensions must come from a stable binding (useMemo), not a fresh
    // createBaramExtensions() inside the options literal. Scoped to the
    // useEditor argument window — `new Editor({ extensions: ... })` outside
    // useEditor (keep-alive pool) is not on the option-sync path.
    const inlineInUseEditor =
      /useEditor\s*\(\s*\{[\s\S]{0,600}?extensions:\s*createBaramExtensions\s*\(/;
    const offending = files.filter((file) =>
      inlineInUseEditor.test(readFileSync(file, "utf8")),
    );
    expect(offending).toEqual([]);
  });
});
