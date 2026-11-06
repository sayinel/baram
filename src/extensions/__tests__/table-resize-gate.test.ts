import { Editor } from "@tiptap/core";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";

// §5.5 The "Adjustable table column widths" setting takes away the resize
// handle only: the columnResizing plugin stays installed (its TableView and
// colgroup render the table), but with the setting off its mouse handlers do
// nothing, so a press near a border is an ordinary click.
describe("Table column resize gate: tableColumnResize setting", () => {
  let editor: Editor | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    // A press leaves drag listeners on the document (tableEditing) and the
    // window (columnResizing); one bubbling mouseup clears both.
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    useSettingsStore.setState({ tableColumnResize: true });
    vi.restoreAllMocks();
    editor?.destroy();
    host?.remove();
    editor = undefined;
    host = undefined;
  });

  function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
    });
    const schema = editor.schema;
    const cell = (text: string) =>
      schema.nodes.tableCell.create(
        { colwidth: [120], userResized: false },
        schema.nodes.paragraph.create(null, [schema.text(text)]),
      );
    const table = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [cell("a"), cell("b")]),
    ]);
    editor.view.dispatch(
      editor.state.tr.replaceWith(0, editor.state.doc.content.size, table),
    );
  }

  /** Position right before the Nth cell of the first row. */
  function cellPos(index: number): number {
    const found: number[] = [];
    editor!.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") found.push(pos);
      return true;
    });
    return found[index];
  }

  function raiseHandle(pos: number) {
    editor!.view.dispatch(
      editor!.state.tr.setMeta(columnResizingPluginKey, { setHandle: pos }),
    );
  }

  const pluginState = () => columnResizingPluginKey.getState(editor!.state);

  /** mousemove at the left border of the second cell. */
  function moveOverBorder() {
    const second = cellPos(1);
    vi.spyOn(editor!.view, "posAtCoords").mockReturnValue({
      pos: second + 2,
      inside: second,
    });
    const td = editor!.view.dom.querySelectorAll("td")[1];
    td.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }),
    );
  }

  function pressAtHandle(): MouseEvent {
    raiseHandle(cellPos(0));
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      button: 0,
    });
    editor!.view.dom.querySelectorAll("td")[0].dispatchEvent(event);
    return event;
  }

  it("is on by default and is persisted", () => {
    expect(useSettingsStore.getInitialState().tableColumnResize).toBe(true);
    expect(
      useSettingsStore.persist.getOptions().partialize!(
        useSettingsStore.getState(),
      ),
    ).toHaveProperty("tableColumnResize", true);
  });

  it("on: a press at an active handle starts a drag and takes the event", () => {
    mount();
    const event = pressAtHandle();
    expect(pluginState()?.dragging).toBeTruthy();
    expect(event.defaultPrevented).toBe(true);
  });

  it("off: the same press starts nothing and is left to ProseMirror", () => {
    mount();
    useSettingsStore.setState({ tableColumnResize: false });
    const event = pressAtHandle();
    expect(pluginState()?.dragging).toBeFalsy();
    expect(event.defaultPrevented).toBe(false);
  });

  it("on: pointer movement over a border raises the handle", () => {
    mount();
    moveOverBorder();
    expect(pluginState()?.activeHandle).toBe(cellPos(0));
  });

  it("off: the same movement raises nothing", () => {
    mount();
    useSettingsStore.setState({ tableColumnResize: false });
    moveOverBorder();
    expect(pluginState()?.activeHandle).toBe(-1);
  });

  it("off: pointer movement takes down a handle already up", () => {
    mount();
    raiseHandle(cellPos(0));
    expect(pluginState()?.activeHandle).toBe(cellPos(0));
    useSettingsStore.setState({ tableColumnResize: false });
    moveOverBorder();
    expect(pluginState()?.activeHandle).toBe(-1);
  });

  it("off: a table's colgroup and measured widths still render", () => {
    mount();
    useSettingsStore.setState({ tableColumnResize: false });
    const cols = editor!.view.dom.querySelectorAll("colgroup col");
    expect(cols).toHaveLength(2);
    expect((cols[0] as HTMLElement).style.width).toBe("120px");
  });
});
