import type {
  FileDecoration,
  SandboxContext,
  SandboxFileDecorationUpdate,
} from "../../plugin-api";

/**
 * §395 — the reference file tree decorator (spec 0074 D17, plan A).
 *
 * Puts a blue badge with the number of open tasks (todo and doing) on the notes `ctx.index.tasks()`
 * returns for the active vault, counted when the plugin starts and again on every `vault:changed`. Every
 * count sends a badge for every counted note, so a call that was refused is repaired by the next count
 * (Baram keeps an equal decoration as it is). A note that loses its last open task gets `null`: the
 * plugin remembers every path it may have decorated (`sent`) and clears the ones the count no longer has.
 * Baram does not keep decorations, so `activate` sends them each time the plugin starts.
 *
 * A note whose name holds a backslash cannot be badged: the tree folds either separator in a row's key, so
 * the badge could not reach the right row, and `setFileDecorations` refuses the whole call that carries it.
 *
 * Neither call names a context, so both read the active vault — `ctx.index` the one the backend holds
 * active, `setFileDecorations` the one the app shows. The two can differ for a moment while the user
 * switches vaults. A vault the user left keeps the badges last sent to it, and the new vault's badges
 * appear at its first `vault:changed`.
 */

/** Updates one `setFileDecorations` call may carry. */
const PER_CALL = 1000;

/** The cap at nine is this example's choice: 1–9, then "9+" (a badge holds one or two characters). */
function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

function decoration(count: number): FileDecoration {
  return {
    badge: badgeText(count),
    color: "blue",
    tooltip: `${count} open task${count === 1 ? "" : "s"}`,
  };
}

export function activate(ctx: SandboxContext): void {
  /** Every path this plugin may have decorated: it can hold more than the tree shows (a refused call). */
  let sent = new Set<string>();
  /** Counts runs, so an answer that lands after a newer run started is dropped. */
  let runs = 0;

  const recount = async (): Promise<void> => {
    const run = ++runs;
    const tasks = await ctx.index.tasks();
    if (run !== runs) return;
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.path.includes("\\")) continue;
      counts.set(task.path, (counts.get(task.path) ?? 0) + 1);
    }
    const updates: SandboxFileDecorationUpdate[] = [];
    for (const [path, count] of counts) {
      updates.push({ decoration: decoration(count), path });
    }
    // Added before sending: a call that fails may still have been applied in part.
    for (const path of counts.keys()) sent.add(path);
    for (const path of sent) {
      if (!counts.has(path)) updates.push({ decoration: null, path });
    }
    // One plugin's calls are applied in the order made, so these may go together.
    await Promise.all(
      Array.from({ length: Math.ceil(updates.length / PER_CALL) }, (_, i) =>
        ctx.ui.setFileDecorations(
          updates.slice(i * PER_CALL, (i + 1) * PER_CALL),
        ),
      ),
    );
    // Narrowed only when every call resolved: a refused `null` is sent again by the next count.
    if (run === runs) sent = new Set(counts.keys());
  };

  const recountQuietly = (): void => {
    // If the read or a call fails (no vault open, a refused update), the badges stay as they are until
    // the next count, which sends everything again.
    recount().catch((err: unknown) => {
      console.warn("[tree-badges] counting failed", err);
    });
  };

  recountQuietly();
  ctx.events.on("vault:changed", recountQuietly);
}

// No `deactivate` export: the sandboxed tier never calls one — teardown destroys the webview.
