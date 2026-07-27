// §298 Vim Phase 1 — pure core. Adapters import from here; nothing in this
// folder may import ProseMirror (design §2).
export { isMacPlatform, type KeyLike, toKeyToken } from "./keys";
export { step, type StepContext } from "./state-machine";
export {
  type CoreCommand,
  initialCoreState,
  type InsertAnchor,
  type KeyToken,
  type Motion,
  type PendingKey,
  type StepResult,
  type VimCoreState,
  type VimMode,
  type VisualState,
} from "./types";
export {
  collapseTarget,
  isReversed,
  moveVisualHead,
  startVisual,
  visualRange,
} from "./visual-state";
