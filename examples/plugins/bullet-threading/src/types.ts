/**
 * The shapes this plugin uses from the host. Deliberately structural rather than
 * imported from Baram: a third-party plugin has no access to the app's types, and
 * writing them out is also how this example shows what the contract actually is.
 */

export interface Disposable {
  dispose: () => void;
}

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
  /**
   * ‼️ `settings:changed` is reachable with the `settings` capability alone — it is the one
   * event gated on that rather than on `events`, in BOTH tiers. The frame carries no
   * payload, so there is nothing in it to leak, and requiring `events` would make this
   * plugin's install dialog claim it watches what the user does to their files.
   *
   * Optional here because a host older than that rule hands over a denied proxy, whose
   * every property access throws. See `index.ts` for how that is survived.
   */
  events?: { on: (event: string, handler: () => void) => Disposable };
  settings?: { getAll: () => Record<string, unknown> };
  ui?: { addStyle: (css: string) => Disposable };
}

/** What a `tiptapExtensions` factory receives, per editor surface. */
export interface PluginFactoryContext {
  editor: unknown;
  key: unknown;
  pluginId: string;
  pm: HostProseMirror;
  settings: Record<string, unknown>;
}
