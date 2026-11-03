import type { FileDecoration, SandboxContext, SandboxFileDecorationUpdate } from "../../plugin-api";

/**
 * §395 — the reference file tree decorator (spec 0074 D17).
 *
 * Counts. A blue badge with the number of open tasks (todo and doing) on the notes `ctx.index.tasks()`
 * returns for the active vault, counted when the plugin starts and again on every `vault:changed`. Every
 * count sends a badge for every counted note, so a call that was refused is repaired by the next count whose
 * calls are accepted (Baram keeps an equal decoration as it is). A note that loses its last open task gets
 * `null`: the plugin remembers the paths it may have decorated in the vault the counts read (`sent`) and
 * clears the ones the count no longer has. Baram does not keep decorations, so `activate` sends them each
 * time the plugin starts.
 *
 * Pins. "Pin" and "Unpin" in the file tree's right-click menu (`contributions.fileMenu`, files only) put 📌
 * in place of a note's icon. A plugin has one decoration per path, so a pinned note's decoration carries its
 * count too, and the pin is the icon rather than a second badge — a badge holds two characters, and "9+" is
 * two already. The pins are kept in `ctx.storage` as `{ context, path }` and follow Baram's own renames and
 * deletions (`file:rename`, `file:delete`) while the plugin is running — those notices are wired once
 * `activate` has read the stored pins, so a rename or deletion made while the plugin is disabled, failed to
 * load or still reading its storage leaves a pin on the old path; Baram moves and drops the decorations itself. The counts name no
 * vault — the sandboxed tier is never told the active vault's id — so every count sends the pins after the
 * counts, each with its own vault and that vault's count: one plugin's calls are applied in the order made,
 * so a pinned note the counts reached ends with its pin. A count takes the pins after its reads, so an Unpin
 * or a rename heard while it reads is in the pin list it sends — but its counts were read for the pins as
 * they were before, so a pin that a same-vault rename moved meanwhile goes out with count 0 (`pinCounts` is
 * keyed by the old path) until that rename's own `vault:changed` count repairs it; Pin runs a count of its own instead of sending, and a
 * count still reading when a newer one starts stops before sending (`runs`). Each vault's pins go in a call of
 * their own, because a call naming a vault Baram no longer has is refused whole; such a vault's pins stay in
 * storage, and every count and Pin that reaches them sends them again, is refused and logs a warning (a vault
 * removed and added again gets a new id). Pin writes are chained (`saving`): the host stores whichever
 * temporary file is renamed last, so unchained writes could leave an older list in storage.
 *
 * A note whose path holds a backslash can be neither badged nor pinned: a sandboxed path takes no "\"
 * (`SandboxFileDecorationUpdate`), and `setFileDecorations` refuses the whole call that carries one.
 * (The tree folds "\" into "/" in a row's key, so `a\b.md` would share a key with `a/b.md`.) The same goes
 * for the other paths the host refuses — see `pinnablePath`.
 *
 * The counting calls name no context, so both read the active vault — `ctx.index` the one the backend holds
 * active, `setFileDecorations` the one the app shows. The two can differ for a moment while the user switches
 * vaults. A vault the user left keeps the badges last sent to it, and the new vault's badges appear at its
 * first `vault:changed`. A note in a vault the user left that loses its tasks by an outside edit keeps its
 * stale badge even after the user returns and that vault changes, because `sent` no longer holds it.
 */

/** Updates one `setFileDecorations` call may carry. */
const PER_CALL = 1000;

/** The `ctx.storage` key of the pins: JSON, an array of `Pin`. */
const PINS_KEY = "pins";

/** A pinned note: the vault it is in, and its path there. */
interface Pin {
  context: string;
  path: string;
}

/** The most UTF-16 units the host takes in a decoration path (its `MAX_DECORATION_PATH_CHARS`). */
const MAX_PATH_CHARS = 4096;

/** The cap at nine is this example's choice: 1–9, then "9+" (a badge holds one or two characters). */
function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

function chunks<T>(list: readonly T[]): T[][] {
  return Array.from({ length: Math.ceil(list.length / PER_CALL) }, (_, i) =>
    list.slice(i * PER_CALL, (i + 1) * PER_CALL),
  );
}

