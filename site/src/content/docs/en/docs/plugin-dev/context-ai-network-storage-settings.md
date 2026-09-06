---
title: "Context: AI, network, storage, settings"
---

## `context.ai` (requires `ai`)

```typescript
interface AICompleteOptions {
  maxTokens?: number;
  systemPrompt?: string;
}
interface AIModel { id: string; name: string; }

complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
stream(prompt: string, opts: AICompleteOptions, onToken: (token: string) => void): Promise<void>;
listModels(): Promise<AIModel[]>;
```

`complete`/`stream`/`listModels` all use the **user's own configured AI
provider, model, and API key** (whatever is set in Settings → AI) — a plugin
cannot supply its own key or provider. See
[Trust model & security](/baram/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security) for what privacy mode does
and does not gate here.

## `context.network` (requires `network`)

```typescript
interface PluginFetchInit {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
}
interface PluginFetchResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
```

This is a Rust-side `reqwest` proxy (it bypasses the browser's CORS
restrictions), **not** the browser `fetch`. Only `http`/`https` URLs are
allowed; the response body is always a UTF-8 string (binary responses are
lossily decoded, not usable as bytes); duplicate response headers collapse
to whichever value `reqwest` iterates last. See
[Trust model & security](/baram/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security) for the full egress and
size/timeout policy.

## `context.storage` (requires `storage`)

```typescript
read(key: string): Promise<string | null>;
write(key: string, value: string): Promise<void>;
list(): Promise<string[]>;
remove(key: string): Promise<void>;
```

A simple string key/value store, one directory per plugin. See
[Trust model & security](/baram/en/docs/plugin-dev/trust-model-and-errors/#trust-model--security) for where it lives and its
guarantees (or lack thereof).

## `context.settings` (requires `settings`)

```typescript
getAll(): Record<string, boolean | number | string>;
```

The user's answers to the fields your manifest declares in
`contributions.settings`, rendered as a form in your plugin's page under
**Settings → Plugins**. One entry per declared field, always of the declared
type; keys your current manifest does not declare are not returned.

Synchronous here and `Promise`-returning in the sandboxed tier — otherwise the
same function, resolved the same way, so the same plugin source works in both.
There is no setter in either tier: a value the user chose is not the plugin's to
move. Use `context.storage` for state of your own.

```javascript
const { prefix = "»" } = context.settings.getAll();
```

## `context.subscriptions`

`Disposable[]` — every `Disposable` returned by `commands.register`,
`events.on`, `ui.showStatusBarItem`, `ui.addStyle`, `ui.addSidebarPanel`, and
`ui.addSettingsTab` is pushed here automatically and disposed when the
plugin is unloaded (reload, remove, or app shutdown). You don't need to
track these yourself.
