// §277.2 R1 — showConfirm의 키보드 기본값.
//
// 이 파일이 생긴 이유: showConfirm의 네 호출부가 전부 파괴적이고(파일/폴더
// 삭제, Zettel 휴지통, 하이라이트 완전 삭제) 그중 하나는 되돌릴 수 없는데,
// Enter가 포커스와 무관하게 확인으로 붙어 있었다. 대화상자는 Cancel에 포커스를
// 줘서 "취소가 기본"이라고 말하면서 Enter는 반대로 동작했다 — 화면이 말하는
// 것과 키보드가 하는 것이 다르면 그건 함정이다.
import { describe, expect, it } from "vitest";

import { showConfirm } from "../confirm-dialog";

/** rAF로 미뤄 둔 초기 포커스가 실제로 걸릴 때까지 기다린다. */
async function afterInitialFocus(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll(".ai-prompt-btn"));
}

function press(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
}

describe("showConfirm keyboard defaults", () => {
  it("focuses Cancel, so the visible default is the safe one", async () => {
    const answer = showConfirm("delete it?");
    await afterInitialFocus();

    expect(document.activeElement).toBe(buttons()[0]);
    press("Escape");
    await answer;
  });

  // ‼️ 이것이 회귀의 본체다. 포커스가 Cancel에 있는 채로 누른 Enter가
  // 확인이면, 되돌릴 수 없는 삭제가 키 하나에 걸린다.
  it("cancels on Enter while Cancel holds focus", async () => {
    const answer = showConfirm("delete it?");
    await afterInitialFocus();

    press("Enter");

    expect(await answer).toBe(false);
  });

  it("confirms on Enter once the user has moved focus to the delete button", async () => {
    const answer = showConfirm("delete it?");
    await afterInitialFocus();
    buttons()[1].focus();

    press("Enter");

    expect(await answer).toBe(true);
  });

  it("still cancels on Escape", async () => {
    const answer = showConfirm("delete it?");
    await afterInitialFocus();

    press("Escape");

    expect(await answer).toBe(false);
  });

  it("confirms when the delete button is clicked", async () => {
    const answer = showConfirm("delete it?");
    await afterInitialFocus();

    buttons()[1].click();

    expect(await answer).toBe(true);
  });

  it("tears the overlay down once answered", async () => {
    const answer = showConfirm("delete it?");
    await afterInitialFocus();
    expect(document.querySelector(".ai-prompt-overlay")).not.toBeNull();

    press("Escape");
    await answer;

    expect(document.querySelector(".ai-prompt-overlay")).toBeNull();
  });
});
