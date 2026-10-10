// §392 spec 0071 — fixtures for the editing-mount tests: a viewer double that records what the
// host does to it, the probe `viewer-edit-harness.tsx` reports to, and the stores seeded with
// open tabs. Functions live here, not in the harness file: a `.tsx` exporting a component AND
// functions trips `react-refresh/only-export-components`.
import type { useFileOperations } from "../../../hooks/use-file-operations";
import type { PluginFileViewer } from "../../../plugins/plugin-ui-store";
import type {
  PluginFileViewerContext,
  PluginFileViewerEdit,
  PluginFileViewerOptions,
} from "../../../plugins/types";
import type { EditorTab } from "../../../stores/editor/editor";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";

export const PATH = "/v/a.strokes";
export const TAB = "t-sketch";

/** App's handlers, as the harness exposes them on every render. */
export interface HarnessApi {
  fileOps: ReturnType<typeof useFileOperations>;
  toggle: () => void;
}

/** What a test reads back from the harness and drives it with. */
export interface HarnessProbe {
  /** Renders of the harness root — the stand-in for "the app rendered" (plan 0121 P14). */
  appRenders: number;
  /** In order: "render:code" from the code-surface stand-in, and what the viewer double pushes. */
  events: string[];
  fileOps: HarnessApi["fileOps"] | null;
  toggle: () => void;
}

/** A viewer the host mounts, recording every call. */
export interface ViewerDouble {
  /** Every ctx the host handed over — onMount's and onUpdate's — in order. */
  contexts: PluginFileViewerContext[];
  /** What getText returns: the double's document. `unknown`, so a test can make it a non-string. */
  model: unknown;
  /** The mounted tab's path in the store at each getText call — "before the path changed" reads off this. */
  pathsAtGetText: (string | undefined)[];
  viewer: PluginFileViewer;
}

/** How many times `name` is in `events`. */
export function count(events: readonly string[], name: string): number {
  return events.filter((e) => e === name).length;
}

/** Report a change the way a plugin does on a pointer move: change the document, then markChanged. */
export function draw(double: ViewerDouble, text: string): void {
  double.model = text;
  lastEdit(double).markChanged();
}

/** The tab activation's buffer fill (`use-tab-switching.ts`) — the harness has no tab switching. */
export function fill(tabId: string, text: string): void {
  const access = useEditorStore.getState().sourceBufferAccess;
  if (!access)
    throw new Error("no source surface has registered its buffer access");
  access.setSourceBuffer(tabId, text);
}

/** The harness's three callbacks, writing into `probe`. */
export function harnessProps(probe: HarnessProbe) {
  return {
    expose: (api: HarnessApi) => {
      probe.fileOps = api.fileOps;
      probe.toggle = api.toggle;
    },
    onCodeRender: () => {
      probe.events.push("render:code");
    },
    onRender: () => {
      probe.appRenders += 1;
    },
  };
}

/** The newest ctx.edit the host handed over. */
export function lastEdit(double: ViewerDouble): PluginFileViewerEdit {
  const edit = double.contexts.at(-1)?.edit;
  if (!edit) throw new Error("the host handed this viewer no ctx.edit");
  return edit;
}

/** A probe that pushes into `events`. */
export function newProbe(events: string[]): HarnessProbe {
  return { appRenders: 0, events, fileOps: null, toggle: () => {} };
}

/** The double as `registerFileViewer` options, for a plugin that registers it itself. */
export function optionsOf(
  double: ViewerDouble,
  id = "pad",
): PluginFileViewerOptions {
  const { extensions, getText, onMount, onUnmount, onUpdate } = double.viewer;
  return {
    editable: true,
    extensions,
    getText,
    id,
    onMount,
    onUnmount,
    onUpdate,
  };
}

/**
 * The stores as App has them with `tabs` open and `active` showing: nothing dirty, no viewer,
 * and auto-save OFF (delay 2 s). Off because most harness tests run on real timers: with it on,
 * every `draw` arms a real 2 s `setTimeout` (`rearmForViewerEdit`), and a save it fires writes
 * the tab and clears its dirty mark under the test's feet. One armed in an earlier test does not
 * reach a later one — `useCodeAutoSave` clears its timer when the harness unmounts (its row "a
 * re-arm's timer does not outlive the hook") — so this keeps timers out of the tests that do not
 * assert saving at all. A test that asserts auto-save turns it on, on fake timers.
 */
export function seedStores(tabs: EditorTab[], active: null | string): void {
  useEditorStore.setState({
    activeTabId: active,
    mruOrder: tabs.map((t) => t.id),
    previewSourceTabs: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs,
  });
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map(tabs.map((t) => [t.filePath, ""])),
  });
  usePluginUIStore.setState({ fileViewers: [] });
  useSettingsStore.setState({
    autoSave: false,
    autoSaveDelay: 2000,
    locale: "en",
    zoomLevel: 1,
  } as never);
  useUIStore.setState({ conflictModal: null, toast: null } as never);
}

/** A clean file tab. */
export function sketchTab(id = TAB, filePath = PATH): EditorTab {
  return {
    contextId: "c",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: filePath.split("/").pop() ?? id,
    type: "file",
  };
}

/**
 * An editable viewer for `.strokes` that pushes "onMount" / "onUpdate" / "onUnmount" /
 * "getText" to `events` as the host calls it, and adopts each `ctx.edit.text` as its document
 * the way a real viewer would.
 */
export function viewerDouble(
  events: string[],
  over: Partial<PluginFileViewer> = {},
): ViewerDouble {
  const double: ViewerDouble = {
    contexts: [],
    model: "",
    pathsAtGetText: [],
    viewer: {
      editable: true,
      extensions: ["strokes"],
      getText: () => {
        events.push("getText");
        const tabId = double.contexts.at(-1)?.edit?.tabId;
        double.pathsAtGetText.push(
          useEditorStore.getState().tabs.find((t) => t.id === tabId)?.filePath,
        );
        return double.model as string;
      },
      onMount: (_el, ctx) => {
        events.push("onMount");
        double.contexts.push(ctx);
        if (ctx.edit) double.model = ctx.edit.text;
      },
      onUnmount: () => {
        events.push("onUnmount");
      },
      onUpdate: (_el, ctx) => {
        events.push("onUpdate");
        double.contexts.push(ctx);
        if (ctx.edit) double.model = ctx.edit.text;
      },
      pluginId: "sketch",
      viewerId: "sketch:pad",
      ...over,
    },
  };
  return double;
}
