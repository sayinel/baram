/**
 * Keybinding Actions — runtime registry mapping command IDs to handler functions.
 * §settings: keybinding customization support
 */

export type KeybindingAction = () => void;

const actionMap = new Map<string, KeybindingAction>();

export function clearActions(): void {
  actionMap.clear();
}

export function getAction(id: string): KeybindingAction | undefined {
  return actionMap.get(id);
}

export function registerAction(id: string, action: KeybindingAction): void {
  actionMap.set(id, action);
}
