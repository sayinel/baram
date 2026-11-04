// §395 spec 0074 §5.3 · D14 — the sandbox's half of `ctx.ui`'s three file tree methods. Each call is
// judged before it is sent, by the rules and sentences the host applies (`file-decorations/validate.ts`)
// and against the report Rust would drop unanswered (`sandboxReportProblem`), so the author hears the
// reason at once instead of after the request timeout. The host judges again: this realm is the
// plugin's own. Calls leave one at a time, each after the previous one's answer — the host makes a call
// beyond its buckets wait instead of refusing it, and refuses requests past `INFLIGHT_BUDGET.filetree`
// in flight, so this line is what lets a plugin make its calls together (`Promise.all`). What is sent is
// what was judged: the cleaned updates.
import type { SandboxUIAPI } from "../types";
import type { FileTreeRequest, SandboxHostRequest } from "./protocol";

import {
  iconCallProblem,
  prepareUpdates,
  relativeLocate,
} from "../file-decorations/validate";
import { sandboxReportProblem } from "../prompt-shape";

type FileTreeMethods = Pick<
  SandboxUIAPI,
  "clearFileDecorations" | "defineFileIcon" | "setFileDecorations"
>;

export function createSandboxFileTree(
  hostRequest: (request: SandboxHostRequest) => Promise<unknown>,
): FileTreeMethods {
  /** The answer of the request sent last; the next one is sent after it settles either way. */
  let line: Promise<unknown> = Promise.resolve();
  const send = (request: FileTreeRequest): Promise<void> => {
    const problem = sandboxReportProblem(request);
    if (problem !== null) return Promise.reject(new Error(problem));
    const answered = line.then(() => hostRequest(request));
    line = answered.catch(() => undefined);
    return answered.then(() => undefined);
  };
  return {
    clearFileDecorations: () => send({ kind: "filetree_clear_decorations" }),
    defineFileIcon: (name, svg) => {
      const problem = iconCallProblem(name, svg);
      return problem === null
        ? send({ kind: "filetree_define_icon", name, svg })
        : Promise.reject(new Error(problem));
    },
    setFileDecorations: (updates) => {
      const prepared = prepareUpdates(updates, relativeLocate);
      return typeof prepared === "string"
        ? Promise.reject(new Error(prepared))
        : send({
            kind: "filetree_set_decorations",
            updates: prepared.map(({ decoration, where }) => ({
              ...where,
              decoration,
            })),
          });
    },
  };
}