/** Open tasks per note; a path with "\" is left out (see above). */
function countByNote(tasks: readonly { path: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.path.includes("\\")) continue;
    counts.set(task.path, (counts.get(task.path) ?? 0) + 1);
  }
  return counts;
}

/** A note's decoration: its open-task count as a blue badge, the pin as its icon — `null` with neither. */
function decoration(count: number, pinned: boolean): FileDecoration | null {
  if (count === 0 && !pinned) return null;
  const tasks = `${count} open task${count === 1 ? "" : "s"}`;
  let tooltip = tasks;
  if (pinned) tooltip = count > 0 ? `Pinned · ${tasks}` : "Pinned";
  const shown: FileDecoration = { tooltip };
  if (count > 0) {
    shown.badge = badgeText(count);
    shown.color = "blue";
  }
  if (pinned) shown.icon = { glyph: "📌" };
  return shown;
}

/**
 * Whether the host would take `path` in `setFileDecorations`: names joined by "/", no leading or trailing "/",
 * no empty, "." or ".." name, no "\\", at most `MAX_PATH_CHARS` units. This restates the host's `relativeLocate`
 * rule (an example cannot import host code); a note is never the empty path, which the host does take.
 */
function pinnablePath(path: string): boolean {
  return (
    path !== "" &&
    path.length <= MAX_PATH_CHARS &&
    !path.includes("\\") &&
    path.split("/").every((name) => name !== "" && name !== "." && name !== "..")
  );
}

/**
 * The notes among a command's argument. The file tree menu hands `SandboxFileMenuTarget[]`; the palette hands
 * nothing and another plugin's `commands.execute` anything, so it is checked — folders and paths the host would
 * refuse (`pinnablePath`) are left out.
 */
function notesOf(targets: unknown): Pin[] {
  if (!Array.isArray(targets)) return [];
  const notes: Pin[] = [];
  for (const target of targets as unknown[]) {
    if (typeof target !== "object" || target === null) continue;
    const { context, isDir, path } = target as Record<string, unknown>;
    if (typeof context === "string" && typeof path === "string" && isDir === false && pinnablePath(path)) {
      notes.push({ context, path });
    }
  }
  return notes;
}

/** The stored pins, keeping only well-formed entries — one the host would refuse would refuse its vault's whole call. */
function parsePins(stored: null | string): Pin[] {
  if (stored === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Pin =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Pin).context === "string" &&
      typeof (entry as Pin).path === "string" &&
      pinnablePath((entry as Pin).path),
  );
}

function samePin(a: Pin, b: Pin): boolean {
  return a.context === b.context && a.path === b.path;
}

/** Whether `path` is `at` or, when `at` is a folder, inside it. */
function within(path: string, at: string, isDir: boolean): boolean {
  return path === at || (isDir && path.startsWith(`${at}/`));
}

