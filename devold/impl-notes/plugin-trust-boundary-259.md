# Plugin Trust Boundary Hardening — Issue #259 (P0 containment)

Branch: `security/plugin-trust-boundary-259` (off origin/main)

## Verified root cause (2026-07-22, 3-track audit)

Plugins run in the **same JS realm** as the app (`plugin-loader.ts:27` bare `import()`),
so the ExtensionContext capability Proxy (`extension-context.ts:241-301`) is bypassable —
a plugin can `import { invoke } from "@tauri-apps/api/core"` and call any of ~60 Tauri
commands directly. The backend does **not** verify caller identity/capabilities
(`plugin_cmd.rs` — all commands take bare args). Plugins auto-load at startup
(`App.tsx:328` → `plugin-lifecycle.ts`). Secret surface: `keyring_get(key)` returns the
raw secret for an **arbitrary key** (`keyring_cmd.rs:13-21`); `llm_list_models` + all four
embedding commands still take `api_key` inbound over IPC. `llm_complete` is already hardened
(commit `02345d7`, reads key backend-side).

Root fix = execution isolation redesign (#260). This issue = **containment** before that.

## Plan (approved: build-flag OFF-by-default + one branch + TDD)

### Phase A — Rust IPC hardening
- `keyring_cmd.rs`: add `Provider` enum (claude|openai|gemini). Replace commands:
  - `keyring_store`/`keyring_get`/`keyring_delete` (arbitrary `key: String`) →
    `keyring_set_provider_key(provider, value)`, `keyring_provider_configured(provider) -> bool`,
    `keyring_delete_provider_key(provider)`. **No command returns a secret.**
  - keep internal `get_provider_api_key(&str)` (backend LLM/embedding use).
- `llm_cmd.rs::llm_list_models`: drop `api_key`; read backend-side via `get_provider_api_key`.
- `embedding_cmd.rs` (embed_text/search_knowledge/index_vault/index_file): drop `api_key`; read backend-side.
- `lib.rs`: swap keyring handler registration to the 3 new commands.
- Backend gate (defense-in-depth): `plugin::plugins_runtime_enabled()` = `cfg!(debug_assertions)`;
  `plugin_install`, `plugin_add_dev_folder`, `plugin_http_fetch` return Err when disabled (release).

### Phase B — Frontend secret hardening
- `ai.ts`: drop `apiKey`/`apiKeys` (plaintext). Add `configured: Partial<Record<AIProvider, boolean>>`.
  - `setApiKey(key)`: non-empty → `keyringSetProviderKey`; empty → `keyringDeleteProviderKey`; update `configured`.
  - `loadApiKeysFromKeyring` → `refreshConfiguredProviders` (uses `keyringProviderConfigured`, no secret).
  - v1→v2 pending migration writes via `keyringSetProviderKey`.
- `model-selection.ts`: `TaskConfig.apiKey: string` → `configured: boolean`.
- Gating consumers (`!apiKey && provider!=="ollama"` → `!configured && provider!=="ollama"`):
  `block-ai-diff.ts:111`, `ai-commands.ts:35`, `App.tsx:976`, `extension-context.ts:90-93` (drop apiKey arg).
- `AITab.tsx`: input becomes write-only local `draft`; `configuredProviders` from `configured`;
  `llmListModels` calls drop key arg.
- `ipc/keyring.ts`: replace 3 arbitrary-key fns with 3 provider-scoped fns.
- `ipc/llm.ts` (`llmListModels`), `ipc/embedding.ts` (×4): drop `apiKey` params.
- `ipc/types.ts` + `src-tauri/ipc-registry.json`: sync signatures.

### Phase C — plugin gate + capability min + docs + regression tests
- `src/plugins/plugins-enabled.ts`: `arePluginsEnabled()` = `import.meta.env.VITE_ENABLE_PLUGINS === "1"`.
- `plugin-lifecycle.ts::initializePlugins`: early-return no-op when disabled.
- Plugin UI (`PluginMarketplace`, `PluginDeveloperSection`): show "disabled for security (#259/#260)" notice, disable install.
- `capabilities/default.json`: minimize window/webview perms (verify file-mode window need first); document privileged commands.
- `extension-context.ts`: doc comment — same-realm ACL cannot establish plugin identity (see #259/#260).
- Regression tests (vitest): `initializePlugins` no-op when disabled; keyring module exposes no secret getter.
  Rust: `Provider` deserialization; `get_provider_api_key("ollama")` empty (exists).

## Completion checklist (from issue #259) — ALL DONE (branch, 3 commits)
- [x] No public IPC returns a secret (keyring_get removed)
- [x] keyring commands take Provider enum, not arbitrary key
- [x] model-list + embedding IPC have no api_key arg
- [x] UI never re-loads existing secret into state/DOM
- [x] malicious-plugin fixture regression test (before/after)
- [x] release artifacts do not auto-run untrusted plugin code
- [x] plugin install/run distribution gated on #259 (+ #260)
- [x] same-realm ACL limitation documented (extension-context + capabilities/default.json)

## Status (2026-07-23)
Commits: 07408cd (secret hardening) · 66ea79b (plugin release gate) · 97e2651 (defense-in-depth).
Gates green: cargo test 311/3-ignored, clippy clean, typecheck clean, vitest 3268, eslint/stylelint/prettier/knip clean.
Adversarial security review: no exploitable bypass; 4 defense-in-depth findings addressed
(loadPlugin choke-point guard, hoisted marketplace gate, gated prepare_scopes/storage_write;
internal get_provider_api_key(&str) left as-is — IPC-unexposed).
NOT pushed / no PR yet — awaiting user go-ahead. PR body drafted in scratchpad/pr-body-259.md.
Root fix remains #260 (execution isolation). This is finishing "§backlog #1" (llm_complete was 02345d7).
