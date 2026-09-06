// §43 Ghost Text — Orchestration hook
// Debounces cursor idle, builds context prompt, streams LLM response,
// updates ProseMirror decoration via ghostTextPluginKey meta.

import { useCallback, useEffect, useRef } from "react";

import type { UnlistenFn } from "@tauri-apps/api/event";

import type { Editor } from "@tiptap/core";

import {
  ghostTextPluginKey,
  registerGhostTextAcceptedCallback,
} from "../extensions/plugins/ghost-text";
import { isLLMCancelledRejection, llmCancel, llmComplete } from "../ipc/invoke";
import { useAIStore } from "../stores/ai/ai";
import { useEditorStore } from "../stores/editor/editor";
import { useWritingFlowStore } from "../stores/writing-flow-store";
import { reportCaughtError } from "../utils/async-error-policy";
import {
  type EditorMutationTask,
  registerEditorMutationTask,
} from "../utils/editor/mutation-tasks";
import { GhostTextCache } from "../utils/ghost-text-cache";
import { buildGhostTextConfig } from "../utils/ghost-text-prompt";
import { createLLMStream } from "../utils/llm-stream";
import { getConfigForTask } from "../utils/model-selection";
import { getFilePrivacy, isLLMAllowed } from "../utils/privacy-check";

// §11.2.2 Module-level cache singleton with TTL and file invalidation
const ghostCache = new GhostTextCache();

/** One background prefetch the hook owns (issue 265). */
interface PrefetchEntry {
  /** False once the hook tore it down — its callbacks then do nothing. */
  active: boolean;
  /** The stream's cleanup, once registration finished. */
  cleanup?: () => void;
  /** The file the prefetch belongs to, captured when it started. */
  filePath: string | undefined;
  registration: AbortController;
}

// §11.2.2 Prefetch trigger: true when text ends with sentence punctuation and has >= 2 sentences
// Exported for use in ghost text acceptance handler (Tab key path)
export function shouldPrefetch(text: string): boolean {
  if (!/[.!?。]$/.test(text.trim())) return false;
  const sentenceCount = (text.match(/[.!?。]+/g) || []).length;
  return sentenceCount >= 2;
}

