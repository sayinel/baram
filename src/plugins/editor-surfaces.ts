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
/** One key per (pluginId, contribution name), shared across surfaces. */
const keys = new Map<string, PluginKey>();

export function addPluginContributions(
  pluginId: string,
  factories: Map<string, TiptapPluginFactory>,
  settings: Record<string, PluginSettingValue>,
): void {
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
    const keysInstalled: PluginKey[] = [];
    for (const [name, plugin] of plugins) {
      editor.registerPlugin(plugin);
      keysInstalled.push(keyFor(pluginId, name));
    }
    installed.get(editor)?.set(pluginId, keysInstalled);
  }
}

export function registerEditorSurface(editor: Editor): () => void {
  surfaces.add(editor);
  installed.set(editor, new Map());
  for (const [pluginId, contribution] of contributions) {
    install(editor, pluginId, contribution);
  }
  return () => {
    for (const pluginId of [...(installed.get(editor)?.keys() ?? [])]) {
      uninstall(editor, pluginId);
    }
    installed.delete(editor);
    surfaces.delete(editor);
  };
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
    // `view.editable`. Runtime plugin registration is precisely the "silent third
    // path" that contract bans, and refusing this prop here is what lets this module
    // sit in that guard's allowlist honestly rather than as an exemption.
    if (plugin.spec.props?.editable !== undefined) {
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

/** Install one plugin's contributions on ONE surface — the surface-arrives-later path. */
function install(
  editor: Editor,
  pluginId: string,
  contribution: Contribution,
): void {
  const plugins = build(editor, pluginId, contribution);
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
