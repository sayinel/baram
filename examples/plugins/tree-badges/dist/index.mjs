// src/index.ts
var PER_CALL = 1e3;
function badgeText(count) {
  return count > 9 ? "9+" : String(count);
}
function decoration(count) {
  return {
    badge: badgeText(count),
    color: "blue",
    tooltip: `${count} open task${count === 1 ? "" : "s"}`
  };
}
function activate(ctx) {
  let sent = /* @__PURE__ */ new Set();
  let runs = 0;
  const recount = async () => {
    const run = ++runs;
    const tasks = await ctx.index.tasks();
    if (run !== runs) return;
    const counts = /* @__PURE__ */ new Map();
    for (const task of tasks) {
      if (task.path.includes("\\")) continue;
      counts.set(task.path, (counts.get(task.path) ?? 0) + 1);
    }
    const updates = [];
    for (const [path, count] of counts) {
      updates.push({ decoration: decoration(count), path });
    }
    for (const path of counts.keys()) sent.add(path);
    for (const path of sent) {
      if (!counts.has(path)) updates.push({ decoration: null, path });
    }
    await Promise.all(
      Array.from(
        { length: Math.ceil(updates.length / PER_CALL) },
        (_, i) => ctx.ui.setFileDecorations(
          updates.slice(i * PER_CALL, (i + 1) * PER_CALL)
        )
      )
    );
    if (run === runs) sent = new Set(counts.keys());
  };
  const recountQuietly = () => {
    recount().catch((err) => {
      console.warn("[tree-badges] counting failed", err);
    });
  };
  recountQuietly();
  ctx.events.on("vault:changed", recountQuietly);
}
export {
  activate
};
