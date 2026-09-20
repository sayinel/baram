// §69 · §260 (스펙 0050) — 플러그인이 기여한 ProseMirror 플러그인을, 살아 있는 문서
// 편집 에디터 전부에 유지한다.
//
// 표면과 기여분은 서로를 모른 채 따로 들어온다: 플러그인은 앱이 이미 뜬 뒤 로드되고,
// keepalive 에디터는 플러그인이 로드된 뒤에도 새로 생긴다. 그래서 이 모듈은 둘을 각각
// 들고 있다가 곱집합을 유지한다 — 어느 쪽이 먼저 와도 결과가 같다.
//
// ‼️ INVARIANT: no contributed factory may call back into this module while it is being
// constructed. `build` runs third-party code with `surfaces`/`contributions` mid-traverse,
// so a factory that re-entered `registerEditorSurface` or `addPluginContributions` would
// mutate a collection under its own iteration. Nothing enforces this — it cannot be, the
// factory runs in the main realm — so the traversals below iterate a COPY, which bounds
// re-entry to "the new entry is missed this round" instead of a partially-built registry.
// Every write here is therefore also written to be safe against a nested one.
import type { PluginSettingValue } from "./types";
import type { Editor } from "@tiptap/core";
import type { Plugin as PluginType } from "@tiptap/pm/state";

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { logger } from "../utils/logger";

/**
 * The host's own ProseMirror constructors, handed to every contribution.
 *
 * A plugin ships its own bundle, so importing `@tiptap/pm/view` inside it resolves to a
 * SECOND copy of prosemirror-view — and a `DecorationSet` built from that copy is not a
 * degraded version of ours, it is a crash. Once the app's own extensions are also
 * decorating (they always are), the view builds a `DecorationGroup` over both and dies
 * walking it: `Cannot read properties of undefined (reading 'localsInner')`. One source
 * alone happens to survive, which is what makes the trap quiet in a small test and loud
 * on launch. `__tests__/contributed-decorations.test.ts` pins both halves.
 *
 * So identity is the host's to give, exactly as `key` is. Build decorations with these
 * and never with your own import.
 *
 * ‼️ There is a SECOND declaration of this name, and of `TiptapPluginContext`, in
 * `plugins/types.ts`. That one is the published API — it names the real classes only
 * structurally, because `types.ts` carries no `@tiptap` imports so the generated
 * `examples/plugins/types.d.ts` resolves for an author who has not installed Tiptap.
 * This one is the implementation's, and names the classes. A constructor added here has
 * to be added there too or authors cannot see it; `__tests__/editor-surfaces.test.ts`
 * compares the handed-over object against the published member list.
 */
export interface PluginProseMirror {
  Decoration: typeof Decoration;
  DecorationSet: typeof DecorationSet;
  Plugin: typeof Plugin;
  PluginKey: typeof PluginKey;
}

export interface TiptapPluginContext {
  editor: Editor;
  /**
   * The key this contribution MUST give its plugin. The host mints it, so two plugins
   * cannot collide and an author cannot get it wrong.
   */
  key: PluginKey;
  pluginId: string;
  /** The host's ProseMirror — see {@link PluginProseMirror}. */
  pm: PluginProseMirror;
  settings: Record<string, PluginSettingValue>;
}

/** One declared contribution produces one ProseMirror plugin. */
export type TiptapPluginFactory = (ctx: TiptapPluginContext) => Plugin;

interface Contribution {
  factories: Map<string, TiptapPluginFactory>;
  settings: Record<string, PluginSettingValue>;
}

/**
 * Frozen so a contribution cannot swap a constructor out from under the next one — the
 * object is shared by every factory on every surface.
 */
