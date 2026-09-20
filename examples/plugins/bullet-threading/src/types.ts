/**
 * The shapes this plugin uses from the host. Deliberately structural rather than
 * imported from Baram: a third-party plugin has no access to the app's types, and
 * writing them out is also how this example shows what the contract actually is.
 */

export interface HostProseMirror {
  Decoration: {
    node: (from: number, to: number, attrs: Record<string, string>) => unknown;
  };
  DecorationSet: {
    create: (doc: unknown, decorations: unknown[]) => unknown;
    empty: unknown;
  };
  Plugin: new (spec: unknown) => unknown;
  PluginKey: new (name: string) => unknown;
}

/** What `activate(context)` receives — the plugin-wide API. */
export interface PluginContext {
  settings?: { getAll: () => Record<string, unknown> };
  ui?: { addStyle: (css: string) => { dispose: () => void } };
}

/** What a `tiptapExtensions` factory receives, per editor surface. */
export interface PluginFactoryContext {
  editor: unknown;
  key: unknown;
  pluginId: string;
  pm: HostProseMirror;
  settings: Record<string, unknown>;
}
