// §394 spec 0073 §4 · D5 · D11 ③ — the trusted tier's `ctx.codeBlocks`, the claim both tiers make
// when a plugin loads, the action dispatch both tiers' blocks use, and the release every unload path
// runs (`unregisterPluginUI`, plan 0125 P24).

import type {
  CodeBlocksAPI,
  Disposable,
  PluginManifest,
  PluginTrust,
  RenderedAction,
} from "../types";
import type { RendererBinding } from "./code-block-registry";

import { declaredCodeBlockLangs } from "../manifest-code-blocks";
import { runPluginAction } from "../plugin-action";
import { pluginSourceLabel } from "../plugin-text";
import { CALL_TIMEOUT_MS } from "../sandbox/sandbox-session";
import { drawnByMessage, undeclaredLangMessage } from "./code-block-messages";
import {
  bindCodeBlockRenderer,
  claimCodeBlockLangs,
  releaseCodeBlockClaims,
  setCodeBlockActions,
} from "./code-block-registry";
import { forgetPluginRenders, invalidateRenders } from "./render-queue";

/** One declared language as a load sees it: `drawnBy` names the plugin that holds it, `null` when this one does. */
export interface ClaimedLang {
  drawnBy: null | string;
  lang: string;
}

/**
 * Claim `manifest`'s declared languages for its plugin, before its code runs (plan 0125 P10). A
 * manifest without `codeblocks` — or a consent that narrowed it away — claims nothing.
 *
 * ‼️ `manifest` is the object the loader was handed, after `narrowToConsent` — never a re-read of
 * `baram-plugin.json` nor a registry entry. For an installed plugin that object is the record's
 * manifest, and the consent record holds that manifest's languages (spec 0073 D4 ③), so claiming
 * from it keeps a load inside what was approved; a file on disk may declare others.
 */
export function claimCodeBlocks(
  manifest: PluginManifest,
  tier: PluginTrust,
): ClaimedLang[] {
  const langs = declaredCodeBlockLangs(manifest);
  const taken = claimCodeBlockLangs(
    {
      pluginId: manifest.id,
      pluginName: pluginSourceLabel(manifest.name, manifest.id),
      tier,
      version: manifest.version,
    },
    langs,
  );
  return langs.map((lang) => ({ drawnBy: taken.get(lang) ?? null, lang }));
}

/** The trusted tier's `ctx.codeBlocks`. What it registers is pushed onto `disposables` (`context.subscriptions`). */
export function createCodeBlocksAPI(
  pluginId: string,
  langs: readonly ClaimedLang[],
  disposables: Disposable[],
): CodeBlocksAPI {
  const declared = new Map(langs.map((l) => [l.lang, l.drawnBy]));
  const handlers = new Set<(action: RenderedAction) => Promise<void> | void>();
  // D11 ③ — rights last until every handler is done: `allSettled`, so one rejecting does not
  // settle the dispatch (and end the rights) while another still runs. The first failure is
  // rethrown afterwards, for `runPluginAction` to log.
  setCodeBlockActions(pluginId, async (action) => {
    const settled = await Promise.allSettled(
      [...handlers].map((handler) =>
        Promise.resolve().then(() => handler(action)),
      ),
    );
    const failed = settled.find((result) => result.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  });
  return {
    invalidate(lang) {
      if (lang !== undefined && !declared.has(lang)) {
        throw new Error(undeclaredLangMessage("invalidate", lang));
      }
      // D17 — a declared language another plugin draws is not this plugin's to redraw.
      if (lang !== undefined && declared.get(lang) !== null) return;
      invalidateRenders(pluginId, lang);
    },
    onAction(handler) {
      handlers.add(handler);
      const registration = {
        dispose: () => {
          handlers.delete(handler);
        },
      };
      disposables.push(registration);
      return registration;
    },
    register(lang, render) {
      if (!declared.has(lang)) {
        throw new Error(undeclaredLangMessage("register", lang));
      }
      const owner = declared.get(lang);
      if (owner !== null && owner !== undefined) {
        throw new Error(drawnByMessage(lang, owner));
      }
      const registration = bindCodeBlockRenderer(pluginId, lang, render);
      disposables.push(registration);
      return registration;
    },
  };
}

/**
 * A real click on `data-action` (D11 ③): the plugin's action under prompt rights — at most
 * `CALL_TIMEOUT_MS` for a trusted handler; a sandboxed one ends at the session's own call timer,
 * which stops while a prompt is open (Task 11).
 */
export function dispatchRenderedAction(
  binding: RendererBinding,
  action: RenderedAction,
): Promise<void> {
  return runPluginAction(
    binding.pluginId,
    () => binding.act(action),
    binding.tier === "trusted" ? CALL_TIMEOUT_MS : null,
  );
}

/** Everything `pluginId` claimed, bound or cached goes, and its in-flight answers become stale. */
export function releaseCodeBlocks(pluginId: string): void {
  releaseCodeBlockClaims(pluginId);
  forgetPluginRenders(pluginId);
}
