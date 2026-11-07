// src/index.ts
var PER_CALL = 1e3;
var PINS_KEY = "pins";
var MAX_PATH_CHARS = 4096;
function badgeText(count) {
  return count > 9 ? "9+" : String(count);
}
function chunks(list) {
  return Array.from(
    { length: Math.ceil(list.length / PER_CALL) },
    (_, i) => list.slice(i * PER_CALL, (i + 1) * PER_CALL)
  );
}
function countByNote(tasks) {
  const counts = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    if (task.path.includes("\\")) continue;
    counts.set(task.path, (counts.get(task.path) ?? 0) + 1);
  }
  return counts;
}
function decoration(count, pinned) {
  if (count === 0 && !pinned) return null;
  const tasks = `${count} open task${count === 1 ? "" : "s"}`;
  let tooltip = tasks;
  if (pinned) tooltip = count > 0 ? `Pinned \xB7 ${tasks}` : "Pinned";
  const shown = { tooltip };
  if (count > 0) {
    shown.badge = badgeText(count);
    shown.color = "blue";
  }
  if (pinned) shown.icon = { glyph: "\u{1F4CC}" };
  return shown;
}
function pinnablePath(path) {
  if (path === "") return true;
  return path.length <= MAX_PATH_CHARS && !path.includes("\\") && path.split("/").every((name) => name !== "" && name !== "." && name !== "..");
}
function notesOf(targets) {
  if (!Array.isArray(targets)) return [];
  const notes = [];
  for (const target of targets) {
    if (typeof target !== "object" || target === null) continue;
    const { context, isDir, path } = target;
    if (typeof context === "string" && typeof path === "string" && isDir === false && pinnablePath(path)) {
      notes.push({ context, path });
    }
  }
  return notes;
}
function parsePins(stored) {
  if (stored === null) return [];
  let value;
  try {
    value = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry) => typeof entry === "object" && entry !== null && typeof entry.context === "string" && typeof entry.path === "string" && pinnablePath(entry.path)
  );
}
function samePin(a, b) {
  return a.context === b.context && a.path === b.path;
}
function within(path, at, isDir) {
  return path === at || isDir && path.startsWith(`${at}/`);
}
async function activate(ctx) {
  let sent = /* @__PURE__ */ new Set();
  let runs = 0;
  let pins = parsePins(await ctx.storage.read(PINS_KEY));
  let saving = Promise.resolve();
  const savePins = () => {
    const next = saving.then(() => ctx.storage.write(PINS_KEY, JSON.stringify(pins)));
    saving = next.catch(() => void 0);
    return next;
  };
  const savePinsQuietly = () => {
    savePins().catch((err) => {
      console.warn("[tree-badges] saving pins failed", err);
    });
  };
  const countsIn = async (contexts) => {
    const counts = /* @__PURE__ */ new Map();
    for (const context of contexts) {
      const tasks = await ctx.index.tasks({ context }).catch(() => []);
      counts.set(context, countByNote(tasks));
    }
    return counts;
  };
  const decorateNotes = (notes, pinned, counts) => {
    const byContext = /* @__PURE__ */ new Map();
    for (const note of notes) {
      const updates = byContext.get(note.context) ?? [];
      const count = counts.get(note.context)?.get(note.path) ?? 0;
      updates.push({ context: note.context, decoration: decoration(count, pinned), path: note.path });
      byContext.set(note.context, updates);
    }
    return [...byContext.values()].flatMap(
      (updates) => chunks(updates).map(
        (part) => ctx.ui.setFileDecorations(part).catch((err) => {
          console.warn("[tree-badges] a pin call was refused", err);
        })
      )
    );
  };
  const recount = async () => {
    const run = ++runs;
    const tasks = await ctx.index.tasks();
    const pinCounts = await countsIn(new Set(pins.map((pin) => pin.context)));
    if (run !== runs) return;
    const pinned = pins;
    const counts = countByNote(tasks);
    const updates = [];
    for (const [path, count] of counts) updates.push({ decoration: decoration(count, false), path });
    for (const path of counts.keys()) sent.add(path);
    for (const path of sent) {
      if (!counts.has(path)) updates.push({ decoration: null, path });
    }
    const countCalls = chunks(updates).map((part) => ctx.ui.setFileDecorations(part));
    const pinCalls = decorateNotes(pinned, true, pinCounts);
    await Promise.all(countCalls);
    if (run === runs) sent = new Set(counts.keys());
    await Promise.all(pinCalls);
  };
  const recountQuietly = () => (
    // If the read or a call fails (no vault open, a refused update), the badges stay as they are until
    // the next count, which sends everything again.
    recount().catch((err) => {
      console.warn("[tree-badges] counting failed", err);
    })
  );
  ctx.commands.register("pin", async (targets) => {
    const added = notesOf(targets).filter((note) => !pins.some((pin) => samePin(pin, note)));
    if (added.length === 0) return;
    pins = [...pins, ...added];
    await savePins();
    await recountQuietly();
  });
  ctx.commands.register("unpin", async (targets) => {
    const chosen = notesOf(targets);
    const removed = pins.filter((pin) => chosen.some((note) => samePin(pin, note)));
    if (removed.length === 0) return;
    pins = pins.filter((pin) => !removed.some((gone) => samePin(pin, gone)));
    await savePins();
    const counts = await countsIn(new Set(removed.map((pin) => pin.context)));
    await Promise.all(decorateNotes(removed, false, counts));
  });
  ctx.events.on("file:rename", ({ from, isDir, to }) => {
    const moved = pins.map(
      (pin) => pin.context === from.context && within(pin.path, from.path, isDir) ? { context: to.context, path: to.path + pin.path.slice(from.path.length) } : pin
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
export {
  activate
};
