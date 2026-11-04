// §394 spec 0073 D13 — the host's renders in flight to one sandbox, by id. A class of its own so
// `SandboxSession` (already past 500 lines) only routes to it. Each render waits for its
// `renderResult`; its source stays here until then, for `render_get_source` to stage. An answer
// for an id not waiting — unknown, timed out, or after `dispose` — is dropped.

import type { CodeBlockInfo, RenderedContent } from "../types";
import type { HostToSandbox, SandboxToHost } from "./protocol";

import {
  INLINE_SOURCE_MAX_FRAME_BYTES,
  RENDER_TIMEOUT_MS,
  utf8Bytes,
} from "../rendered/limits";

interface Waiting {
  reject: (error: Error) => void;
  resolve: (content: RenderedContent) => void;
  source: string;
  timer: ReturnType<typeof setTimeout>;
}

export class SandboxRenderCalls {
  private seq = 0;
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly send: (frame: HostToSandbox) => void) {}

  /** Reject everything still waiting — the session is going away. */
  dispose(): void {
    for (const entry of this.waiting.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Sandbox session disposed"));
    }
    this.waiting.clear();
  }

  /** The answer for one render, or nothing when no render of that id is waiting. */
  settle(frame: Extract<SandboxToHost, { type: "renderResult" }>): void {
    const entry = this.waiting.get(frame.id);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.waiting.delete(frame.id);
    if (!frame.ok) {
      entry.reject(new Error(frame.error));
      return;
    }
    entry.resolve(
      frame.css === undefined
        ? { html: frame.html }
        : { css: frame.css, html: frame.html },
    );
  }

  /** The source of render `id` while it waits — what `render_get_source` stages. */
  source(id: string): string | undefined {
    return this.waiting.get(id)?.source;
  }

  /**
   * Send one render. The source rides the frame while the serialized frame — `JSON.stringify`,
   * UTF-8 — fits `INLINE_SOURCE_MAX_FRAME_BYTES`; otherwise the frame goes without it and the
   * sandbox pulls it. Times out after `RENDER_TIMEOUT_MS`, which also forgets the source.
   */
  start(
    lang: string,
    source: string,
    info: CodeBlockInfo,
  ): Promise<RenderedContent> {
    const id = `render-${++this.seq}`;
    return new Promise<RenderedContent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(
          new Error(
            `the renderer did not answer in ${RENDER_TIMEOUT_MS / 1000} s`,
          ),
        );
      }, RENDER_TIMEOUT_MS);
      this.waiting.set(id, { reject, resolve, source, timer });
      const inline: HostToSandbox = {
        id,
        info,
        lang,
        source,
        type: "renderCodeBlock",
      };
      this.send(
        utf8Bytes(JSON.stringify(inline)) <= INLINE_SOURCE_MAX_FRAME_BYTES
          ? inline
          : { id, info, lang, type: "renderCodeBlock" },
      );
    });
  }
}
