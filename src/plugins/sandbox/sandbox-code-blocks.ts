// §394 spec 0073 §4 · D3 · D13 — `ctx.codeBlocks` inside the sandbox realm: the same API and the
// same refusal sentences as the trusted tier (`rendered/code-block-messages.ts`). The host told
// this realm, in the `activate` frame, which declared languages it holds; `register` binds a
// renderer locally and the `ready` report names what was bound, `invalidate` crosses as
// `render_invalidate`, and the host's `renderCodeBlock` / `invokeAction` frames come here — an
// `invokeAction` for a panel goes on to the panels' handlers (`sandbox-ui.ts`, plan 0126 P26). A result
// is checked before it is sent (`readRenderedContent`), so an over-cap one meets the fixed
// sentence however far over it is. Unchecked, the host's `isRenderResult` would drop a frame whose
// UTF-16 length already passes a cap and Rust a report over its 8 MiB cap — both unanswered, so
// the block would show a timeout — and only one over by its UTF-8 bytes alone would reach the
// queue's check and its sentence.

import type {
  CodeBlockRenderer,
  CodeBlocksAPI,
  RenderedAction,
} from "../types";
import type {
  CodeBlockLangClaim,
  HostToSandbox,
  SandboxHostRequest,
  SandboxToHost,
} from "./protocol";

import { sliceWholeChars, wellFormedText } from "../plugin-text";
import {
  codeBlocksDeniedMessage,
  drawnByMessage,
  undeclaredLangMessage,
} from "../rendered/code-block-messages";
import {
  MAX_RENDER_ERROR_CHARS,
  readRenderedContent,
} from "../rendered/limits";
import { isActionTarget } from "./render-frames";

export interface SandboxCodeBlocks {
  /** The host's `invokeAction` frame. */
  act(frame: Extract<HostToSandbox, { type: "invokeAction" }>): Promise<void>;
  api: CodeBlocksAPI;
  /** The languages `register` bound — the `ready` report's `codeBlocks`. */
  registered(): string[];
  /** The host's `renderCodeBlock` frame. */
  render(
    frame: Extract<HostToSandbox, { type: "renderCodeBlock" }>,
  ): Promise<void>;
  /** A fresh activate: the host's table, and nothing bound yet. */
  reset(langs: CodeBlockLangClaim[] | undefined): void;
}

