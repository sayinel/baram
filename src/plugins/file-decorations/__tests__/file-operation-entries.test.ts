// §395 spec 0074 D10 · §7 "스캔" — the app files that rename, move or delete through the five IPC wrappers
// are exactly the six that tell plugins. Counted by effect — a file that names a wrapper, however it
// imports it (`ipc/invoke` re-exports `ipc/fs` and `ipc/link-index`) — not by an import line. Corpus:
// `src` `.ts` / `.tsx` outside `src/ipc`, `__tests__` and `*.test.*`, walked with Node `fs`, keys joined
// with "/". What fails this: a new file calling a wrapper (shown below on a temporary corpus), one of the
// six dropping its notices import, or one of the five commands invoked outside `src/ipc`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../..");

/** The five wrappers. `\b` keeps `renameFile` from matching `renameFileWithLinks` or `renameFileEntry`. */
const WRAPPER =
  /\b(?:deleteDir|deleteFile|renameFile|renameFileWithLinks|renameNamespace)\b/u;

/** The five commands, as quoted strings. */
const COMMAND =
  /["'](?:delete_dir|delete_file|rename_file|rename_file_with_links|rename_namespace)["']/u;

/** spec 0074 §2 — the six, measured at ab5028ff. */
const SIX = [
  "components/journal/MigrationDialog.tsx",
  "components/sidebar/hooks/use-file-tree-crud.ts",
  "components/sidebar/hooks/use-file-tree-move.ts",
  "components/sidebar/hooks/use-file-tree-rename.ts",
  "components/zettelkasten/ZettelInboxList.tsx",
  "services/zettelkasten-service.ts",
];

interface Source {
  path: string;
  text: string;
}

function corpus(): Source[] {
  const found: Source[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__") walk(full);
        continue;
      }
      if (!/\.tsx?$/u.test(name) || name.includes(".test.")) continue;
      found.push({
        path: relative(SRC, full).split(sep).join(posix.sep),
        text: readFileSync(full, "utf8"),
      });
    }
  };
  walk(SRC);
  return found;
}

const outsideIpc = (sources: Source[]) =>
  sources.filter((source) => !source.path.startsWith("ipc/"));

const callers = (sources: Source[]) =>
  outsideIpc(sources)
    .filter((source) => WRAPPER.test(source.text))
    .map((source) => source.path)
    .sort();

describe("the app's file operations tell plugins (D10)", () => {
  const sources = corpus();

  it("finds the wrappers in exactly the six entry points", () => {
    expect(callers(sources)).toEqual(SIX);
  });

  it("invokes the five commands inside src/ipc only", () => {
    expect(
      outsideIpc(sources)
        .filter((source) => COMMAND.test(source.text))
        .map((source) => source.path),
    ).toEqual([]);
    expect(
      sources.filter(
        (source) => source.path.startsWith("ipc/") && COMMAND.test(source.text),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("imports the notices in each of the six", () => {
    for (const path of SIX) {
      const text = sources.find((source) => source.path === path)?.text ?? "";
      expect(text, path).toContain("file-decorations/operation-notices");
    }
  });

  /** The scan is live: a new file that deletes through the wrapper changes the set the first row pins. */
  it("turns red for a new caller", () => {
    const added = [
      ...sources,
      {
        path: "components/new-thing.ts",
        text: 'import { deleteFile } from "../ipc/invoke";\nvoid deleteFile("/v/a.md");\n',
      },
    ];
    expect(callers(added)).toContain("components/new-thing.ts");
    expect(callers(added)).not.toEqual(SIX);
  });
});
