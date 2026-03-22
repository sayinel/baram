// §82 컨텍스트 탭 바 — 활성 컨텍스트 전환 UI
import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../stores/context/context";
import "../../styles/context-tab-bar.css";

export function ContextTabBar() {
  const { contexts, activeContextId, setActiveContext } = useContextStore(
    useShallow((s) => ({
      contexts: s.contexts,
      activeContextId: s.activeContextId,
      setActiveContext: s.setActiveContext,
    })),
  );

  // M1: Don't render if 0 or 1 context (no need for tab bar)
  if (contexts.length <= 1) return null;

  return (
    <div className="context-tab-bar">
      {contexts.map((ctx) => (
        <button
          className={`context-tab ${ctx.id === activeContextId ? "context-tab--active" : ""}`}
          key={ctx.id}
          onClick={() => setActiveContext(ctx.id)}
          title={ctx.path}
        >
          <span
            className="context-tab__dot"
            style={{ backgroundColor: ctx.color }}
          />
          <span className="context-tab__label">{ctx.label}</span>
        </button>
      ))}
    </div>
  );
}
