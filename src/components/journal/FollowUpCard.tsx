// §56j Auto Follow-Up Questions — suggests deeper questions after diary writing
import { useState, useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { useLLMStream } from "../../hooks/use-llm-stream";
import { buildFollowUpPrompt } from "../../utils/journal-reflection";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";

interface FollowUpCardProps {
  editor: Editor | null;
}

/** Check if the active file is a journal daily note */
function isJournalDailyNote(): boolean {
  const { isJournalScoped } = useFileStore.getState();
  if (!isJournalScoped) return false;

  const { tabs, activeTabId } = useEditorStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab?.filePath) return false;

  return activeTab.filePath.includes("/daily/") && activeTab.filePath.endsWith(".md");
}

export function FollowUpCard({ editor }: FollowUpCardProps) {
  const [visible, setVisible] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const suggestedRef = useRef<Map<string, boolean>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const journalAIAutoSuggest = useSettingsStore((s) => s.journalAIAutoSuggest);
  const journalAIReflectionEnabled = useSettingsStore((s) => s.journalAIReflectionEnabled);
  const llm = useLLMStream();

  // Reset state on tab change
  useEffect(() => {
    setVisible(false);
    setQuestionText("");
    setDismissed(false);
  }, [activeTabId]);

  // Debounced trigger: 10s after last editor update
  useEffect(() => {
    if (!editor || !journalAIAutoSuggest || !journalAIReflectionEnabled || dismissed) return;
    if (!isJournalDailyNote()) return;

    const filePath = useEditorStore.getState().tabs.find(
      (t) => t.id === useEditorStore.getState().activeTabId,
    )?.filePath;
    if (!filePath || suggestedRef.current.get(filePath)) return;

    const onUpdate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        // Re-check conditions inside the debounced callback
        if (!isJournalDailyNote()) return;
        const fp = useEditorStore.getState().tabs.find(
          (t) => t.id === useEditorStore.getState().activeTabId,
        )?.filePath;
        if (!fp || suggestedRef.current.get(fp)) return;

        // Check content length > 100 chars (excluding frontmatter)
        let textLen = 0;
        editor.state.doc.descendants((node) => {
          if (node.type.name !== "frontmatter" && node.isTextblock) {
            textLen += node.textContent.length;
          }
        });
        if (textLen < 100) return;

        // Mark as suggested for this file
        suggestedRef.current.set(fp, true);

        // Get body text
        let bodyText = "";
        editor.state.doc.descendants((node) => {
          if (node.type.name !== "frontmatter" && node.isTextblock) {
            bodyText += node.textContent + "\n";
          }
        });

        const { systemPrompt, userPrompt } = buildFollowUpPrompt(bodyText);
        llm.send(userPrompt, systemPrompt, { task: "chat", maxTokens: 300 });
      }, 10000);
    };

    editor.on("update", onUpdate);

    return () => {
      editor.off("update", onUpdate);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, journalAIAutoSuggest, journalAIReflectionEnabled, dismissed, activeTabId, llm]);

  // Show card when LLM response is complete
  useEffect(() => {
    if (!llm.isStreaming && llm.text && !visible && !dismissed) {
      setQuestionText(llm.text.trim());
      setVisible(true);
    }
  }, [llm.isStreaming, llm.text, visible, dismissed]);

  // Insert follow-up question into editor
  const handleInsert = useCallback(() => {
    if (!editor || !questionText) return;

    const endPos = editor.state.doc.content.size;
    const insertText = `\n\n> 💭 ${questionText}\n\n`;

    editor.chain()
      .focus()
      .insertContentAt(endPos, insertText)
      .run();

    setVisible(false);
  }, [editor, questionText]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setVisible(false);
  }, []);

  if (!visible || !questionText) return null;

  return (
    <div className="follow-up-card">
      <div className="follow-up-card-text">{questionText}</div>
      <div className="follow-up-card-actions">
        <button className="follow-up-card-btn follow-up-card-btn-insert" onClick={handleInsert}>
          답변 작성하기
        </button>
        <button className="follow-up-card-btn follow-up-card-btn-dismiss" onClick={handleDismiss}>
          무시
        </button>
      </div>
    </div>
  );
}
