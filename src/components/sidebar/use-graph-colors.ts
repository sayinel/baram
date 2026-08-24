// §30 Graph View — keep the resolved graph colours in step with the active theme.
import { useEffect, useState } from "react";

import type { GraphColors } from "./graph-colors";

import { resolveGraphColors, sameGraphColors } from "./graph-colors";

/**
 * The graph colour tokens as literals, re-resolved whenever the theme changes.
 *
 * Watches the variables themselves rather than the settings that produce them, because
 * they have three independent sources: `data-theme` on the root element (§54 base switch),
 * inline custom properties on the same element (a custom theme's overrides, which the
 * theme editor also writes while the user drags a colour), and `prefers-color-scheme` —
 * the one that decides for the `system` theme, which deliberately sets no `data-theme`.
 * Observing the root element covers all three with no dependency on WHO changed it.
 *
 * The resolve immediately after `observe()` closes the attach gap: §54's own effect writes
 * `data-theme` from a sibling effect, and within one commit it may run either side of this
 * one. It is a re-read of current state, not a wait — nothing here is time-based.
 */
export function useGraphColors(): GraphColors {
  const [colors, setColors] = useState<GraphColors>(() => resolveGraphColors());

  useEffect(() => {
    const sync = () => {
      setColors((prev) => {
        const next = resolveGraphColors();
        return sameGraphColors(prev, next) ? prev : next;
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme", "style"],
      attributes: true,
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);

    sync();

    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);

  return colors;
}