export function useGhostText(editor: Editor | null) {
  const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  /** Aborts a listener registration still in flight (issue 265): until
   *  createLLMStream resolves there is no cleanup handle to call. */
  const registrationRef = useRef<AbortController | null>(null);
  /** Every prefetch the hook has in flight, so unmount can reach them: the
   *  registration to abort, the stream to release, the request to cancel.
   *  A prefetch removes its own entry when it settles. */
  const prefetchesRef = useRef(new Map<string, PrefetchEntry>());
  const activeRequestRef = useRef<null | string>(null);
  const accumulatedRef = useRef("");
  const lastFilePathRef = useRef<string | undefined>(undefined);
  // §298 §12-9b: one mutation task per in-flight request (design §5c).
  const activeTaskRef = useRef<EditorMutationTask | null>(null);

  const cleanup = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // The backend answers a cancel by rejecting the pending llm_complete with
    // LLM_CANCELLED_REJECTION; the catch recognises that rejection by its
    // text, so nothing is recorded here.
    if (activeRequestRef.current) {
      llmCancel(activeRequestRef.current).catch(() => {});
    }
    registrationRef.current?.abort();
    registrationRef.current = null;
    for (const unlisten of unlistenRefs.current) {
      unlisten();
    }
    unlistenRefs.current = [];
    activeRequestRef.current = null;
    accumulatedRef.current = "";
    // The request this task tracked is gone either way — close the record.
    activeTaskRef.current?.finish();
    activeTaskRef.current = null;
  }, []);

  useEffect(() => {
    if (!editor) return;
    // These instances live as long as the hook; bind them here so the cleanup
    // below does not read the refs after the effect ended.
    const prefetches = prefetchesRef.current;

    // Prefetches outlive keystrokes on purpose (they warm the cache), but not
    // the hook and not their file: abort what is still registering, release
    // what is listening, and cancel what the backend is still generating.
    const tearDownPrefetch = (requestId: string, entry: PrefetchEntry) => {
      entry.active = false;
      entry.registration.abort();
      entry.cleanup?.();
      prefetches.delete(requestId);
      llmCancel(requestId).catch(() => {});
    };

    const handleUpdate = () => {
      // §11.2.2 Reconcile the file FIRST, before any early return: a prefetch
      // for another file is stale whatever ghost text may do in this one
      // (disabled, or a private file), and it would otherwise run — and be
      // paid for — until it settled on its own.
      const currentFilePath = activeFilePath();
      if (
        lastFilePathRef.current &&
        currentFilePath !== lastFilePathRef.current
      ) {
        ghostCache.invalidateFile(lastFilePathRef.current);
      }
      lastFilePathRef.current = currentFilePath;
      // A prefetch still warming a cache that is not this file's would write
      // it back when it lands: let it go instead of paying for a completion
      // nobody will read.
      for (const [requestId, entry] of prefetches) {
        if (entry.filePath !== currentFilePath) {
          tearDownPrefetch(requestId, entry);
        }
      }

      const store = useAIStore.getState();
      if (!store.ghostTextEnabled) return;
      const filePrivacy = getFilePrivacy(editor);
      const ghostTaskConfig = getConfigForTask("ghost-text");
      if (
        !isLLMAllowed(store.privacyMode, ghostTaskConfig.provider, filePrivacy)
      )
        return;

      // Cancel previous request
      cleanup();

      const { state } = editor;
      const { from } = state.selection;
      const $from = state.doc.resolve(from);

      // Build context-aware config (D1: block-type modes, D3: cross-file)
      const ghostConfig = buildGhostTextConfig(editor, from, currentFilePath);
      if (ghostConfig.skip) return;

      // Get text before cursor for cache key + min length check
      const textBefore = $from.parent.textBetween(
        0,
        $from.parentOffset,
        undefined,
        "\ufffc",
      );
      if (!textBefore || textBefore.length < 3) return;

      // Check cache first
      const cached = ghostCache.get(textBefore);
      if (cached) {
        editor.view.dispatch(
          editor.state.tr.setMeta(ghostTextPluginKey, {
            text: cached,
            pos: from,
          }),
        );
        return;
      }

      const currentStore = useAIStore.getState();

      // §298 §12-9b (design §5c) — the task must bind HERE, not inside the
      // timer: `from`/`textBefore` above belong to THIS document. Registering
      // inside the callback would leave a state install during the debounce
      // with nothing to invalidate, and the callback would then register into
      // the NEW generation — painting the previous tab's suggestion into the
      // new document (and Tab-accepting it there).
      const task = registerEditorMutationTask(editor.view);
      activeTaskRef.current = task;
      task.addCleanup(() => void cleanup());

      // Debounce
      debounceRef.current = setTimeout(async () => {
        if (!task.isLive()) return;
        const requestId = `ghost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        activeRequestRef.current = requestId;
        accumulatedRef.current = "";

        const storeSnapshot = useAIStore.getState();

        // Re-check privacy — privacyMode may have changed during debounce wait
        const taskCfg = getConfigForTask("ghost-text");
        if (
          !isLLMAllowed(
            storeSnapshot.privacyMode,
            taskCfg.provider,
            getFilePrivacy(editor),
          )
        ) {
          task.finish();
          return;
        }

        // issue 265: one createLLMStream instead of three bare listen()s. It
        // rolls back a half-registered set and cleans itself up on done/error;
        // the cleanup also joins the mutation task so an invalidation while a
        // registration was awaited tears the listeners down at once
        // (addCleanup runs immediately for a dead task, mutation-tasks.ts).
        let streamCleanup: (() => void) | undefined;
        // Abortable while registering: the next keystroke's cleanup() and an
        // invalidation (via the task) both reach a half-registered stream.
        const registration = new AbortController();
        registrationRef.current = registration;
        task.addCleanup(() => registration.abort());
        try {
          streamCleanup = await createLLMStream(
            requestId,
            {
              onDone: () => {
                // A superseded request must not cache the CURRENT request's
                // accumulator under its own (older) context.
                if (activeRequestRef.current !== requestId) return;
                // Cache the result with file path for invalidation
                if (accumulatedRef.current) {
                  ghostCache.set(
                    textBefore,
                    accumulatedRef.current.slice(
                      0,
                      storeSnapshot.maxSuggestionLength,
                    ),
                    currentFilePath,
                  );
                }
                task.finish(); // cache write above is editor-independent
              },
              onError: () => {
                if (activeRequestRef.current !== requestId) return;
                // Silently dismiss on error
                if (task.isLive()) {
                  try {
                    editor.view.dispatch(
                      editor.state.tr.setMeta(ghostTextPluginKey, {
                        text: null,
                        pos: 0,
                      }),
                    );
                  } catch {
                    // ignore
                  }
                }
                task.finish();
              },
              onToken: (token) => {
                if (activeRequestRef.current !== requestId) return;
                if (!task.isLive()) return;

                accumulatedRef.current += token;
                const suggestion = accumulatedRef.current.slice(
                  0,
                  storeSnapshot.maxSuggestionLength,
                );

                // Update ghost text decoration
                try {
                  editor.view.dispatch(
                    editor.state.tr.setMeta(ghostTextPluginKey, {
                      text: suggestion,
                      pos: from,
                    }),
                  );
                } catch {
                  // editor state may have changed — ignore silently
                }
              },
            },
            { signal: registration.signal },
          );
          if (registrationRef.current === registration) {
            registrationRef.current = null;
          }
          // Join the task FIRST: a task that died during the await runs the
          // cleanup right here. Then take the shared handle only if this is
          // still the current request — a stale registration resolving after
          // a newer one must not overwrite the newer request's cleanup, or
          // that request's listeners would outlive their cancel.
          task.addCleanup(streamCleanup);
          if (!task.isLive() || activeRequestRef.current !== requestId) return;
          unlistenRefs.current = [streamCleanup];

          // §11.3 Append Writing Flow context to system prompt
          const flowContext = useWritingFlowStore
            .getState()
            .compositePromptContext();
          const systemPrompt = flowContext
            ? `${ghostConfig.systemPrompt}\n\n${flowContext}`
            : ghostConfig.systemPrompt;

          // Listener registration awaited above — recheck before spending a
          // request on a document that is no longer installed.
          if (!task.isLive()) return;

          await llmComplete(
            ghostConfig.contextText,
            taskCfg.model,
            requestId,
            systemPrompt,
            storeSnapshot.maxSuggestionLength,
            taskCfg.provider,
            taskCfg.baseUrl,
            storeSnapshot.privacyMode,
          );
        } catch (error) {
          // An aborted registration is the expected outcome of a keystroke or
          // an invalidation, not a failure to report; neither is the cancel
          // rejection the backend answers our own llmCancel with. Anything
          // else — including a real failure that raced that cancel — is
          // reported: ghost text is non-critical, but a failure is not
          // nothing. Then release this request's listeners now rather than
          // at the next keystroke (only if no newer request owns the refs).
          const aborted =
            error instanceof DOMException && error.name === "AbortError";
          if (!aborted && !isLLMCancelledRejection(error)) {
            reportCaughtError("ghost-text", error);
          }
          if (activeRequestRef.current === requestId) {
            streamCleanup?.();
            unlistenRefs.current = [];
          }
          task.finish();
        }
      }, currentStore.ghostTextDebounceMs);
    };

    editor.on("update", handleUpdate);

    // §11.2.2 Register prefetch callback triggered after Tab-acceptance
    registerGhostTextAcceptedCallback((acceptedText, pos) => {
      const store = useAIStore.getState();
      if (!store.ghostTextEnabled) return;
      const taskCfg = getConfigForTask("ghost-text");
      const filePrivacy = getFilePrivacy(editor);
      if (!isLLMAllowed(store.privacyMode, taskCfg.provider, filePrivacy))
        return;

      // Build the text that will be before the cursor after acceptance
      const { state } = editor;
      const $from = state.doc.resolve(pos);
      const textBefore =
        $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc") +
        acceptedText;

      if (!shouldPrefetch(textBefore)) return;

      // Fire background prefetch — result stored in cache for next keystroke
      const ghostConfig = buildGhostTextConfig(editor, pos, undefined);
      if (ghostConfig.skip) return;

      const requestId = `prefetch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // Set up listeners before firing — accumulate tokens and cache on done.
      // issue 265: the cleanup is kept and run in `finally` (CLAUDE.md rule),
      // so an invoke that rejects before the backend emits llm:error no longer
      // strands three listeners; the registration is abortable and tracked in
      // the hook's registry, so an unmount reaches a prefetch still
      // registering (a stalled listen() would otherwise strand its first
      // handle and let a later arrival fire a request for a dead hook).
      // Best-effort still: no UI, but reported.
      const registration = new AbortController();
      // The file is captured NOW, from the store: an event queued when the
      // hook is torn down must not be attributed to whatever file is current
      // then.
      const entry: PrefetchEntry = {
        active: true,
        filePath: activeFilePath(),
        registration,
      };
      prefetchesRef.current.set(requestId, entry);
      void (async () => {
        let prefetchText = "";
        const streamCleanup = await createLLMStream(
          requestId,
          {
            onDone: () => {
              // Queued events are still delivered after cleanup (llm-stream.ts);
              // a torn-down prefetch must not write the global cache — nor
              // one whose file is no longer on screen: its cache was
              // invalidated at the switch. The teardown there normally comes
              // first; this covers an update that returned before reaching it
              // (ghost text off, or the new file's privacy).
              if (!entry.active || entry.filePath !== activeFilePath()) return;
              if (prefetchText) {
                ghostCache.set(
                  textBefore,
                  prefetchText.slice(0, store.maxSuggestionLength),
                  entry.filePath,
                );
              }
            },
            onToken: (token) => {
              if (!entry.active) return;
              prefetchText += token;
            },
          },
          { signal: registration.signal },
        );
        entry.cleanup = streamCleanup;
        // The hook may have been torn down between the last listen() settling
        // and this continuation running: the abort came too late for the
        // registration and llmCancel found nothing to cancel yet. Do not start
        // a request for a dead hook.
        if (!entry.active) {
          streamCleanup();
          return;
        }
        try {
          await llmComplete(
            textBefore,
            taskCfg.model,
            requestId,
            ghostConfig.systemPrompt,
            store.maxSuggestionLength,
            taskCfg.provider,
            taskCfg.baseUrl,
            store.privacyMode,
          );
        } finally {
          streamCleanup();
        }
      })()
        .catch((error: unknown) => {
          const aborted =
            error instanceof DOMException && error.name === "AbortError";
          if (aborted || isLLMCancelledRejection(error)) return;
          reportCaughtError("ghost-text prefetch", error);
        })
        .finally(() => {
          prefetchesRef.current.delete(requestId);
        });
    });

    return () => {
      editor.off("update", handleUpdate);
      registerGhostTextAcceptedCallback(null);
      cleanup();
      for (const [requestId, entry] of prefetches) {
        tearDownPrefetch(requestId, entry);
      }
    };
  }, [editor, cleanup]);
}

/** The file the editor is showing right now, from the store — what a cache
 *  entry and a prefetch belong to. */
function activeFilePath(): string | undefined {
  const s = useEditorStore.getState();
  return s.tabs.find((t) => t.id === s.activeTabId)?.filePath;
}
