// §260 Phase 3c-3 — live smoke fixture for the SANDBOXED tier.
//
// Hand-written, dependency-free, single-file ESM on purpose: a sandboxed plugin is
// imported from a `blob:` URL, which has no base URL, so nothing here may import a
// sibling module — and a fixture that needs a build step is a fixture that rots.
//
// Reporting channel: this command always REJECTS, and the rejection message is the
// report. That is deliberate. `SandboxContext` has no `ui` (a sandboxed plugin cannot
// show a toast), nothing consumes `ctx.events.emit` yet, and the command palette
// discards a resolved value while showing `String(err)` as a toast on rejection
// (`CommandPalette.tsx`). So an error toast is the only channel that reaches the user
// today. Phase 4's contribution mapping should give the tier a real one.

/** ⚠️ SET THIS to the absolute path of the vault folder you open in the app. */
const VAULT_DIR = "";

/** Trim a failure message so several fit in one toast. */
const brief = (e) => String(e?.message ?? e).slice(0, 70);

/** Run `fn`, expecting it to SUCCEED. */
async function expectOk(label, fn) {
  try {
    return `${label}✓${await fn()}`;
  } catch (e) {
    return `${label}✗(${brief(e)})`;
  }
}

/** Run `fn`, expecting the broker to REFUSE it. A success here is the failure. */
async function expectDenied(label, needle, fn) {
  try {
    await fn();
    return `${label}✗NOT-DENIED`;
  } catch (e) {
    const msg = String(e?.message ?? e);
    return msg.includes(needle) ? `${label}✓` : `${label}~(${brief(e)})`;
  }
}

export async function activate(ctx) {
  ctx.commands.register("run", async () => {
    const out = [];

    // 1. The command itself round-tripped: host → sandbox → handler.
    out.push("cmd✓");

    // 2. storage — namespaced by the caller's window label in Rust, never an argument.
    out.push(
      await expectOk("storage", async () => {
        await ctx.storage.write("smoke", "value");
        const read = await ctx.storage.read("smoke");
        const keys = await ctx.storage.list();
        await ctx.storage.remove("smoke");
        if (read !== "value") throw new Error(`read back ${String(read)}`);
        return `(${keys.length})`;
      }),
    );

    // 3. files — outside every registered context must be refused by the vault rule.
    out.push(
      await expectDenied("out", "Access denied", () =>
        ctx.files.readFile("/etc/hosts"),
      ),
    );

    if (VAULT_DIR) {
      // 4. files — a real read inside the vault, admitted by `files:readonly`.
      out.push(
        await expectOk("list", async () => {
          const names = await ctx.files.listDir(VAULT_DIR);
          return `(${names.length})`;
        }),
      );

      // 5. …and a WRITE must be refused, because only the readonly grant was given.
      //    This is what proves the any-of capability logic: same tier, same path, one
      //    op admitted and the other not.
      out.push(
        await expectDenied("ro", "not granted", () =>
          ctx.files.writeFile(`${VAULT_DIR}/baram-smoke-should-not-exist.md`, "x"),
        ),
      );

      // 6. …and the app's own state directory is refused even inside the vault.
      out.push(
        await expectDenied("state", "app state", () =>
          ctx.files.readFile(`${VAULT_DIR}/.baram/config.json`),
        ),
      );
    } else {
      out.push("files~(set VAULT_DIR)");
    }

    // 7. ai — host-mediated. THIS PATH HAS NEVER RUN OUTSIDE A UNIT TEST: 3c-2c's
    //    review found the frame was dropped by the host's inbound validator, so a
    //    failure here is the single most interesting result of the whole smoke.
    out.push(
      await expectOk("models", async () => {
        const models = await ctx.ai.listModels();
        return `(${models.length})`;
      }),
    );
    out.push(
      await expectOk("ai", async () => {
        const text = await ctx.ai.complete("Reply with the single word OK.", {
          maxTokens: 8,
        });
        return `(${text.trim().slice(0, 12)})`;
      }),
    );

    // The report IS the rejection — see the header comment.
    throw new Error(`SMOKE ${out.join(" ")}`);
  });
}
