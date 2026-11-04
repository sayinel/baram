// §394 spec 0073 D14 · D10 — a sandboxed plugin's sidebar panel, drawn by the host from the content the
// plugin sent (`ui_set_panel`). Its shape mirrors a rendered code block's (`rendered-code-block-view.ts`):
//
//   root  [data-plugin-panel]                   ← outside the shadow root; paint containment (plugin-panels.css)
//   ├ .plugin-panel-head                        ← host-drawn: the title and `Plugin · {name}` (D10)
//   ├ .plugin-panel-error                       ← host-drawn, a refused draw's fixed sentence (§6)
//   ├ .plugin-panel-empty                       ← host-drawn, until the panel's first content
//   └ .plugin-panel-body > .plugin-block-host   ← open shadow root: the sanitized markup and CSS
//
// The panel sits beside the editor, not in it: D17's keyboard and ProseMirror rules do not reach it,
// and export never sees it (`captureEditorHTML` clones the editor's DOM). The host keeps
// `createRenderedHost`'s vim marker, which is harmless here. What is drawn, and when, is
// `paintPanel`'s. Clicks are judged as a code block's (`handleRenderedClicks`) and routed by
// `panelClickHandlers`.

import { useEffect, useRef, useState } from "react";

import type { RenderedSidebarPanel } from "../../plugins/plugin-ui-store";
import type { PanelPaintState } from "../../plugins/rendered/panel-painter";

import { useTranslation } from "../../i18n/useTranslation";
import { paintPanel } from "../../plugins/rendered/panel-painter";
import { panelClickHandlers } from "../../plugins/rendered/panels-host";
import { createRenderedHost } from "../../plugins/rendered/rendered-body";
import { handleRenderedClicks } from "../../plugins/rendered/rendered-clicks";

export function RenderedPanelView({ panel }: { panel: RenderedSidebarPanel }) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PanelPaintState>({ kind: "empty" });
  const { panelId, pluginId } = panel;
  // The badge text at the click, in the app's language then — read through a ref so a locale change
  // does not rebuild the shadow host.
  const source = t("plugin.prompt.source", { name: panel.sourceName });
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    const { host, shadow } = createRenderedHost();
    body.append(host);
    const stopClicks = handleRenderedClicks(
      shadow,
      panelClickHandlers({ panelId, pluginId }, () => sourceRef.current),
    );
    const stopPainting = paintPanel(panelId, shadow, setState);
    return () => {
      stopClicks();
      stopPainting();
      host.remove();
    };
  }, [panelId, pluginId]);

  const faded = state.kind === "failed" && state.faded;
  return (
    <div className="plugin-panel" data-plugin-panel="">
      <div className="plugin-panel-head">
        <span className="plugin-panel-title text-truncate">{panel.title}</span>
        <span className="plugin-panel-source">{source}</span>
      </div>
      {state.kind === "failed" && (
        <div className="plugin-panel-error">
          {t("plugin.block.error", { detail: state.message })}
        </div>
      )}
      {state.kind === "empty" && (
        <div className="plugin-panel-empty">{t("plugin.panel.empty")}</div>
      )}
      <div
        className={
          faded ? "plugin-panel-body plugin-panel-stale" : "plugin-panel-body"
        }
        ref={bodyRef}
      />
    </div>
  );
}
