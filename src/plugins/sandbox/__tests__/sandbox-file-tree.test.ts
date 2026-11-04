// §395 spec 0074 §5.3 · D14 · §7 "빈도 · 줄" — the sandbox's file tree calls: judged before sending with
// the host's sentences, sent one at a time with the cleaned updates, and — through the real client,
// session and host — 64 icon definitions made together all succeed.
import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { SandboxHostRequest } from "../protocol";

import { afterEach, describe, expect, it } from "vitest";

import { __resetDecorationHost } from "../../file-decorations/decoration-host";
import { iconClassOf } from "../../file-decorations/icons";
import {
  ICON_BURST,
  MAX_DECORATION_UPDATES,
} from "../../file-decorations/limits";
import { RELATIVE_PATH_MESSAGE } from "../../file-decorations/validate";
import { createHostRequestHandler } from "../host-request-router";
import { startSandboxClient } from "../sandbox-client";
import { createSandboxFileTree } from "../sandbox-file-tree";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

/** A host whose answers the test gives by hand. */
function manualHost() {
  const asked: SandboxHostRequest[] = [];
  const answer: Array<(ok: boolean) => void> = [];
  const hostRequest = (request: SandboxHostRequest) =>
    new Promise<unknown>((resolve, reject) => {
      asked.push(request);
      answer.push((ok) =>
        ok ? resolve(undefined) : reject(new Error("refused by host")),
      );
    });
  return { answer, asked, hostRequest };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  __resetDecorationHost();
});

describe("createSandboxFileTree", () => {
  /** D14 — one request in flight, in the order called; a refused one does not stop the next. What fails
   *  this: sending as called (three requests in flight at once). */
  it("sends one request at a time, in order", async () => {
    const host = manualHost();
    const api = createSandboxFileTree(host.hostRequest);
    const first = api.clearFileDecorations();
    const second = api.defineFileIcon("a", "<svg/>");
    const third = api.setFileDecorations([]);
    await flush();
    expect(host.asked.map((r) => r.kind)).toEqual([
      "filetree_clear_decorations",
    ]);
    host.answer[0]!(true);
    await first;
    await flush();
    expect(host.asked).toHaveLength(2);
    host.answer[1]!(false);
    await expect(second).rejects.toThrow("refused by host");
    await flush();
    expect(host.asked.map((r) => r.kind)).toEqual([
      "filetree_clear_decorations",
      "filetree_define_icon",
      "filetree_set_decorations",
    ]);
    host.answer[2]!(true);
    await expect(third).resolves.toBeUndefined();
  });

  /** §5.3 — refused here with the host's sentence, and nothing sent. The pair: a valid call is sent. */
  it("refuses before sending, with the host's sentence", async () => {
    const host = manualHost();
    const api = createSandboxFileTree(host.hostRequest);
    await expect(
      api.setFileDecorations([{ decoration: null, path: "/abs.md" }]),
    ).rejects.toThrow(RELATIVE_PATH_MESSAGE);
    await expect(api.defineFileIcon("a.b", "<svg/>")).rejects.toThrow(
      /the name must be/,
    );
    await flush();
    expect(host.asked).toEqual([]);
    void api.setFileDecorations([{ decoration: null, path: "a.md" }]);
    await flush();
    expect(host.asked).toHaveLength(1);
  });

  /** P28 — what is sent is what was judged: one line of tooltip, no unknown field. */
  it("sends the cleaned updates", async () => {
    const host = manualHost();
    void createSandboxFileTree(host.hostRequest).setFileDecorations([
      {
        context: "ctx-1",
        decoration: { tooltip: "a\nb", weight: "bold" } as never,
        path: "a.md",
      },
    ]);
    await flush();
    expect(host.asked[0]).toEqual({
      kind: "filetree_set_decorations",
      updates: [
        { context: "ctx-1", decoration: { tooltip: "a b" }, path: "a.md" },
      ],
    });
  });

  /** P28 — a request Rust would drop unanswered (over its report cap, or holding a lone surrogate) is
   *  refused here; the plugin would otherwise wait out the 150 s request timeout. 1,000 paths of 4,096
   *  Hangul syllables are about 12 MiB. The pair: 1,000 short paths are sent. */
  it("refuses a request Rust would drop, and sends a large ordinary one", async () => {
    const host = manualHost();
    const api = createSandboxFileTree(host.hostRequest);
    const long = "가".repeat(4096);
    await expect(
      api.setFileDecorations(
        Array.from({ length: MAX_DECORATION_UPDATES }, () => ({
          decoration: { badge: "1" },
          path: long,
        })),
      ),
    ).rejects.toThrow(/bytes as sent; the limit is/);
    await expect(
      api.setFileDecorations([
        { decoration: { tooltip: "\uD800" }, path: "a.md" },
      ]),
    ).rejects.toThrow(/lone surrogate/);
    await flush();
    expect(host.asked).toEqual([]);
    void api.setFileDecorations(
      Array.from({ length: MAX_DECORATION_UPDATES }, (_, i) => ({
        decoration: { badge: "1" },
        path: `notes/n${i}.md`,
      })),
    );
    await flush();
    expect(host.asked).toHaveLength(1);
  });
});

describe("through the real client, session and host (D14 · review r2-I2)", () => {
  /** §7 — an icon pack's `Promise.all` of 64 `defineFileIcon` resolves with no refusal. What fails this:
   *  a client without the line — the host's in-flight budget (4) refuses the fifth and later requests. */
  it("defines 64 icons made together", async () => {
    let ctx: SandboxContext | undefined;
    const mod = {
      activate: (c: SandboxContext) => {
        ctx = c;
      },
    };
    const broker = async (op: PluginOp) =>
      op.kind === "source_read" ? "// module injected directly" : undefined;
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => mod, broker);
    const session = new SandboxSession(
      host,
      createHostRequestHandler({
        capabilities: ["filetree"],
        declaredSettings: [],
        declaredStatusBarIds: [],
        pluginId: "icons",
        pluginName: "Icons",
      }),
    );
    await session.activate("icons", {});
    await expect(
      Promise.all(
        Array.from({ length: ICON_BURST }, (_, i) =>
          ctx!.ui.defineFileIcon(`i${i}`, "<svg><path d='M0 0'/></svg>"),
        ),
      ),
    ).resolves.toHaveLength(ICON_BURST);
    expect(iconClassOf("icons", `i${ICON_BURST - 1}`)).toBeDefined();
    session.dispose();
  });
});
