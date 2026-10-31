import type {
  FileDecoration,
  SandboxContext,
  SandboxFileDecorationUpdate,
} from "../../plugin-api";

/**
 * §395 — the reference file tree decorator (spec 0074 D17, plan A).
 *
 * Puts a blue badge with the number of open tasks (todo and doing) on every note that has any, counted
 * with `ctx.index.tasks()` when the plugin starts and again on every `vault:changed`. A note whose last
 * open task closes loses its badge: the plugin remembers what it showed and sends `null` for it. Baram
 * does not keep decorations, so `activate` sends them each time the plugin starts.
 *
 * Neither call names a context, so both read the active vault — `ctx.index` the one the backend holds
 * active, `setFileDecorations` the one the app shows. The two can differ for a moment while the user
 * switches vaults; the next `vault:changed` counts again.
 */

/** Updates one `setFileDecorations` call may carry. */
const PER_CALL = 1000;

/** A badge holds two characters: 1–9, then "9+". */
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
  /** What the tree shows now: note path → open tasks. */
  let shown = new Map<string, number>();
  /** Counts runs, so an answer that lands after a newer run started is dropped. */
  let runs = 0;

  const recount = async (): Promise<void> => {
    const run = ++runs;
    const tasks = await ctx.index.tasks();
    if (run !== runs) return;
    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.path, (counts.get(task.path) ?? 0) + 1);
    }
    const updates: SandboxFileDecorationUpdate[] = [];
    for (const [path, count] of counts) {
      if (shown.get(path) !== count) {
        updates.push({ decoration: decoration(count), path });
      }
    }
    for (const path of shown.keys()) {
      if (!counts.has(path)) updates.push({ decoration: null, path });
    }
    shown = counts;
    // One plugin's calls are applied in the order made, so these may go together.
    await Promise.all(
      Array.from({ length: Math.ceil(updates.length / PER_CALL) }, (_, i) =>
        ctx.ui.setFileDecorations(
          updates.slice(i * PER_CALL, (i + 1) * PER_CALL),
        ),
      ),
    );
  };

  const recountQuietly = (): void => {
    // A refusal (no vault open, the index still being built) leaves the badges as they are until the
    // next change counts again.
    recount().catch((err: unknown) => {
      console.warn("[tree-badges] counting failed", err);
    });
  };

  recountQuietly();
  ctx.events.on("vault:changed", recountQuietly);
}

// No `deactivate` export: the sandboxed tier never calls one — teardown destroys the webview.
