// §56m Tag click → search — Cmd/Ctrl+Click on #tag triggers global search
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useUIStore } from "../../stores/ui-store";

const TAG_REGEX = /#([\w가-힣]+(?:\/[\w가-힣]+)*)/g;

export const TagClick = Extension.create({
  name: "tagClick",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tagClick"),
        props: {
          handleClick(view: EditorView, pos: number, event: MouseEvent) {
            // Only handle Cmd+Click (Mac) or Ctrl+Click (Windows/Linux)
            if (!(event.metaKey || event.ctrlKey)) return false;

            const { doc } = view.state;
            const $pos = doc.resolve(pos);
            const parent = $pos.parent;

            // Skip code blocks and frontmatter
            if (
              parent.type.name === "codeBlock" ||
              parent.type.name === "frontmatter"
            ) {
              return false;
            }

            const text = parent.textContent;
            const nodeStart = $pos.start();
            const offsetInNode = pos - nodeStart;

            TAG_REGEX.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = TAG_REGEX.exec(text)) !== null) {
              const tagStart = match.index;
              const tagEnd = tagStart + match[0].length;
              if (offsetInNode >= tagStart && offsetInNode <= tagEnd) {
                const tag = match[1];
                triggerTagSearch(tag);
                event.preventDefault();
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});

function triggerTagSearch(tag: string) {
  const store = useUIStore.getState();

  // Open search sidebar panel
  if (!store.sidebarOpen) {
    store.toggleSidebar();
  }
  if (store.sidebarPanel !== "search") {
    store.setSidebarPanel("search");
  }

  // Dispatch custom event — GlobalSearch listens and sets query
  window.dispatchEvent(
    new CustomEvent("baram:search-query", { detail: { query: `#${tag}` } }),
  );
}
