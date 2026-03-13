/**
 * Shortcut resolver — maps command IDs to ProseMirror key notation,
 * applying user keybinding overrides from settings when present.
 *
 * Registry notation:  "Mod+Shift+X"  (plus-separated, uppercase key)
 * ProseMirror format: "Mod-Shift-x"  (dash-separated, lowercase key)
 */
import { useSettingsStore } from "../../stores/settings-store";

const MODIFIERS = new Set(["Alt", "Ctrl", "Mod", "Shift"]);

/**
 * Resolve a ProseMirror keyboard shortcut for a given command ID.
 *
 * @param commandId  - Registry ID (e.g. "formatting.bold")
 * @param defaultKey - Default ProseMirror key notation (e.g. "Mod-b")
 * @returns The effective ProseMirror key notation, honouring any user override.
 */
export function resolveShortcut(commandId: string, defaultKey: string): string {
  const overrides = useSettingsStore.getState().keybindingOverrides;
  const override = overrides?.[commandId];
  if (override) {
    return registryToProseMirror(override);
  }
  return defaultKey;
}

/**
 * Convert registry/settings notation ("Mod+Shift+X") to ProseMirror
 * key notation ("Mod-Shift-x"). Modifier tokens (Mod, Shift, Alt) are
 * preserved as-is; the final key token is lowercased.
 */
function registryToProseMirror(notation: string): string {
  const tokens = notation.split("+");
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (MODIFIERS.has(token)) {
      result.push(token);
    } else {
      // Final key — lowercase it
      result.push(token.toLowerCase());
    }
  }
  return result.join("-");
}
