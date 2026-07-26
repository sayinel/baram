// §260 Phase 3c-3 / 4a — live smoke fixture for the SANDBOXED tier.
//
// Hand-written, dependency-free, single-file ESM on purpose: a sandboxed plugin is
// imported from a `blob:` URL, which has no base URL, so nothing here may import a
// sibling module — and a fixture that needs a build step is a fixture that rots.
//
// Reporting channel (§260 Phase 4a): `ctx.ui`. Until this phase the tier had no way to
// show anything, so each command REJECTED and the rejection message was the report — the
// palette toasts `String(err)`. Now the report goes out as an attributed toast plus a
// status-bar item, and the throw is gone. That change IS one of the things being smoked.

/** Trim a failure message so several fit in one toast. */
const brief = (e) => String(e?.message ?? e).slice(0, 60);

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
  // §260 Phase 4a — the file the user is on, learned from a delivered event. This is the
  // whole point of the phase: before it, a sandboxed plugin had NO way to obtain a path,
  // so `files` was enforced but unusable and this fixture needed a hard-coded absolute
  // `VAULT_DIR` (a personal path once shipped to a public repo that way).
  let current = null;
  let events = 0;
  ctx.events.on("file:open", (file) => {
    current = file;
    events += 1;
    // Both a relative path and the context it belongs to — pass `context` back to
    // `files.*` so a vault switch cannot redirect the call.
    ctx.ui.setStatusBarText("file", file?.path ? `📄 ${file.path}` : "no file");
  });
  ctx.events.on("file:save", () => {
    events += 1;
  });

  /**
   * Report through the host: the full line as a transient toast, a SHORT summary in the
   * persistent status item.
   *
   * The bar caps text at 64 characters (§260 Phase 4a code review, M8): the full SMOKE
   * line is ~77, so putting it there silently dropped the last few checks — and the bar
   * is the only report left when the toast is throttled.
   */
  const report = (prefix, out) => {
    // Computed from the ARRAY, not by re-splitting the joined line (§260 Phase 4a code
    // review, R2): `brief(e)` can contain spaces, so splitting on " " both invented
    // phantom failures and truncated the first one mid-message. One element per check.
    const failed = out.filter((f) => f.includes("✗") || f.includes("~"));
    ctx.ui.showNotification(
      `${prefix} ${out.join(" ")}`,
      failed.length ? "error" : "info",
    );
    ctx.ui.setStatusBarText(
      "smoke",
      failed.length
        ? `🧪 ${failed.length}✗ ${failed[0].slice(0, 40)}`
        : `🧪 ${prefix} all ✓`,
    );
  };

  // TWO commands, not one (§260 3c-3 code review, M3). `SandboxSession`'s
  // `CALL_TIMEOUT_MS` bounds the WHOLE command at 30s while a single mediated `ai`
  // request may legitimately take up to 120s — so folding the AI checks into `run`
  // meant one slow model threw away every boundary result that had already passed.
  // The boundary checks are the ones worth protecting: they are the phase's subject
  // and they finish in milliseconds.
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

    // 3. events — did the host actually deliver one, and did it carry a context?
    out.push(
      current?.path !== undefined && current?.context
        ? `evt✓(${events})`
        : `evt✗(${events}, open a file)`,
    );

    // 4. files — the vault root needs NO path at all now: "" is the context root.
    out.push(
      await expectOk("list", async () => {
        const names = await ctx.files.listDir("", {
          context: current?.context,
        });
        return `(${names.length})`;
      }),
    );

    // 5. …and the file the event named reads back through the same context.
    out.push(
      current?.path
        ? await expectOk("read", async () => {
            const text = await ctx.files.readFile(current.path, {
              context: current.context,
            });
            return `(${text.length}b)`;
          })
        : "read~(open a file)",
    );

    // 6. An ABSOLUTE path cannot even be expressed by this tier (Phase 4a): Rust
    //    refuses it before touching the filesystem. Same for a traversal — the two
    //    shapes that would leave the context root.
    out.push(
      await expectDenied("abs", "must be relative", () =>
        ctx.files.readFile("/etc/hosts"),
      ),
    );
    out.push(
      await expectDenied("dotdot", "must be relative", () =>
        ctx.files.readFile("../../../etc/hosts"),
      ),
    );

    // 7. A WRITE must be refused, because only the readonly grant was given. This is
    //    what proves the any-of capability logic: same tier, same path, one op
    //    admitted and the other not.
    out.push(
      await expectDenied("ro", "not granted", () =>
        ctx.files.writeFile("baram-smoke-should-not-exist.md", "x", {
          context: current?.context,
        }),
      ),
    );

    // 8. …and the app's own state directory is refused even inside the vault.
    out.push(
      await expectDenied("state", "app state", () =>
        ctx.files.readFile(".baram/config.json", {
          context: current?.context,
        }),
      ),
    );

    // 9. A status-bar item this plugin did NOT declare must be refused. The refusal is
    //    host-side and this API is void, so it shows up in the sandbox console — the
    //    check here is only that calling it does not break the command.
    ctx.ui.setStatusBarText("not-declared", "should not appear");

    report("SMOKE", out);
    return `SMOKE ${out.join(" ")}`;
  });

  // The AI checks, separately, because they are the slow ones. Host-mediated: this
  // path had never run outside a unit test until 3c-3 (3c-2c's review found the
  // frame was being dropped by the host's inbound validator).
  ctx.commands.register("ai", async () => {
    const out = [];
    const PROMPT = "Reply with the single word OK.";
    const OPTS = { maxTokens: 64 };
    const completeCheck = (label) =>
      expectOk(label, async () => {
        const text = await ctx.ai.complete(PROMPT, OPTS);
        return `(len=${text.length}:${text.trim().slice(0, 8)})`;
      });

    out.push(
      await expectOk("models", async () => {
        const models = await ctx.ai.listModels();
        return `(${models.length})`;
      }),
    );

    // complete, stream, complete AGAIN, all with identical options. Run 2 gave
    // `ai(len=0)` with `stream(1tok/2ch)`, which looks like a complete-only bug —
    // but that comparison was confounded: it changed the API AND the call order at
    // once. `complete` and `stream` share `createAIAPI.start()` verbatim, so a
    // complete-only defect is close to impossible; a second complete after the
    // stream separates "which API" from "which position". Run 3 came back
    // `ai1(len=2) stream(1tok) ai2(len=0)` — intermittent and position-independent,
    // now tracked as issue #304 (a non-STOP Gemini finish reason resolves as an
    // empty success in the SHARED LLM path, not in anything §260 owns).
    out.push(await completeCheck("ai1"));
    out.push(
      await expectOk("stream", async () => {
        let tokens = 0;
        let chars = 0;
        await ctx.ai.stream(PROMPT, OPTS, (t) => {
          tokens += 1;
          chars += String(t).length;
        });
        return `(${tokens}tok/${chars}ch)`;
      }),
    );
    out.push(await completeCheck("ai2"));

    report("SMOKE-AI", out);
    return `SMOKE-AI ${out.join(" ")}`;
  });
}