export async function activate(ctx: SandboxContext): Promise<void> {
  /** The paths this plugin may have decorated in the vault the counts read: more than the tree shows after a refused call. */
  let sent = new Set<string>();
  /** Counts runs, so an answer that lands after a newer run started is dropped. */
  let runs = 0;
  let pins = parsePins(await ctx.storage.read(PINS_KEY));

  /** The last write, settled or not. Storage keeps whichever write the host finishes last, so each write waits for the one before and serialises `pins` as it is then. */
  let saving: Promise<void> = Promise.resolve();
  const savePins = (): Promise<void> => {
    const next = saving.then(() => ctx.storage.write(PINS_KEY, JSON.stringify(pins)));
    saving = next.catch(() => undefined);
    return next;
  };
  const savePinsQuietly = (): void => {
    savePins().catch((err: unknown) => {
      console.warn("[tree-badges] saving pins failed", err);
    });
  };

  /** Open tasks per note in each of `contexts`, one read each; a vault that cannot be read counts none. */
  const countsIn = async (contexts: Iterable<string>): Promise<Map<string, Map<string, number>>> => {
    const counts = new Map<string, Map<string, number>>();
    for (const context of contexts) {
      const tasks = await ctx.index.tasks({ context }).catch(() => []);
      counts.set(context, countByNote(tasks));
    }
    return counts;
  };

  /** Sends `notes`' decorations, each vault in calls of its own; a refused call is logged, not thrown. */
  const decorateNotes = (
    notes: readonly Pin[],
    pinned: boolean,
    counts: Map<string, Map<string, number>>,
  ): Promise<void>[] => {
    const byContext = new Map<string, SandboxFileDecorationUpdate[]>();
    for (const note of notes) {
      const updates = byContext.get(note.context) ?? [];
      const count = counts.get(note.context)?.get(note.path) ?? 0;
      updates.push({ context: note.context, decoration: decoration(count, pinned), path: note.path });
      byContext.set(note.context, updates);
    }
    return [...byContext.values()].flatMap((updates) =>
      chunks(updates).map((part) =>
        ctx.ui.setFileDecorations(part).catch((err: unknown) => {
          console.warn("[tree-badges] a pin call was refused", err);
        }),
      ),
    );
  };

  const recount = async (): Promise<void> => {
    const run = ++runs;
    const tasks = await ctx.index.tasks();
    const pinCounts = await countsIn(new Set(pins.map((pin) => pin.context)));
    // A newer count started while this one read (a `vault:changed`, or a Pin): that one sends, this one stops.
    if (run !== runs) return;
    // Taken after the reads, not before: an Unpin or a rename heard meanwhile is in it. (A pin a rename moved
    // into a vault not read above counts none until the next count, which that rename's `vault:changed` starts.)
    const pinned = pins;
    const counts = countByNote(tasks);
    const updates: SandboxFileDecorationUpdate[] = [];
    for (const [path, count] of counts) updates.push({ decoration: decoration(count, false), path });
    // Added before sending: the calls below may fail after some of them were applied.
    for (const path of counts.keys()) sent.add(path);
    for (const path of sent) {
      if (!counts.has(path)) updates.push({ decoration: null, path });
    }
    const countCalls = chunks(updates).map((part) => ctx.ui.setFileDecorations(part));
    // Made after the counts' calls, so applied after them: a pinned note the counts reached keeps its pin.
    const pinCalls = decorateNotes(pinned, true, pinCounts);
    await Promise.all(countCalls);
    // Narrowed only when every count call resolved: a refused `null` is sent again by the next count.
    if (run === runs) sent = new Set(counts.keys());
    await Promise.all(pinCalls);
  };

  const recountQuietly = (): Promise<void> =>
    // If the read or a call fails (no vault open, a refused update), the badges stay as they are until
    // the next count, which sends everything again.
    recount().catch((err: unknown) => {
      console.warn("[tree-badges] counting failed", err);
    });

  ctx.commands.register("pin", async (targets?: unknown) => {
    const added = notesOf(targets).filter((note) => !pins.some((pin) => samePin(pin, note)));
    if (added.length === 0) return;
    pins = [...pins, ...added];
    await savePins();
    // A count of its own rather than a call of its own: it reads the new pin's vault for its count, and it stops
    // a count still reading, which may not have read that vault and would send the pin with a count of 0.
    await recountQuietly();
  });

  ctx.commands.register("unpin", async (targets?: unknown) => {
    const chosen = notesOf(targets);
    const removed = pins.filter((pin) => chosen.some((note) => samePin(pin, note)));
    if (removed.length === 0) return;
    pins = pins.filter((pin) => !removed.some((gone) => samePin(pin, gone)));
    await savePins();
    // The note keeps its count badge when it has open tasks; with none its decoration goes.
    const counts = await countsIn(new Set(removed.map((pin) => pin.context)));
    await Promise.all(decorateNotes(removed, false, counts));
  });

  // Baram moved or dropped the decorations itself (spec 0074 D10); only the record follows.
  ctx.events.on("file:rename", ({ from, isDir, to }) => {
    const moved = pins.map((pin) =>
      pin.context === from.context && within(pin.path, from.path, isDir)
        ? { context: to.context, path: to.path + pin.path.slice(from.path.length) }
        : pin,
    );
    if (moved.every((pin, i) => pin === pins[i])) return;
    pins = moved;
    savePinsQuietly();
  });
  ctx.events.on("file:delete", ({ context, isDir, path }) => {
    const kept = pins.filter((pin) => pin.context !== context || !within(pin.path, path, isDir));
    if (kept.length === pins.length) return;
    pins = kept;
    savePinsQuietly();
  });

  void recountQuietly();
  ctx.events.on("vault:changed", () => void recountQuietly());
}

// No `deactivate` export: the sandboxed tier never calls one — teardown destroys the webview.
