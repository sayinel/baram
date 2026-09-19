// §69 · §260 (스펙 0050) — 플러그인이 기여한 ProseMirror 플러그인을, 살아 있는 문서
// 편집 에디터 전부에 유지한다.
//
// 표면과 기여분은 서로를 모른 채 따로 들어온다: 플러그인은 앱이 이미 뜬 뒤 로드되고,
// keepalive 에디터는 플러그인이 로드된 뒤에도 새로 생긴다. 그래서 이 모듈은 둘을 각각
// 들고 있다가 곱집합을 유지한다 — 어느 쪽이 먼저 와도 결과가 같다.
import type { PluginSettingValue } from "./types";
import type { Editor } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";

import { PluginKey } from "@tiptap/pm/state";

export interface TiptapPluginContext {
  editor: Editor;
  /**
   * The key this contribution MUST give its plugin. The host mints it, so two plugins
   * cannot collide and an author cannot get it wrong.
   */
  key: PluginKey;
  pluginId: string;
  settings: Record<string, PluginSettingValue>;
}

/** One declared contribution produces one ProseMirror plugin. */
export type TiptapPluginFactory = (ctx: TiptapPluginContext) => Plugin;

interface Contribution {
  factories: Map<string, TiptapPluginFactory>;
  settings: Record<string, PluginSettingValue>;
}

const surfaces = new Set<Editor>();
const contributions = new Map<string, Contribution>();
/** Editor → pluginId → the keys installed on it, for exact removal. */
const installed = new Map<Editor, Map<string, PluginKey[]>>();
/**
 * Editor → the disposer already handed out for it, so a second
 * `registerEditorSurface(editor)` for an already-registered surface returns the SAME
 * disposer instead of silently rebuilding and re-registering everything on top.
 */
const disposers = new Map<Editor, () => void>();
/**
 * One key per (pluginId, contribution name), shared across surfaces. Deliberately never
 * shrinks — reuse across unload/reload is what keeps a reloaded plugin's key stable.
 */
const keys = new Map<string, PluginKey>();

export function addPluginContributions(
  pluginId: string,
  factories: Map<string, TiptapPluginFactory>,
  settings: Record<string, PluginSettingValue>,
): void {
  // Re-adding the same pluginId must replace, not duplicate — `keyFor` memoises, so a
  // second `registerPlugin` for an unchanged contribution name would hand ProseMirror two
  // instances of the same keyed plugin and it throws. Uninstalling first makes this
  // idempotent instead of relying on callers never calling it twice.
  if (contributions.has(pluginId)) removePluginContributions(pluginId);

  const contribution = { factories, settings };
  // Build every surface's plugins FIRST, check them all, and only then register — so a
  // refusal leaves nothing half-installed. Built once, not once to check and once to
  // install: a factory may have side effects, and the instance checked must be the
  // instance installed.
  const built = new Map<Editor, Map<string, Plugin>>();
  for (const editor of surfaces) {
    built.set(editor, build(editor, pluginId, contribution));
  }

  contributions.set(pluginId, contribution);
  for (const [editor, plugins] of built) {
    installPlugins(editor, pluginId, plugins);
  }
}

export function registerEditorSurface(editor: Editor): () => void {
  // Registering an already-registered surface is a no-op, not a silent re-install — it
  // also means the caller always gets back the one disposer that actually owns this
  // surface's teardown.
  const existing = disposers.get(editor);
  if (existing) return existing;

  // Same all-or-nothing shape as `addPluginContributions`, and for the same reason: a
  // factory that succeeded when it first loaded can still throw HERE — it re-runs once
  // per surface by design, on third-party code, so a later surface is a fresh chance to
  // fail. Build every contribution before touching `surfaces`/`installed` at all, so a
  // throw leaves this surface exactly as unregistered as before the call — no half-wired
  // editor stuck in the maps with no disposer to unwind it.
  const built = new Map<string, Map<string, Plugin>>();
  for (const [pluginId, contribution] of contributions) {
    built.set(pluginId, build(editor, pluginId, contribution));
  }

  surfaces.add(editor);
  installed.set(editor, new Map());
  for (const [pluginId, plugins] of built) {
    installPlugins(editor, pluginId, plugins);
  }

  const dispose = () => {
    for (const pluginId of [...(installed.get(editor)?.keys() ?? [])]) {
      uninstall(editor, pluginId);
    }
    installed.delete(editor);
    surfaces.delete(editor);
    disposers.delete(editor);
  };
  disposers.set(editor, dispose);
  return dispose;
}

