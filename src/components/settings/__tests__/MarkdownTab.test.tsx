// The Markdown tab renders two kinds of row: hand-written ones that call `t()`, and rows built
// from `extensions/registry.json`. The registry rows used to render the registry's own English
// `label`/`description` verbatim, so Code Block and Mermaid Block were the only settings in the
// app that stayed English while every sibling row was Korean.
//
// `label-key-coverage.test.ts` proves the `settings.ext.*` keys EXIST; this proves the component
// actually asks for them. Nothing is mocked — the real store, the real registry, the real `t()`.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { MarkdownTab } from "../tabs/MarkdownTab";

const originalLocale = useSettingsStore.getState().locale;

afterEach(() => {
  useSettingsStore.setState({ locale: originalLocale });
});

describe("MarkdownTab — registry-driven extension settings", () => {
  it("renders the Code Block and Mermaid Block rows in Korean", () => {
    useSettingsStore.setState({ locale: "ko" });
    render(<MarkdownTab />);

    // Section headers
    expect(screen.getByText("코드 블록")).toBeInTheDocument();
    expect(screen.getByText("Mermaid 블록")).toBeInTheDocument();

    // Labels + descriptions
    expect(screen.getByText("코드 블록 줄 번호")).toBeInTheDocument();
    expect(
      screen.getByText("코드 블록 안에 줄 번호를 표시합니다"),
    ).toBeInTheDocument();
    expect(screen.getByText("코드 블록 스타일")).toBeInTheDocument();
    expect(screen.getByText("다이어그램 사용")).toBeInTheDocument();

    // <select> option labels — the third string on a registry setting, easy to miss
    for (const option of ["기본", "미니멀", "고대비", "종이"]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    // …and none of the English the registry file holds leaks through
    for (const english of [
      "Line Numbers",
      "Code Block Style",
      "Enable Diagrams",
      "Show line numbers in code blocks",
    ]) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });

  it("names the code-block toggle distinctly from the Source Mode one in English", () => {
    // Editor › Display already owns a toggle whose label was also "Line Numbers"; the two drive
    // different CodeMirror instances, so the labels have to say which one they mean.
    useSettingsStore.setState({ locale: "en" });
    render(<MarkdownTab />);

    expect(screen.getByText("Code Block Line Numbers")).toBeInTheDocument();
    expect(screen.queryByText("Line Numbers")).not.toBeInTheDocument();
  });
});
