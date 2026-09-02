// §324-g fix round 1 — review finding: `.quick-capture-dialog` had a flat
// `max-height: 420px` while the drag-resize clamp (journal-settings.ts) allows
// 120~1200px. Those two numbers were unrelated: the dialog's own chrome
// (header, source/tag inputs, actions, gaps) already ate most of the 420px
// budget, so growing the editor past its default just made flex-shrink
// squeeze it back down to `min-height` — the drag "worked" (state updated,
// `el.style.height` changed) while the screen showed no change at all.
//
// jsdom does not do layout, so `getBoundingClientRect()` cannot see this —
// every element reports zero size. This scans the real CSS text instead and
// pins the RELATIONSHIP: `.quick-capture-editor`'s max-height must be derived
// from the same vh budget as `.quick-capture-dialog`'s, and the settings
// clamp's upper bound must not exceed what that budget can show even on a
// generously large screen. Either constant drifting on its own — the dialog's
// max-height lowered back toward a small fixed px, or the clamp raised past
// what the CSS could ever display — fails this file.
import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { cssDeclarations, cssRules } from "./css-rules";

/** Reference viewport height used only to evaluate the vh-based CSS budget
 * against the settings clamp's upper bound. Deliberately generous (an
 * uncommon, very tall display) — the point is not "this is a typical
 * screen" but "the clamp's upper bound must still make sense at the
 * largest realistic one". */
const REFERENCE_VIEWPORT_PX = 2000;

/** The CSS root font size the `rem` bounds below resolve against. This app
 * never overrides `html { font-size }`, so it is the browser default. */
const ROOT_FONT_SIZE_PX = 16;

function declaration(selector: string, prop: string): string {
  const value = cssDeclarations(rule(selector).body).find(
    (d) => d.prop === prop,
  )?.value;
  if (value === undefined) {
    throw new Error(`${selector} has no \`${prop}\` declaration`);
  }
  return value;
}

/** A CSS length in `px` or `rem`, as a number of px. */
function lengthPx(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)(px|rem)$/u);
  if (!match) throw new Error(`not a px/rem length: ${value}`);
  return Number(match[1]) * (match[2] === "rem" ? ROOT_FONT_SIZE_PX : 1);
}

function rule(selector: string) {
  const found = cssRules().find((r) => r.selector === selector);
  if (!found) throw new Error(`CSS rule not found: ${selector}`);
  return found;
}

describe("§324-g 캡처 다이얼로그 높이 예산 — 리사이즈가 실제로 보이는지", () => {
  it("다이얼로그 max-height는 고정 px가 아니라 뷰포트 비례다", () => {
    // 420px 같은 고정값으로 되돌아가면 이 매치가 실패한다.
    expect(declaration(".quick-capture-dialog", "max-height")).toMatch(
      /^\d+(?:\.\d+)?vh$/,
    );
  });

  it("편집기 max-height는 다이얼로그와 같은 vh 예산에서 chrome을 뺀 값이다", () => {
    const dialogVh = declaration(".quick-capture-dialog", "max-height").match(
      /^(\d+(?:\.\d+)?)vh$/,
    )?.[1];
    const editorMatch = declaration(
      ".quick-capture-editor",
      "max-height",
    ).match(/^calc\((\d+(?:\.\d+)?)vh\s*-\s*(\d+(?:\.\d+)?)px\)$/);

    expect(
      editorMatch,
      ".quick-capture-editor의 max-height가 calc(Nvh - Mpx) 형태가 아니다",
    ).toBeTruthy();
    // 편집기가 다이얼로그와 다른 vh를 쓰면, 다이얼로그를 늘려도 편집기의 상한이
    // 따라오지 않거나(자기 마음대로 60vh 같은 값을 쓰면) 반대로 다이얼로그의
    // max-height를 넘어설 수 있다 — 이번 결함이 바로 그 형태였다.
    expect(editorMatch![1]).toBe(dialogVh);
  });

  it("편집기는 flex-shrink: 0 — 다이얼로그가 빠듯해도 조용히 눌리지 않는다", () => {
    expect(declaration(".quick-capture-editor", "flex-shrink")).toBe("0");
  });

  it("설정 clamp 상한은 아주 큰 화면의 CSS 예산도 넘지 않는다", () => {
    const dialogVh = Number(
      declaration(".quick-capture-dialog", "max-height").match(
        /^(\d+(?:\.\d+)?)vh$/,
      )![1],
    );
    const chromePx = Number(
      declaration(".quick-capture-editor", "max-height").match(
        /^calc\((?:\d+(?:\.\d+)?)vh\s*-\s*(\d+(?:\.\d+)?)px\)$/,
      )![1],
    );
    const cssBudgetAtReference =
      (dialogVh / 100) * REFERENCE_VIEWPORT_PX - chromePx;

    useSettingsStore.getState().setCaptureDialogHeight(999_999);
    const clampMax = useSettingsStore.getState().captureDialogHeight;

    // clampMax가 이 값을 넘으면, 클램프 숫자는 CSS가 절대 보여줄 수 없는
    // "죽은" 상한이 된다 — 반대로 dialogVh를 낮추거나 chromePx를 키워도 이
    // 부등식이 깨지므로, 두 방향의 드리프트를 모두 잡는다.
    expect(clampMax).toBeLessThanOrEqual(cssBudgetAtReference);
  });

  // §323 리뷰 Minor 6: 위 상한 테스트는 fix round 1이 천장 쪽에서 닫은 것이고,
  // 똑같은 어긋남이 바닥에 그대로 남아 있었다 — 클램프는 120에서 멎는데 CSS의
  // `min-height`는 192px(12rem)이라, [120, 192) 구간으로 드래그하면 화면이 절대
  // 보여줄 수 없는 높이가 설정에 저장됐다(`min-height`가 인라인 height를 이긴다).
  // 상한과 같은 방식으로 하한도 고정한다.
  it("설정 clamp 하한은 CSS min-height와 정확히 같다", () => {
    const cssMin = lengthPx(declaration(".quick-capture-editor", "min-height"));

    useSettingsStore.getState().setCaptureDialogHeight(0);
    const clampMin = useSettingsStore.getState().captureDialogHeight;

    // 부등식이 아니라 등식인 이유: `>=`는 클램프가 CSS보다 높은 경우(사용자가
    // CSS가 허용하는 크기까지 줄일 수 없다)를 놓치고, `<=`는 원래 결함(저장은
    // 되는데 그려지지 않는다)을 놓친다. 두 숫자는 같아야만 한다.
    expect(clampMin).toBe(cssMin);
  });

  it("기본 높이는 그 하한과 같다 — 캡처 상자는 기본이 가장 작다", () => {
    // 하한을 올리면서 기본값을 그대로 두면, 기본 상태의 창이 클램프가 허용하는
    // 것보다 작은 높이를 인라인으로 들고 있게 된다.
    expect(useSettingsStore.getInitialState().captureDialogHeight).toBe(
      lengthPx(declaration(".quick-capture-editor", "min-height")),
    );
  });
});
