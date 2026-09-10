import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import ko from "../../i18n/ko.json";

describe("space.ai.disabled catalog entry (§341)", () => {
  it("exists in both locales with real text", () => {
    // ‼️ `t(key)` 를 `t(key)` 와 비교하면 안 된다 — `t` 는 키로 폴백하므로
    // 카탈로그 항목을 지워도 초록이 된다 (이 저장소가 8379ee00에서 겪은 거짓 초록).
    expect(en["space.ai.disabled"]).toBe(
      "Enable AI in Settings › AI to use this.",
    );
    expect(ko["space.ai.disabled"]).toBe(
      "이 기능을 쓰려면 설정 › AI에서 'AI 사용'을 켜세요.",
    );
  });

  it("points at the AI tab, not General", () => {
    expect(en["space.ai.disabled"]).toContain("Settings › AI");
    expect(ko["space.ai.disabled"]).toContain("설정 › AI");
  });
});

// ‼️ §338/M-3 update: the local `aiReady()` helper this file used to pin was
// consolidated into the shared `featureReady()` (utils/feature-gate.ts, used
// by both use-keybinding-actions.ts and use-menu-event-handler.ts) — its own
// predicate/toast behavior is now pinned in feature-gate.test.ts instead.
//
// This file keeps ONE thing feature-gate.ts's own tests and
// use-keybinding-actions-feature-gate.test.ts's PREFIX-derived scan cannot:
// `insert.inlineAI` is registered under the "insert" category, not "ai.", so
// a scan that derives its call list from the id prefix `ai.` structurally
// cannot see it (the same gap this file's original comment already named:
// "category로 열거하면 놓친다"). It is pinned here, by name, on purpose.
describe("AI keybinding actions are guarded (§341/§338)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/hooks/use-keybinding-actions.ts"),
    "utf8",
  );

  /** idx 부터 다음 registerAction( 등장(또는 파일 끝)까지 — 그 호출 하나의 몸통만. */
  function sliceOwnBody(idx: number): string {
    const nextIdx = src.indexOf("registerAction(", idx + 1);
    return nextIdx === -1 ? src.slice(idx) : src.slice(idx, nextIdx);
  }

  it("each AI action calls the featureReady guard", () => {
    // ‼️ `insert.inlineAI` 는 category 가 "insert" 다 — category로 열거하면 놓친다
    for (const id of [
      "ai.chatPanel",
      "ai.ghostText",
      "ai.skillTest",
      "insert.inlineAI",
    ]) {
      const idx = src.indexOf(`registerAction("${id}"`);
      expect(idx, `${id} must be registered`).toBeGreaterThan(-1);
      const body = sliceOwnBody(idx);
      expect(body, `${id} must call the featureReady guard`).toMatch(
        /featureReady\("ai"\)/,
      );
    }
  });
});
