// §388 spec 0067 §10 — the error type for a coded editor refusal.
import type { EditorRefusal, EditorRefusalCode } from "./types";

import { editorRefusalMessage } from "./plugin-host-registry";
import { EDITOR_REFUSAL_CODES } from "./types";

export class EditorRefusalError extends Error implements EditorRefusal {
  readonly code: EditorRefusalCode;
  constructor(code: EditorRefusalCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EditorRefusal";
  }
}

export function isEditorRefusalCode(
  value: unknown,
): value is EditorRefusalCode {
  return (
    typeof value === "string" &&
    (EDITOR_REFUSAL_CODES as readonly string[]).includes(value)
  );
}

/** Throw a coded refusal worded by `editorRefusalMessage` (#322). */
export function refuse(
  code: EditorRefusalCode,
  method: string,
  reason: string,
): never {
  throw new EditorRefusalError(code, editorRefusalMessage(method, reason));
}
