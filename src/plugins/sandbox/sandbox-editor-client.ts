// §260 Phase 4b · §388 — the sandboxed tier's `ctx.editor`, split out of `sandbox-client.ts`
// to keep that file under the repo's size line. It runs in the sandbox realm with the client
// and holds no transport of its own: every call is one of the client's host requests, and the
// reads go through the client's staged-read chain (one Rust slot per plugin — see `readStaged`
// in `sandbox-client.ts`).
import type { EditorAPI } from "../types";
import type { SandboxHostRequest } from "./protocol";

/** The client's staged read: the host's inline answer, plus what it staged (or `""`). */
type ReadStaged = (
  request: SandboxHostRequest,
  didStage?: (value: unknown) => boolean,
) => Promise<{ payload: string; value: unknown }>;

export function createSandboxEditorAPI(
  hostRequest: (request: SandboxHostRequest) => Promise<unknown>,
  readStaged: ReadStaged,
): EditorAPI {
  return {
    getMarkdown: async () =>
      (await readStaged({ kind: "editor_get_markdown" })).payload,
    // Staged like `getMarkdown`, because Cmd+A makes this a whole-document read too and an
    // inline answer over 8 KiB enters tauri's shared channel-data queue (code review I1).
    // Positions come back in the response; only the text takes the staged path.
    getSelection: async () => {
      const { payload, value } = await readStaged(
        { kind: "editor_get_selection" },
        // The host tells us whether it staged anything; a bare caret answers inline with
        // no text at all, so pulling would find an empty slot (code review N1). An
        // explicit flag rather than re-deriving `from === to` here, so the rule lives in
        // ONE place — the side that decided.
        (v) => (v as undefined | { staged?: boolean })?.staged === true,
      );
      // §388 — the ref rides inline with the positions, staged or not.
      const { from, ref, to } = value as {
        from: number;
        ref: string;
        to: number;
      };
      return { from, ref, text: payload, to };
    },
    // §4.8 Staged like `getMarkdown` — see the protocol member for why prose is no smaller
    // a secret than its source.
    getText: async () =>
      (await readStaged({ kind: "editor_get_text" })).payload,
    // §388 — `replace` only when the plugin passed one, so a frame never carries the key empty.
    insertMarkdown: async (markdown, opts) => {
      await hostRequest({
        kind: "editor_insert_markdown",
        markdown,
        ...(opts?.replace === undefined ? {} : { replace: opts.replace }),
      });
    },
    insertText: async (text, opts) => {
      await hostRequest({
        kind: "editor_insert_text",
        text,
        ...(opts?.replace === undefined ? {} : { replace: opts.replace }),
      });
    },
    setMarkdown: async (markdown) => {
      await hostRequest({ kind: "editor_set_markdown", markdown });
    },
  };
}
