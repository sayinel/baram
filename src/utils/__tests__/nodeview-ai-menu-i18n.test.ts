// Every render site of the Ask AI action table must pass its label through `t()`.
//
// §11.2.3. `AIAction.label` used to be the English string a menu painted; it is an i18n KEY
// now, so a consumer that still paints `action.label` raw puts `ai.action.improve` on screen.
// The producer was changed and two of its THREE consumers were updated — `FloatingToolbar` and
// `BlockHandleMenu` — while `utils/nodeview-ai-menu.ts` kept painting the raw field. Seven
// NodeViews reach that menu (image, mermaid, math, svg, callout, code block, table toolbar),
// so it was the widest of the three.
//
// ‼️ Neither existing guard could see it. The prose scan is pointed at `components/toolbar`
// and this file is in `src/utils/`; `label-key-coverage.test.ts` proves the KEYS resolve, not
// that anyone resolves them. What is missing in both cases is the CONSUMER side, so that is
// what this file checks — and it finds its consumers by scanning for the import rather than
// listing them, because a list would cover the three that exist and let the fourth escape
// exactly as the third did.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import ko from "../../i18n/ko.json";
import { useSettingsStore } from "../../stores/settings/store";
import { showNodeViewAIMenu } from "../nodeview-ai-menu";

const PRODUCER = "contextual-ai-actions";

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "spike") continue;
      sources(path, found);
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      found.push(path);
    }
  }
  return found;
}

/** Production files that import the action table — the render sites, derived. */
const consumers = sources("src").filter(
  (path) =>
    path !== join("src", "utils", "contextual-ai-actions.ts") &&
    readFileSync(path, "utf8").includes(PRODUCER),
);

describe("Ask AI label consumers", () => {
  it("found the render sites, so the check below is not vacuous", () => {
    // Three at the time of writing. A floor, not an equality: a new consumer should make the
    // NEXT assertion fail on its own merits, not this one.
    expect(consumers.length).toBeGreaterThanOrEqual(3);
    expect(consumers).toContain(join("src", "utils", "nodeview-ai-menu.ts"));
  });

  it.each(consumers)("%s wraps every action label in t()", (path) => {
    // ‼️ Comments are stripped first. They are not decoration here: the fix for this very
    // defect left a note in `nodeview-ai-menu.ts` saying a consumer "painting `action.label`
    // raw" is the bug, and counting that sentence made the guard fail on the fixed file. A
    // scan that counts a token it also uses as prose reports the prose.
    const source = withoutComments(readFileSync(path, "utf8"));
    // Counting, not pattern-negation: `t(action.label` is a substring of `action.label`
    // occurrences, so equal counts mean every occurrence is inside a `t()` call. A raw
    // `{action.label}` makes the totals differ by one.
    const raw = source.match(/\baction\.label\b/g)?.length ?? 0;
    const wrapped = source.match(/\bt\(\s*action\.label\b/g)?.length ?? 0;
    expect({ path, raw, wrapped }).toEqual({ path, raw, wrapped: raw });
  });
});

/**
 * Source with `//` and block comments blanked out.
 *
 * Deliberately crude — it is only ever asked "how many times does `action.label` appear in
 * code", and neither a `//` inside a string literal nor a nested comment changes that count
 * in these files. It is not a tokenizer; `i18n/__tests__/prose-scanner.ts` is, and its one is
 * private to it.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

describe("the NodeView Ask AI menu", () => {
  afterEach(() => {
    useSettingsStore.setState({ locale: "en" });
    document.querySelector(".nodeview-ai-menu")?.remove();
    document.body.innerHTML = "";
  });

  // The consumer scan above is a source check; this is the same claim measured on the DOM the
  // user actually sees. The menu is built with `document.createElement`, not React, so it can
  // serve plain ProseMirror NodeViews — which is also why it reads the locale from the store.
  it("paints Korean labels, not raw keys", () => {
    useSettingsStore.setState({ locale: "ko" });
    const anchor = document.createElement("button");
    document.body.append(anchor);

    const cleanup = showNodeViewAIMenu(
      anchor,
      "text",
      "hello",
      {} as never,
      undefined,
    );
    try {
      const labels = [
        ...document.querySelectorAll(".nodeview-ai-menu-item"),
      ].map((el) => el.textContent ?? "");

      // 6 text actions + §314 extraction + Custom Instruction.
      expect(labels.length).toBe(8);
      // ‼️ 이 8 은 tasks 가 켜져 있을 때다 — 아래 테스트가 그 인자를 고정한다.
      const values = new Set(Object.values(ko as Record<string, string>));
      expect(labels.filter((label) => !values.has(label))).toEqual([]);
      // And specifically not the key shape that shipping raw would produce.
      expect(labels.filter((label) => label.startsWith("ai.action."))).toEqual(
        [],
      );
    } finally {
      cleanup();
    }
  });

  // ‼️ `showNodeViewAIMenu` 는 `getActionsForMode(mode, isFeatureEnabled("tasks"))` 로
  // 인자를 넘기는데, 그 인자가 아무것에도 고정돼 있지 않았다 — 실측으로 `true` 를
  // 하드코딩해도 전부 초록이었다(재리뷰 Minor c). I-7("같은 커맨드가 표면마다 다른 답")을
  // 촉발한 그 세 렌더 표면 중 **이것이 세 번째**이고, 순수 함수 테스트와 tsc 인자 개수에만
  // 의존하고 있었다. 항목 개수는 그 인자만이 바꾸므로 DOM 에서 직접 센다.
  it("drops the extract-tasks item when tasks is off, keeps it when on", () => {
    const countItems = (tasksEnabled: boolean) => {
      useSettingsStore.setState({ locale: "en", tasksEnabled });
      const anchor = document.createElement("button");
      document.body.append(anchor);
      const cleanup = showNodeViewAIMenu(
        anchor,
        "text",
        "hello",
        {} as never,
        undefined,
      );
      try {
        return document.querySelectorAll(".nodeview-ai-menu-item").length;
      } finally {
        cleanup();
        anchor.remove();
      }
    };

    // 양성 대조군이 함께 있어야 "항상 하나 적다" 와 구별된다.
    expect(countItems(true)).toBe(8);
    expect(countItems(false)).toBe(7);
  });
});
