// §69 Plugin Shadow-DOM mount — CSS-isolated container for imperative plugin UI
import { useEffect, useRef } from "react";

interface PluginShadowMountProps {
  onMount: (el: HTMLElement) => void;
  onUnmount?: (el: HTMLElement) => void;
}

export function PluginShadowMount({
  onMount,
  onUnmount,
}: PluginShadowMountProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest-callback refs so the mount effect stays [] (mount once) without
  // going stale — the panel's onMount/onUnmount identity may change per render.
  const onMountRef = useRef(onMount);
  const onUnmountRef = useRef(onUnmount);
  onMountRef.current = onMount;
  onUnmountRef.current = onUnmount;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // attachShadow throws if already attached (Strict-Mode remount reuses the node).
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const content = document.createElement("div");
    content.className = "plugin-shadow-content";
    shadow.appendChild(content);
    // NOTE: onMount receives this inner content <div>, not the ShadowRoot —
    // a ShadowRoot has no .style/.classList and would break plugin code.
    // Also: addStyle() (light-DOM, document.head) never reaches shadow
    // content; plugins must append their own <style> to this el instead.
    onMountRef.current(content);
    return () => {
      onUnmountRef.current?.(content);
      content.remove();
    };
  }, []);

  return <div className="plugin-shadow-host" ref={hostRef} />;
}
