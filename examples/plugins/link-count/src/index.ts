import type { PluginFileEvent, SandboxContext } from "../../plugin-api";

/**
 * §393 — the reference reader of `ctx.index` (spec 0072 §9).
 *
 * Shows, for the note in the active tab, how many links point at it and how many of its tasks
 * are open: `← 3 · ☐ 2`. It reads when a note opens and again when `vault:changed` says that
 * note's vault changed on disk. Those are the two signals a plugin that mirrors the vault needs:
 * there is no per-keystroke event, and the index answers from disk.
 */

/** The status-bar item id, declared in `baram-plugin.json` under `contributions.statusBar`. */
const ITEM = "links";

function isNote(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".markdown");
}

export function activate(ctx: SandboxContext): void {
  /** The note the item describes: the last `file:open` that named one. */
  let current: PluginFileEvent | undefined;
  /** Counts reads, so an answer that lands after a newer read started is dropped. */
  let reads = 0;

  const update = async (): Promise<void> => {
    const read = ++reads;
    if (!current) {
      ctx.ui.setStatusBarText(ITEM, "");
      return;
    }
    // The `context` from the event: the vault this note is in, even if the user switches vaults
    // before the answer lands. Paths are relative to that vault's root, as in `ctx.files`.
    const { context, path } = current;
    try {
      const [backlinks, tasks] = await Promise.all([
        ctx.index.backlinks(path, { context }),
        ctx.index.tasks({ context, file: path }),
      ]);
      if (read === reads) {
        ctx.ui.setStatusBarText(ITEM, `← ${backlinks.length} · ☐ ${tasks.length}`);
      }
    } catch {
      // A refusal — the note was deleted, the vault removed, the read budget spent — leaves
      // nothing true to show, and a number from before it would claim to be current.
      if (read === reads) ctx.ui.setStatusBarText(ITEM, "");
    }
  };

  ctx.events.on("file:open", (file) => {
    current = isNote(file.path) ? file : undefined;
    void update();
  });
  ctx.events.on("vault:changed", (change) => {
    if (current?.context === change.context) void update();
  });
}

// No `deactivate` export: the sandboxed tier never calls one — teardown destroys the webview.