export function removePluginContributions(pluginId: string): void {
  contributions.delete(pluginId);
  for (const editor of surfaces) uninstall(editor, pluginId);
}

function keyFor(pluginId: string, name: string): PluginKey {
  const id = `baram-plugin:${pluginId}:${name}`;
  let key = keys.get(id);
  if (!key) {
    key = new PluginKey(id);
    keys.set(id, key);
  }
  return key;
}

/** Test-only: drop all state between cases. */
export function __resetEditorSurfaces(): void {
  surfaces.clear();
  contributions.clear();
  installed.clear();
  disposers.clear();
  keys.clear();
}

/** Run one plugin's factories for ONE surface, checking each result's key. */
function build(
  editor: Editor,
  pluginId: string,
  contribution: Contribution,
): Map<string, Plugin> {
  const made = new Map<string, Plugin>();
  for (const [name, factory] of contribution.factories) {
    const key = keyFor(pluginId, name);
    const plugin = factory({
      editor,
      key,
      pluginId,
      settings: contribution.settings,
    });
    if (plugin?.spec?.key !== key) {
      throw new Error(
        `Plugin ${pluginId}: the contribution "${name}" must build its ProseMirror ` +
          `plugin with the key it was handed — new Plugin({ key: ctx.key, … }). ` +
          `The host owns the key so two plugins cannot collide and so unloading ` +
          `removes exactly this plugin and nothing else.`,
      );
    }
    // §298 §12-⑪ — only the core Editable extension and the vim plugin may decide
    // `view.editable`. This module refuses `props.editable` so the app's OWN
    // registration path (this one, calling `registerPlugin` on the plugin's behalf)
    // never carries an editability override; a plugin reaching editability through its
    // own main-realm powers (`editor.setEditable`, `view.setProps`, a `spec.view()`) is
    // outside this module and outside what this check can or should police.
    //
    // Read `plugin.props`, not `plugin.spec.props` — `Plugin`'s constructor copies each
    // spec prop through a single read (prosemirror-state's `bindProps`) into the
    // instance's own `props`, which is what `view.someProp` actually consults. A `spec`
    // read here would be a second, independent read of whatever `spec.props.editable`
    // is — a getter that hands out the function once and `undefined` after would pass a
    // `spec`-based check while still installing the suppressor. `plugin.props.editable`
    // is the one value that already reflects what the view will use, and cannot lie.
    if (plugin.props.editable !== undefined) {
      throw new Error(
        `Plugin ${pluginId}: the contribution "${name}" may not define ` +
          `props.editable. Editability belongs to the editor's own Editable ` +
          `extension and to vim (§298 §12-⑪); a contributed plugin that could veto ` +
          `it would be a third owner nothing signals.`,
      );
    }
    made.set(name, plugin);
  }
  return made;
}

/** Register a surface's already-built plugins and record their keys for later removal. */
function installPlugins(
  editor: Editor,
  pluginId: string,
  plugins: Map<string, Plugin>,
): void {
  const keysInstalled: PluginKey[] = [];
  for (const [name, plugin] of plugins) {
    editor.registerPlugin(plugin);
    keysInstalled.push(keyFor(pluginId, name));
  }
  installed.get(editor)?.set(pluginId, keysInstalled);
}

function uninstall(editor: Editor, pluginId: string): void {
  const installedKeys = installed.get(editor)?.get(pluginId);
  if (!installedKeys) return;
  for (const key of installedKeys) editor.unregisterPlugin(key);
  installed.get(editor)?.delete(pluginId);
}
