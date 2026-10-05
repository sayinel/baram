// §388 spec 0067 §10 — the error type for a coded editor refusal.
import type { EditorRefusal, EditorRefusalCode } from "./types";

import { editorRefusalMessage } from "./plugin-host-registry";

export class EditorRefusalError extends Error implements EditorRefusal {
  readonly code: EditorRefusalCode;
  constructor(code: EditorRefusalCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EditorRefusal";
  }
}

/** Throw a coded refusal worded by `editorRefusalMessage` (#322). */
export function refuse(
  code: EditorRefusalCode,
  method: string,
  reason: string,
): never {
  throw new EditorRefusalError(code, editorRefusalMessage(method, reason));
}
