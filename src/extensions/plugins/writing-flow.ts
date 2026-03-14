// §11.3 Writing Flow ProseMirror Plugin
// Listens to transactions, feeds EditEvents to SessionContextTracker,
// and triggers WritingMode re-detection on significant changes.

import type { EditEvent } from "../../utils/session-context";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { useWritingFlowStore } from "../../stores/writing-flow-store";
import { detectWritingMode } from "../../utils/writing-mode-detector";

export const writingFlowPluginKey = new PluginKey("writingFlow");

// Re-detect mode every N transactions to avoid excessive computation
const REDETECT_INTERVAL = 20;

export const WritingFlow = Extension.create({
  name: "writingFlow",

  addProseMirrorPlugins() {
    let txCount = 0;

    return [
      new Plugin({
        key: writingFlowPluginKey,

        appendTransaction(transactions, _oldState, newState) {
          const store = useWritingFlowStore.getState();

          for (const tr of transactions) {
            if (!tr.docChanged) continue;

            // Determine event type and affected node
            tr.steps.forEach((step) => {
              const json = step.toJSON();
              const isDelete =
                json.stepType === "replace" && json.slice == null;
              const isReplace =
                json.stepType === "replace" &&
                json.slice != null &&
                json.from !== json.to;

              // Resolve the position to find the node type
              const pos = Math.min(json.from ?? 0, newState.doc.content.size);
              const $pos = newState.doc.resolve(pos);
              const nodeType = $pos.parent.type.name;

              // Calculate text length of the change
              const textLength = isDelete
                ? (json.to ?? 0) - (json.from ?? 0)
                : (json.slice?.content?.[0]?.text?.length ?? 0);

              const event: EditEvent = {
                nodeType,
                textLength,
                timestamp: Date.now(),
                type: isDelete ? "delete" : isReplace ? "replace" : "insert",
              };

              store.sessionContext.record(event);
            });
          }

          // Periodically re-detect writing mode
          txCount++;
          if (txCount >= REDETECT_INTERVAL) {
            txCount = 0;

            // Count node types in the document
            const nodeTypes: Record<string, number> = {};
            newState.doc.descendants((node) => {
              nodeTypes[node.type.name] = (nodeTypes[node.type.name] ?? 0) + 1;
              return true;
            });

            // Extract frontmatter if present
            const frontmatter: Record<string, unknown> = {};
            newState.doc.descendants((node) => {
              if (node.type.name === "frontmatter") {
                const text = node.textContent;
                const typeMatch = /type:\s*(\w+)/.exec(text);
                if (typeMatch) frontmatter.type = typeMatch[1];
                return false;
              }
              return true;
            });

            const result = detectWritingMode({
              filePath: store.currentFileId,
              frontmatter,
              nodeTypes,
            });

            if (
              result.mode !== store.currentMode ||
              result.confidence !== store.modeConfidence
            ) {
              store.setMode(result.mode, result.confidence);
            }
          }

          return null;
        },
      }),
    ];
  },
});
