// The Markdown tab renders two kinds of row: hand-written ones that call `t()`, and rows built
// from `extensions/registry.json`. The registry rows used to render the registry's own English
// `label`/`description` verbatim, so Code Block and Mermaid Block were the only settings in the
// app that stayed English while every sibling row was Korean.
//
// `label-key-coverage.test.ts` proves the `settings.ext.*` keys EXIST; this proves the component
// actually asks for them. Nothing is mocked — the real store, the real registry, the real `t()`.
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { setTableColumnResizeFromUser } from "../../../utils/editor/table-width-clear";
import { useSettingsRegistry } from "../settings-registry";
import { MarkdownTab } from "../tabs/MarkdownTab";

const originalLocale = useSettingsStore.getState().locale;
const originalEditor = useEditorStore.getState();
const originalFiles = useFileStore.getState().openFiles;

afterEach(() => {
  useSettingsStore.setState({
    locale: originalLocale,
    tableColumnResize: true,
  });
  useEditorStore.setState({
    documentSurfaceAccess: originalEditor.documentSurfaceAccess,
    tabs: originalEditor.tabs,
  });
  useFileStore.setState({ openFiles: originalFiles });
});

const cellAttrs = {
  alignment: { default: null },
  colspan: { default: 1 },
  colwidth: { default: null },
  rowspan: { default: 1 },
  userResized: { default: false },
};
const schema = new Schema({
  marks: {},
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    table: { content: "tableRow+", group: "block" },
    tableCell: { attrs: cellAttrs, content: "paragraph+" },
    tableHeader: { attrs: cellAttrs, content: "paragraph+" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    text: { group: "inline" },
  },
});

function hasWidths(state: EditorState): boolean {
  let found = false;
  state.doc.descendants((node) => {
    if (node.attrs.userResized || node.attrs.colwidth) found = true;
    return true;
  });
  return found;
}

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

describe("MarkdownTab — table column width option (§5.5)", () => {
  it("renders the option under Tables, in Korean", () => {
    useSettingsStore.setState({ locale: "ko" });
    render(<MarkdownTab />);

    expect(screen.getByText("표")).toBeInTheDocument();
    expect(screen.getByText("표 열 폭 조절")).toBeInTheDocument();
    expect(
      screen.getByText(
        "열 경계를 끌어 폭을 정하고, 표 위 주석으로 파일에 저장합니다. 끄면 열린 탭의 폭 정보가 지워집니다.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the option under Tables, in English", () => {
    useSettingsStore.setState({ locale: "en" });
    render(<MarkdownTab />);

    expect(screen.getByText("Tables")).toBeInTheDocument();
    expect(
      screen.getByText("Adjustable table column widths"),
    ).toBeInTheDocument();
  });

  it("the row's toggle goes through the user path", () => {
    useSettingsStore.setState({ locale: "en", tableColumnResize: true });
    const md =
      "<!-- colwidths:200,300 -->\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";
    const cache = new Map<string, EditorState>();
    const before = EditorState.create({
      doc: markdownToProsemirror(md, schema),
      schema,
    });
    expect(hasWidths(before)).toBe(true);
    cache.set("bg", before);
    useFileStore.setState({ openFiles: new Map() });
    useEditorStore.setState({
      documentSurfaceAccess: {
        editor: { isDestroyed: true, view: null } as never,
        editorStateCache: cache,
        isKeepaliveComplete: () => true,
        keepaliveEditor: () => null,
      },
      tabs: [
        { filePath: "/vault/bg.md", id: "bg", isDirty: false, type: "file" },
      ] as never,
    });
    render(<MarkdownTab />);

    fireEvent.click(
      screen
        .getByText("Adjustable table column widths")
        .closest("div")!
        .parentElement!.querySelector('[role="switch"]')!,
    );

    expect(useSettingsStore.getState().tableColumnResize).toBe(false);
    expect(cache.get("bg")).not.toBe(before);
    expect(hasWidths(cache.get("bg")!)).toBe(false);
  });

  it("the search entry's setter is the user path too", () => {
    const { result } = renderHook(() => useSettingsRegistry());
    const entry = result.current.find((e) => e.id === "tableColumnResize");
    expect(entry?.control).toMatchObject({
      storeSetter: setTableColumnResizeFromUser,
    });
  });
});
