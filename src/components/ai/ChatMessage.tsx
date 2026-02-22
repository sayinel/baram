// §44 Chat message bubble component

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export function ChatMessage({ role, content, isStreaming }: ChatMessageProps) {
  return (
    <div className={`chat-message chat-message-${role}`}>
      <div className="chat-message-avatar">
        {role === "user" ? "U" : "AI"}
      </div>
      <div className="chat-message-content">
        <div className="chat-message-text">
          {content || (isStreaming ? "..." : "")}
        </div>
      </div>
    </div>
  );
}
