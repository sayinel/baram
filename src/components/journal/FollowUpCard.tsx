// §56j Follow-Up Questions — manual trigger button for deeper questions
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { useLLMStream } from "../../hooks/use-llm-stream";
import { useTranslation } from "../../i18n/useTranslation";
import { useEditorStore } from "../../stores/editor-store";
import { useSettingsStore } from "../../stores/settings-store";
import { buildFollowUpPrompt } from "../../utils/journal/journal-reflection";

interface FollowUpCardProps {
  editor: Editor | null;
}

/** Minimum word count to enable the follow-up button */
const MIN_WORDS = 20;

export function FollowUpCard({ editor }: FollowUpCardProps) {
  const { t } = useTranslation();
  const [questionText, setQuestionText] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const journalAIAutoSuggest = useSettingsStore((s) => s.journalAIAutoSuggest);
  const llm = useLLMStream();
  const llmSendRef = useRef(llm.send);
  llmSendRef.current = llm.send;

  // Reset state on tab change
  useEffect(() => {
    setQuestionText("");
    setDismissed(false);
  }, [activeTabId]);

  // Collect body text from editor (excluding frontmatter)
  const getBodyText = useCallback((): {
    text: string;
    wordCount: number;
  } => {
    if (!editor) return { text: "", wordCount: 0 };
    let bodyText = "";
    let wordCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "frontmatter" && node.isTextblock) {
        const content = node.textContent;
        bodyText += content + "\n";
        wordCount += content.trim().split(/\s+/).filter(Boolean).length;
      }
    });
    return { text: bodyText, wordCount };
  }, [editor]);

  // Request follow-up questions from LLM
  const handleRequest = useCallback(() => {
    const { text } = getBodyText();
    if (!text.trim()) return;
    const { systemPrompt, userPrompt } = buildFollowUpPrompt(text);
    llmSendRef.current(userPrompt, systemPrompt, {
      task: "chat",
      maxTokens: 300,
    });
  }, [getBodyText]);

  // Show question when LLM response is complete
  useEffect(() => {
    if (!llm.isStreaming && llm.text && !questionText && !dismissed) {
      setQuestionText(llm.text.trim());
    }
  }, [llm.isStreaming, llm.text, questionText, dismissed]);

  // Insert follow-up question into editor
  const handleInsert = useCallback(() => {
    if (!editor || !questionText) return;
    const endPos = editor.state.doc.content.size;
    const insertText = `\n\n> 💭 ${questionText}\n\n`;
    editor.chain().focus().insertContentAt(endPos, insertText).run();
    setQuestionText("");
    setDismissed(true);
  }, [editor, questionText]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setQuestionText("");
  }, []);

  // Don't render if feature is disabled
  if (!journalAIAutoSuggest || !editor) return null;

  const { wordCount } = getBodyText();
  const hasEnoughContent = wordCount >= MIN_WORDS;

  // State: showing question result
  if (questionText && !dismissed) {
    return (
      <div className="follow-up-card">
        <div className="follow-up-card-text">{questionText}</div>
        <div className="follow-up-card-actions">
          <button
            className="follow-up-card-btn follow-up-card-btn-insert"
            onClick={handleInsert}
          >
            {t("followUp.insert")}
          </button>
          <button
            className="follow-up-card-btn follow-up-card-btn-dismiss"
            onClick={handleDismiss}
          >
            {t("followUp.dismiss")}
          </button>
        </div>
      </div>
    );
  }

  // State: streaming response
  if (llm.isStreaming) {
    return (
      <div className="follow-up-card">
        <div className="follow-up-card-text follow-up-card-loading">
          {llm.text || t("followUp.loading")}
        </div>
      </div>
    );
  }

  // State: error
  if (llm.error && !dismissed) {
    return (
      <div className="follow-up-card">
        <div className="follow-up-card-text follow-up-card-error">
          {llm.error}
        </div>
        <div className="follow-up-card-actions">
          <button
            className="follow-up-card-btn follow-up-card-btn-dismiss"
            onClick={handleDismiss}
          >
            {t("followUp.dismiss")}
          </button>
        </div>
      </div>
    );
  }

  // State: trigger button (only when enough content and not yet dismissed)
  if (hasEnoughContent && !dismissed) {
    return (
      <div className="follow-up-card follow-up-card-trigger">
        <button
          className="follow-up-card-btn follow-up-card-btn-ask"
          onClick={handleRequest}
        >
          <svg
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M12 7v2" />
            <path d="M12 13h.01" />
          </svg>
          {t("followUp.ask")}
        </button>
      </div>
    );
  }

  return null;
}