const HOST_PROSEMIRROR: PluginProseMirror = Object.freeze({
  Decoration,
  DecorationSet,
  Plugin,
  PluginKey,
});

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
  const built = new Map<Editor, Map<string, PluginType>>();
  for (const editor of [...surfaces]) {
    built.set(editor, build(editor, pluginId, contribution));
  }

  contributions.set(pluginId, contribution);
  try {
    for (const [editor, plugins] of built) {
      installPlugins(editor, pluginId, plugins);
    }
  } catch (err) {
    // `registerPlugin` is the EDITOR's, not ours — a destroyed editor or a key collision
    // rejects here, long after every factory built cleanly. The entry above must not
    // outlive that: every surface registered afterwards would install a dead plugin's
    // contribution. Unwinding also takes back whatever this call already registered, so a
    // refusal leaves nothing half-installed either.
    //
    // The loader does unwind this throw itself — its `try` around `addPluginContributions`
    // calls `unwindAfterActivate`, whose first statement is `removePluginContributions`.
    // That is not what this `catch` rests on: `addPluginContributions` is exported, and an
    // all-or-nothing contract that depended on a caller cleaning up after it would not be
    // one.
    removePluginContributions(pluginId);
    throw err;
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
  const built = new Map<string, Map<string, PluginType>>();
  for (const [pluginId, contribution] of [...contributions]) {
    built.set(pluginId, build(editor, pluginId, contribution));
  }

  surfaces.add(editor);
  installed.set(editor, new Map());
  try {
    for (const [pluginId, plugins] of built) {
      installPlugins(editor, pluginId, plugins);
    }
  } catch (err) {
    // Same unwind as `addPluginContributions`, and for the same reason the build above
    // runs first: `registerPlugin` can still refuse, and this surface must end up exactly
    // as unregistered as before the call — there is no disposer to hand back for it.
    for (const pluginId of [...(installed.get(editor)?.keys() ?? [])]) {
      uninstall(editor, pluginId);
    }
    installed.delete(editor);
    surfaces.delete(editor);
    throw err;
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
  for (const editor of [...surfaces]) uninstall(editor, pluginId);
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
): Map<string, PluginType> {
  const made = new Map<string, PluginType>();
  for (const [name, factory] of contribution.factories) {
    const key = keyFor(pluginId, name);
    const plugin = factory({
      editor,
      key,
      pluginId,
      pm: HOST_PROSEMIRROR,
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
    // `view.editable`. This refusal turns a contribution that DECLARES
    // `props.editable` into a clear error at load, which is what an honest author
    // needs; it is not a boundary and nothing here should be read as one. A plugin
    // reaching editability through its own main-realm powers — `editor.setEditable`,
    // `view.setProps`, a `spec.view()`, or mutating `plugin.props` after this check has
    // read it — is outside this module, and a trusted plugin holding the editor is a
    // §260 tier decision rather than something a check here could police. Control ⓓ in
    // vim/__tests__/editable-ownership.test.tsx pins that last route, because it runs
    // through this very `registerPlugin` call and so is the one a reader would assume
    // this check closed.
    //
    // Read `plugin.props`, not `plugin.spec.props` — `Plugin`'s constructor copies each
    // spec prop through a single read (prosemirror-state's `bindProps`) into the
    // instance's own `props`, which is what `view.someProp` actually consults. A `spec`
    // read here would be a second, independent read of whatever `spec.props.editable`
    // is — a getter that hands out the function once and `undefined` after would pass a
    // `spec`-based check while still installing the suppressor. So `plugin.props` is the
    // right thing to read at this moment; it is the value the view will use, for as long
    // as nobody reassigns it.
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
  plugins: Map<string, PluginType>,
): void {
  const keysInstalled: PluginKey[] = [];
  // The array enters the map BEFORE anything is registered, and each key enters the array
  // before ITS OWN `registerPlugin`. Both halves are needed for the callers' unwind to
  // find what landed, and it is the second one that covers the plugin that actually
  // fails: `registerPlugin` is `state.reconfigure({ plugins })` and THEN
  // `view.updateState(state)`, and `updateState` assigns `view.state` before it renders.
  // A plugin whose rendering throws — a bad decoration, say — is therefore already in
  // `editor.state.plugins` when the call throws, so a key pushed once the call RETURNS is
  // never pushed for exactly that plugin. Unrecorded, it is stuck on this editor for
  // good; and since `keyFor` reuses one key per contribution across loads, every later
  // load of that contribution then hands ProseMirror a second instance of the same key —
  // "Adding different instances of a keyed plugin" — until the app restarts.
  //
  // Recording a key that never landed costs nothing: `unregisterPlugin` filters by key
  // and returns without touching the view when the filter removed nothing.
  installed.get(editor)?.set(pluginId, keysInstalled);
  for (const [name, plugin] of plugins) {
    keysInstalled.push(keyFor(pluginId, name));
    editor.registerPlugin(plugin);
  }
}

function uninstall(editor: Editor, pluginId: string): void {
  const installedKeys = installed.get(editor)?.get(pluginId);
  if (!installedKeys) return;
  for (const key of installedKeys) {
    // Per key, because `unregisterPlugin` updates the view too — on an editor that, when
    // this runs as an unwind, is already failing to render. One removal that throws must
    // not strand the keys after it, nor replace the error that explains why we are
    // unwinding. The plugin itself is off either way: the removal reaches `view.state`
    // before the rendering that can throw, exactly as the install does.
    try {
      editor.unregisterPlugin(key);
    } catch (err) {
      logger.error(
        `[EditorSurfaces] ${pluginId}: removing a plugin failed`,
        err,
      );
    }
  }
  installed.get(editor)?.delete(pluginId);
}
