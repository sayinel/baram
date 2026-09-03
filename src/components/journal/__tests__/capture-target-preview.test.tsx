import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaptureTargetPreview } from "../CaptureTargetPreview";

describe("CaptureTargetPreview", () => {
  it("says nothing when the tag field is empty", () => {
    render(
      <CaptureTargetPreview
        hasTags={false}
        targets={{ loading: false, targets: [] }}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ‼️ 노트를 읽는 사이에 "일치하는 노트 없음"을 보여 주면 사용자가 오타라고 믿는다.
  it("says nothing while the notes are still loading", () => {
    render(
      <CaptureTargetPreview hasTags targets={{ loading: true, targets: [] }} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the matched note and its capture count", () => {
    render(
      <CaptureTargetPreview
        hasTags
        targets={{
          loading: false,
          targets: [
            {
              captureCount: 40,
              matchedTag: "영감노트",
              path: "/p",
              title: "영감노트",
            },
          ],
        }}
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
        targets={{
          loading: false,
          targets: [
            {
              captureCount: 3,
              matchedTag: "영감노트",
              path: "/a",
              title: "영감노트",
            },
            { captureCount: 7, matchedTag: "회고", path: "/b", title: "회고" },
          ],
        }}
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
    render(
      <CaptureTargetPreview
        hasTags
        targets={{ loading: false, targets: [] }}
      />,
    );
    expect(screen.getByRole("status").className).toContain("warn");
  });

  it("does not mark a matched target with the warn class", () => {
    render(
      <CaptureTargetPreview
        hasTags
        targets={{
          loading: false,
          targets: [
            {
              captureCount: 1,
              matchedTag: "영감노트",
              path: "/p",
              title: "영감노트",
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("status").className).not.toContain("warn");
  });
});
