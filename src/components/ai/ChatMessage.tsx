// §44 Chat message bubble component
import MarkdownRenderer from "./MarkdownRenderer";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  onApplyToEditor?: (content: string) => void;
}

export function ChatMessage({
  role,
  content,
  isStreaming,
  onApplyToEditor,
}: ChatMessageProps) {
  return (
    <div className={`chat-message chat-message-${role}`}>
      <div className="chat-message-avatar">{role === "user" ? "U" : "AI"}</div>
      <div className="chat-message-content">
        <div className="chat-message-text">
          {content ? (
            role === "assistant" ? (
              <MarkdownRenderer content={content} />
            ) : (
              content
            )
          ) : isStreaming ? (
            "..."
          ) : (
            ""
          )}
        </div>
        {role === "assistant" && content && !isStreaming && onApplyToEditor && (
          <div className="chat-message-actions">
            <button
              className="chat-message-apply-btn"
              onClick={() => onApplyToEditor(content)}
              title="Insert AI response into editor"
            >
              Apply to Editor
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
