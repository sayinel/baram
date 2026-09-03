import type { CaptureTargets } from "../use-capture-targets";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings/store";
import { CaptureTargetPreview } from "../CaptureTargetPreview";

const LOCALE = "en";

/**
 * 하나의 완결된 `CaptureTargets`를 만든다. 인라인 리터럴을 쓰지 않는 이유: 훅이 필드를
 * 하나 더 갖게 될 때마다 여기 여섯 곳을 손대야 하고, 그때 "기본값이 무엇이어야 하나"를
 * 여섯 번 다시 정하게 된다.
 */
const state = (over: Partial<CaptureTargets> = {}): CaptureTargets => ({
  addressableNames: new Map(),
  failed: false,
  loading: false,
  targets: [],
  unmatchedTags: [],
  ...over,
});

const target = (title: string, path: string, captureCount = 1) => ({
  captureCount,
  matchedTag: title,
  path,
  title,
});

describe("CaptureTargetPreview", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: LOCALE });
  });

  it("says nothing when the tag field is empty", () => {
    render(<CaptureTargetPreview hasTags={false} targets={state()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ‼️ 노트를 읽는 사이에 "일치하는 노트 없음"을 보여 주면 사용자가 오타라고 믿는다.
  it("says nothing while the notes are still loading", () => {
    render(<CaptureTargetPreview hasTags targets={state({ loading: true })} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the matched note and its capture count", () => {
    render(
      <CaptureTargetPreview
        hasTags
        targets={state({ targets: [target("영감노트", "/p", 40)] })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("영감노트");
    expect(screen.getByRole("status")).toHaveTextContent("40");
    // 태그를 치는 동안 내용이 바뀌므로 스크린 리더가 그때마다 다시 읽어야 한다.
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("lists every note when more than one matches", () => {
    render(
      <CaptureTargetPreview
        hasTags
        targets={state({
          targets: [target("영감노트", "/a", 3), target("회고", "/b", 7)],
        })}
      />,
    );
    const status = screen.getByRole("status");
    // 개수와 두 제목 모두 — 하나라도 빠지면 두 번째 대상이 조용히 잘린 것이다.
    expect(status).toHaveTextContent("2");
    expect(status).toHaveTextContent("영감노트");
    expect(status).toHaveTextContent("회고");
  });

  // ‼️ 경고 상태가 성공 상태와 **눈으로 구별되는** 것. 문구만 다르면 오타를 눈으로 막지
  // 못한다(§324-c의 목적이 바로 그것이다).
  it("marks the no-match state with a distinct class", () => {
    render(<CaptureTargetPreview hasTags targets={state()} />);
    expect(screen.getByRole("status").className).toContain("warn");
  });

  it("does not mark a matched target with the warn class", () => {
    render(
      <CaptureTargetPreview
        hasTags
        targets={state({ targets: [target("영감노트", "/p")] })}
      />,
    );
    expect(screen.getByRole("status").className).not.toContain("warn");
  });

  // ‼️ §324-a 태그 **하나**가 맞으면 나머지 오타가 성공에 묻힌다. `#영감노트 #Linsk`는
  // 지금까지 "→ 영감노트"만 말했고, `#Linsk`는 미리보기에서도 토스트에서도 사라졌다 —
  // 성공한 캡처 안에 조용히 아무 데도 닿지 않은 태그가 남는다.
  it("names a tag that matched nothing even when another tag matched", () => {
    render(
      <CaptureTargetPreview
        hasTags
        targets={state({
          targets: [target("영감노트", "/p", 3)],
          unmatchedTags: ["Linsk"],
        })}
      />,
    );

    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("영감노트");
    expect(region).toHaveTextContent("Linsk");
    // 그리고 그 부분은 경고로 **보인다** — 훑어보는 눈이 잡아야 하는 것이 이것이다.
    expect(region.querySelector(".quick-capture-target-warn")).not.toBeNull();
  });

  it("stays clean when every tag matched", () => {
    render(
      <CaptureTargetPreview
        hasTags
        targets={state({ targets: [target("영감노트", "/p", 3)] })}
      />,
    );
    expect(
      screen.getByRole("status").querySelector(".quick-capture-target-warn"),
    ).toBeNull();
  });

  // ‼️ 스캔이 **실패**한 것을 "일치하는 노트 없음"으로 말하면 사용자의 태그를 탓하게
  // 된다. 저장 경로는 이미 그 둘을 가른다(`scanFailed`); 미리보기도 같아야 한다.
  it("says the scan failed rather than blaming the tag", () => {
    render(<CaptureTargetPreview hasTags targets={state({ failed: true })} />);

    const region = screen.getByRole("status");
    expect(region.className).toContain("warn");
    expect(region).toHaveTextContent(
      t("journal.capture.target.scanFailed", LOCALE),
    );
    // 그리고 태그를 탓하는 문구는 **아니다**.
    expect(region).not.toHaveTextContent(
      t("journal.capture.target.none", LOCALE),
    );
  });
});
