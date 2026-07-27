// §69 Built-in plugins — trusted plugin modules compiled INTO the app that
// consume the same public ExtensionContext API as external plugins. They load
// in every build (including release, where §259 gates external plugin code)
// because they are app code: shipping in the bundle, reviewed like any other
// core source. Keeping them behind the plugin API — instead of wiring them
// into core directly — keeps the extension points honest: if a built-in
// can't do something through the API, neither can a third-party plugin.

import type { PluginManifest, PluginModule } from "../types";

import { MEDIA_VIEWER_MANIFEST, MEDIA_VIEWER_MODULE } from "./media-viewer";

export interface BuiltinPlugin {
  manifest: PluginManifest;
  module: PluginModule;
}

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  { manifest: MEDIA_VIEWER_MANIFEST, module: MEDIA_VIEWER_MODULE },
];
