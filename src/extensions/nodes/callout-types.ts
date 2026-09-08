// §5.9 Callout type table — colour, icon, and the i18n key for the type's name.
//
// Its own module rather than a block at the top of `callout-view.tsx` so the derived
// `CALLOUT_LABEL_KEYS` can be exported without turning that file into a mixed
// components-and-constants module (react-refresh).
import type { Translate } from "../../i18n/useTranslation";
import type { LucideIcon } from "lucide-react";

import {
  AlertTriangle,
  Bug,
  CheckSquare,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  Info,
  Lightbulb,
  List,
  OctagonAlert,
  Pencil,
  Quote,
} from "lucide-react";

/** Callout type definition with Lucide icon and the i18n key for its name. */
export interface CalloutTypeDef {
  color: string;
  icon: LucideIcon;
  /**
   * ‼️ An i18n KEY, not the name — the type picker and the header title are UI.
   *
   * `CALLOUT_LABEL_KEYS` below is what `label-key-coverage.test.ts` checks, and
   * `calloutTypeLabel` is the only thing that should resolve it.
   */
  label: string;
}

export const CALLOUT_TYPES: Record<string, CalloutTypeDef> = {
  tip: { color: "#10b981", icon: Lightbulb, label: "callout.type.tip" },
  info: { color: "#3b82f6", icon: Info, label: "callout.type.info" },
  warning: {
    color: "#f59e0b",
    icon: AlertTriangle,
    label: "callout.type.warning",
  },
  danger: {
    color: "#ef4444",
    icon: OctagonAlert,
    label: "callout.type.danger",
  },
  note: { color: "#6b7280", icon: Pencil, label: "callout.type.note" },
  abstract: {
    color: "#8b5cf6",
    icon: ClipboardList,
    label: "callout.type.abstract",
  },
  todo: { color: "#06b6d4", icon: CheckSquare, label: "callout.type.todo" },
  example: { color: "#14b8a6", icon: List, label: "callout.type.example" },
  quote: { color: "#9ca3af", icon: Quote, label: "callout.type.quote" },
  bug: { color: "#ef4444", icon: Bug, label: "callout.type.bug" },
  success: {
    color: "#22c55e",
    icon: CircleCheck,
    label: "callout.type.success",
  },
  failure: { color: "#ef4444", icon: CircleX, label: "callout.type.failure" },
  question: {
    color: "#eab308",
    icon: CircleHelp,
    label: "callout.type.question",
  },
};

/**
 * Every i18n key {@link CALLOUT_TYPES} can hand a renderer, DERIVED from the table.
 *
 * Derived, not enumerated: a hand-written list would stay green while a fourteenth callout type
 * shipped with an untranslated name.
 */
export const CALLOUT_LABEL_KEYS: readonly string[] = Object.values(
  CALLOUT_TYPES,
).map((def) => def.label);

export const CALLOUT_TYPE_KEYS = Object.keys(CALLOUT_TYPES);

/**
 * The type's name for display.
 *
 * ‼️ The fallback is the whole reason this exists. `[!ANYTHING]` is valid callout markdown, so a
 * type with no entry here — and therefore no key — is reachable from any document. `t()` on a
 * missing key prints the key; the capitalised raw type is what the header showed before this
 * table held keys at all, and it stays the honest answer.
 */
export function calloutTypeLabel(t: Translate, type: string): string {
  const def = CALLOUT_TYPES[type];
  if (def) return t(def.label);
  return type.charAt(0).toUpperCase() + type.slice(1);
}
