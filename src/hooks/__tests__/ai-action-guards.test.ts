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

// ‼️ 액션 자체의 동작 단정은 `use-keybinding-actions.ts` 가 614줄이고
// `registerAction` 레지스트리를 통해서만 닿으므로, 가드 존재는 소스 스캔으로
// 고정한다. 헬퍼는 한 번만 정의되므로(§341 계획의 Ruling 1) 두 갈래로 나눈다:
// call site는 `aiReady()` 호출 여부만, 헬퍼 자체는 그 안의 술어·토스트를 본다.
// 이렇게 하면 `insert.inlineAI`에서 가드를 지우는 뮤테이션이 그 액션의
// 단정만 깨뜨리고, 헬퍼 정의를 바꾸는 뮤테이션은 헬퍼 단정만 깨뜨린다.
//
// ‼️ 슬라이스는 다음 `registerAction(` 등장 지점에서 끊는다 — 고정폭 윈도우(예:
// 600자)는 액션이 서로 가까이 붙어 있는 이 파일에서 다음 액션의 `aiReady()`
// 호출까지 자기 몸통인 것처럼 읽어 뮤테이션을 무죄로 만든다(실측: `insert.inlineAI`의
// 가드를 지웠는데도 600자 윈도우가 바로 다음 `ai.chatPanel`의 `aiReady()`를
// 집어 그린으로 남았다).
describe("AI keybinding actions are guarded (§341)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/hooks/use-keybinding-actions.ts"),
    "utf8",
  );

  /** idx 부터 다음 registerAction( 등장(또는 파일 끝)까지 — 그 호출 하나의 몸통만. */
  function sliceOwnBody(idx: number): string {
    const nextIdx = src.indexOf("registerAction(", idx + 1);
    return nextIdx === -1 ? src.slice(idx) : src.slice(idx, nextIdx);
  }

  it("each AI action calls the aiReady() guard", () => {
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
      expect(body, `${id} must call the aiReady() guard`).toMatch(
        /aiReady\(\)/,
      );
    }
  });

  it("the aiReady() helper checks the ai flag and toasts why", () => {
    const idx = src.indexOf("const aiReady = () => {");
    expect(idx, "aiReady helper must be defined").toBeGreaterThan(-1);
    const helper = sliceOwnBody(idx);
    expect(helper, 'helper must check isFeatureEnabled("ai")').toMatch(
      /isFeatureEnabled\("ai"\)/,
    );
    expect(helper, "helper must say why nothing happened").toContain(
      "space.ai.disabled",
    );
  });
});
