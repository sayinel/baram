// §394 spec 0073 D5 · D6 — which plugin draws which fenced language, and the signal that tells
// editors the answer changed. A language is CLAIMED when a plugin loads, from its manifest, first
// come first served (plan 0125 P10, D5 "먼저 켜진 쪽"); a renderer is BOUND when that plugin calls
// `register`. Only a bound language draws — one claimed and never registered stays a CodeMirror
// block. Both tiers live here: a sandboxed binding's `render` is a proxy to the sandbox (Task 11).

import type {
  CodeBlockRenderer,
  Disposable,
  PluginTrust,
  RenderedAction,
} from "../types";

/** Who claims a language. `pluginName` is `pluginSourceLabel` — the badge text and the "drawn by" name. */
export interface CodeBlockOwner {
  pluginId: string;
  pluginName: string;
  tier: PluginTrust;
  version: string;
}

/**
 * One bound renderer as a NodeView holds it. Identity matters: a view whose binding is no longer
 * `codeBlockRendererFor(lang)` is rebuilt (D6).
 */
export interface RendererBinding {
  /** The plugin's action dispatch — `onAction` handlers (trusted) or `invokeAction` (sandboxed). */
  act(action: RenderedAction): Promise<void>;
  lang: string;
  pluginId: string;
  pluginName: string;
  render: CodeBlockRenderer;
  tier: PluginTrust;
  version: string;
}

interface Claim {
  act: ((action: RenderedAction) => Promise<void>) | null;
  langs: Set<string>;
  owner: CodeBlockOwner;
}

const claims = new Map<string, Claim>();
/** lang → the id of the plugin holding it. */
const owners = new Map<string, string>();
/** lang → its bound renderer. */
const bindings = new Map<string, RendererBinding>();
const listeners = new Set<(langs: readonly string[]) => void>();

/**
 * Test-only: forget claims and bindings. Listeners stay — `editor-surfaces.ts` subscribes once at
 * module load (Task 10), and a test that subscribes unsubscribes itself.
 */
export function __resetCodeBlockRegistry(): void {
  claims.clear();
  owners.clear();
  bindings.clear();
}

/** Bind `render` to `lang`, which `pluginId` must hold. The disposer unbinds it if still bound. */
export function bindCodeBlockRenderer(
  pluginId: string,
  lang: string,
  render: CodeBlockRenderer,
): Disposable {
  const claim = claims.get(pluginId);
  if (claim === undefined || owners.get(lang) !== pluginId) {
    throw new Error(
      `codeBlocks.register: ${pluginId} does not hold \`\`\`${lang}`,
    );
  }
  const binding: RendererBinding = {
    act: (action) => claims.get(pluginId)?.act?.(action) ?? Promise.resolve(),
    lang,
    pluginId,
    pluginName: claim.owner.pluginName,
    render,
    tier: claim.owner.tier,
    version: claim.owner.version,
  };
  bindings.set(lang, binding);
  announce([lang]);
  return {
    dispose: () => {
      if (bindings.get(lang) !== binding) return;
      bindings.delete(lang);
      announce([lang]);
    },
  };
}

/**
 * Claim `langs` for `owner`. Returns the ones another plugin already holds, each with that plugin's
 * name; the rest are now `owner`'s. Claiming again for the same plugin (a reload) keeps its own.
 */
export function claimCodeBlockLangs(
  owner: CodeBlockOwner,
  langs: readonly string[],
): Map<string, string> {
  const claim = claims.get(owner.pluginId) ?? {
    act: null,
    langs: new Set<string>(),
    owner,
  };
  claim.owner = owner;
  const taken = new Map<string, string>();
  for (const lang of langs) {
    const holder = owners.get(lang);
    if (holder !== undefined && holder !== owner.pluginId) {
      taken.set(lang, claims.get(holder)?.owner.pluginName ?? holder);
      continue;
    }
    owners.set(lang, owner.pluginId);
    claim.langs.add(lang);
  }
  claims.set(owner.pluginId, claim);
  return taken;
}

/** The renderer bound to `lang`, or `null` — what a NodeView asks to choose its branch (D6). */
export function codeBlockRendererFor(lang: string): null | RendererBinding {
  return bindings.get(lang) ?? null;
}

/** Hear every change of a binding, with the languages it touched. Returns the unsubscriber. */
export function onCodeBlockRegistryChange(
  listener: (langs: readonly string[]) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Give back everything `pluginId` claimed or bound. Idempotent. Announces only the languages whose
 * binding went: a claimed language that was never bound drew as a CodeMirror block before and does
 * after, so no editor has anything to redraw for it.
 */
export function releaseCodeBlockClaims(pluginId: string): void {
  const claim = claims.get(pluginId);
  if (claim === undefined) return;
  claims.delete(pluginId);
  const unbound: string[] = [];
  for (const lang of claim.langs) {
    if (owners.get(lang) === pluginId) owners.delete(lang);
    if (bindings.get(lang)?.pluginId !== pluginId) continue;
    bindings.delete(lang);
    unbound.push(lang);
  }
  announce(unbound);
}

/** The action dispatch of `pluginId` — replaced, not added to, by a second call. */
export function setCodeBlockActions(
  pluginId: string,
  act: (action: RenderedAction) => Promise<void>,
): void {
  const claim = claims.get(pluginId);
  if (claim !== undefined) claim.act = act;
}

/**
 * Tell every listener which languages changed, and nothing when none did. The registry keeps no
 * generation of its own: each editor's decoration plugin counts per language
 * (`code-block-render-generation.ts`, Task 10).
 */
function announce(langs: readonly string[]): void {
  if (langs.length === 0) return;
  for (const listener of [...listeners]) listener(langs);
}