export function createSandboxCodeBlocks(deps: {
  hostRequest: (request: SandboxHostRequest) => Promise<unknown>;
  readStaged: (request: SandboxHostRequest) => Promise<{ payload: string }>;
  /** plan 0126 P26 — an action on a panel: that panel's handlers (`SandboxUI.runPanelAction`). */
  runPanelAction: (id: string, action: string) => Promise<void>;
  send: (frame: SandboxToHost) => void;
}): SandboxCodeBlocks {
  let declared: Map<string, null | string> | null = null;
  const renderers = new Map<string, CodeBlockRenderer>();
  /** Languages `register` has taken in this activation — what the host may have bound. */
  const registeredOnce = new Set<string>();
  const handlers = new Set<(action: RenderedAction) => Promise<void> | void>();

  const allowed = (method: "invalidate" | "register", lang: string) => {
    if (declared === null) throw new Error(codeBlocksDeniedMessage(method));
    if (!declared.has(lang)) {
      throw new Error(undeclaredLangMessage(method, lang));
    }
    return declared.get(lang) ?? null;
  };

  const requestInvalidate = (lang: string | undefined) =>
    void deps.hostRequest({ kind: "render_invalidate", lang }).catch(() => {});

  const api: CodeBlocksAPI = {
    invalidate(lang) {
      if (declared === null) {
        throw new Error(codeBlocksDeniedMessage("invalidate"));
      }
      // D17 — a declared language another plugin draws: nothing, and nothing crosses.
      if (lang !== undefined && allowed("invalidate", lang) !== null) return;
      requestInvalidate(lang);
    },
    onAction(handler) {
      if (declared === null) {
        throw new Error(codeBlocksDeniedMessage("onAction"));
      }
      handlers.add(handler);
      return { dispose: () => void handlers.delete(handler) };
    },
    register(lang, render) {
      const owner = allowed("register", lang);
      if (owner !== null) throw new Error(drawnByMessage(lang, owner));
      renderers.set(lang, render);
      // D6 · D7 — a language registered before in this activation may be bound on the host, which
      // keeps that binding and would serve the old function's cached answers. The trusted tier's
      // `bindCodeBlockRenderer` drops them on a replacement; here the same `render_invalidate` as
      // `invalidate(lang)` does. A language first registered after `activate` is not bound, and
      // its first `register` sends nothing.
      if (registeredOnce.has(lang)) requestInvalidate(lang);
      registeredOnce.add(lang);
      return {
        dispose: () => {
          if (renderers.get(lang) === render) renderers.delete(lang);
        },
      };
    },
  };

  // P30 — the error crosses Rust's `serde_json::Value`, which refuses a lone surrogate: cut at a
  // whole character, and replace a half the plugin wrote itself, or the frame vanishes and the host
  // shows a timeout instead of the error.
  const failure = (err: unknown) =>
    wellFormedText(sliceWholeChars(messageOf(err), MAX_RENDER_ERROR_CHARS));

  return {
    async act(frame) {
      try {
        if (!isActionTarget(frame.target)) {
          throw new Error("malformed action target");
        }
        const target = frame.target;
        if (target.kind === "panel") {
          await deps.runPanelAction(target.panelId, frame.action);
        } else {
          const action: RenderedAction = {
            action: frame.action,
            context: target.context,
            lang: target.lang,
            path: target.path,
          };
          // D11 ③ — as the trusted dispatch (`createCodeBlocksAPI`): every handler settles before
          // the answer goes, so one rejecting does not end the rights while another still runs.
          const settled = await Promise.allSettled(
            [...handlers].map((h) => Promise.resolve().then(() => h(action))),
          );
          const failed = settled.find((r) => r.status === "rejected");
          if (failed !== undefined) throw failed.reason;
        }
        deps.send({ id: frame.id, ok: true, type: "actionResult" });
      } catch (err) {
        deps.send({
          error: failure(err),
          id: frame.id,
          ok: false,
          type: "actionResult",
        });
      }
    },
    api,
    registered: () => [...renderers.keys()],
    async render(frame) {
      try {
        const renderer = renderers.get(frame.lang);
        if (renderer === undefined) {
          throw new Error(`no renderer is registered for \`\`\`${frame.lang}`);
        }
        const source =
          frame.source ??
          (await deps.readStaged({ id: frame.id, kind: "render_get_source" }))
            .payload;
        // Read as the host's `prepareDrawable` reads it (`readRenderedContent`): a non-object answer
        // meets the same fixed sentence, and each field is read once, so the value checked is the
        // value sent.
        const content = readRenderedContent(await renderer(source, frame.info));
        if (typeof content === "string") throw new Error(content);
        deps.send({ ...content, id: frame.id, ok: true, type: "renderResult" });
      } catch (err) {
        deps.send({
          error: failure(err),
          id: frame.id,
          ok: false,
          type: "renderResult",
        });
      }
    },
    reset(langs) {
      declared =
        langs === undefined
          ? null
          : new Map(langs.map((l) => [l.lang, l.drawnBy]));
      renderers.clear();
      registeredOnce.clear();
      handlers.clear();
    },
  };
}

/**
 * A thrown value's message, or `""` when it gives no string — read guarded, as the host's
 * `thrownMessage` (`render-queue.ts`) reads it, so a `message` getter that throws still lets the
 * error frame go. The host shows `""` as its fixed "the renderer failed", which is what a trusted
 * renderer throwing the same value shows.
 */
function messageOf(err: unknown): string {
  try {
    const message = err instanceof Error ? err.message : err;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}
