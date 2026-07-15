import type { ExtensionContext } from "../../plugin-api";

// Shadow-DOM styling: addStyle() targets document.head (light DOM) and never
// reaches Shadow-DOM panel content (see PluginShadowMount.tsx). Instead we
// append a <style> element directly to the `el` passed into onMount. CSS
// custom properties (var(--color-*)) still inherit across the shadow
// boundary, so the panel themes itself against the app's design tokens.
const PANEL_STYLE = `
.baram-ai-summary-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-default);
}
.baram-ai-summary-panel button {
  align-self: flex-start;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-secondary);
  color: var(--color-text-default);
  cursor: pointer;
}
.baram-ai-summary-panel button:hover { background: var(--color-bg-hover); }
.baram-ai-summary-panel button:disabled { opacity: 0.5; cursor: default; }
.baram-ai-summary-status { color: var(--color-text-muted); min-height: 1em; }
.baram-ai-summary-output { white-space: pre-wrap; line-height: 1.5; }
`;

const SETTINGS_STYLE = `
.baram-ai-summary-settings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-default);
}
.baram-ai-summary-settings label { color: var(--color-text-muted); }
.baram-ai-summary-settings textarea {
  width: 100%;
  min-height: 5rem;
  resize: vertical;
  box-sizing: border-box;
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-secondary);
  color: var(--color-text-default);
  font: inherit;
}
.baram-ai-summary-settings button {
  align-self: flex-start;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-secondary);
  color: var(--color-text-default);
  cursor: pointer;
}
.baram-ai-summary-settings button:hover { background: var(--color-bg-hover); }
`;

const LAST_SUMMARY_KEY = "last-summary.txt";
const CONFIG_KEY = "config.json";
const DEFAULT_PREFIX = "Summarize the following document concisely:";

interface StoredConfig {
  prefix?: string;
}

function appendStyle(el: HTMLElement, css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  el.appendChild(style);
}

/** Reads the saved prompt prefix from storage, falling back to the default
 * on missing/malformed config (never throws). */
async function readPrefix(ctx: ExtensionContext): Promise<string> {
  try {
    const raw = await ctx.storage.read(CONFIG_KEY);
    if (!raw) return DEFAULT_PREFIX;
    const parsed = JSON.parse(raw) as StoredConfig;
    return parsed.prefix?.trim() || DEFAULT_PREFIX;
  } catch {
    return DEFAULT_PREFIX;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function activate(ctx: ExtensionContext): void {
  ctx.ui.addSidebarPanel({
    id: "summary",
    title: "AI Summary",
    icon: "✨",
    onMount(el: HTMLElement) {
      appendStyle(el, PANEL_STYLE);

      const container = document.createElement("div");
      container.className = "baram-ai-summary-panel";

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Summarize";

      const status = document.createElement("div");
      status.className = "baram-ai-summary-status";

      const output = document.createElement("div");
      output.className = "baram-ai-summary-output";

      container.append(button, status, output);
      el.appendChild(container);

      let busy = false;

      const summarize = async (): Promise<void> => {
        if (busy) return;
        busy = true;
        button.disabled = true;
        status.textContent = "Summarizing…";
        try {
          const prefix = await readPrefix(ctx);
          const doc = ctx.editor.getContent();
          const summary = await ctx.ai.complete(`${prefix}\n\n${doc}`, {
            maxTokens: 512,
          });
          output.textContent = summary;
          await ctx.storage.write(LAST_SUMMARY_KEY, summary);
        } catch (err) {
          ctx.ui.showNotification(
            `AI Summary failed: ${errorMessage(err)}`,
            "error",
          );
        } finally {
          status.textContent = "";
          busy = false;
          button.disabled = false;
        }
      };

      button.addEventListener("click", () => {
        void summarize();
      });

      // Restore the last cached summary (if any) on mount.
      ctx.storage
        .read(LAST_SUMMARY_KEY)
        .then((cached) => {
          if (cached) output.textContent = cached;
        })
        .catch((err: unknown) => {
          ctx.ui.showNotification(
            `Could not load cached summary: ${errorMessage(err)}`,
            "error",
          );
        });
    },
    onUnmount() {
      // No timers/intervals to tear down — the host removes this panel's
      // Shadow-DOM subtree (and its event listeners) on unmount.
    },
  });

  ctx.ui.addSettingsTab({
    id: "config",
    title: "AI Summary",
    onMount(el: HTMLElement) {
      appendStyle(el, SETTINGS_STYLE);

      const container = document.createElement("div");
      container.className = "baram-ai-summary-settings";

      const label = document.createElement("label");
      label.textContent = "Summary prompt prefix";
      label.htmlFor = "baram-ai-summary-prefix";

      const textarea = document.createElement("textarea");
      textarea.id = "baram-ai-summary-prefix";
      textarea.placeholder = DEFAULT_PREFIX;

      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save";

      container.append(label, textarea, save);
      el.appendChild(container);

      ctx.storage
        .read(CONFIG_KEY)
        .then((raw) => {
          if (!raw) return;
          try {
            const parsed = JSON.parse(raw) as StoredConfig;
            if (parsed.prefix) textarea.value = parsed.prefix;
          } catch {
            // Malformed config — leave the field empty (placeholder shows
            // the default prefix).
          }
        })
        .catch((err: unknown) => {
          ctx.ui.showNotification(
            `Could not load AI Summary settings: ${errorMessage(err)}`,
            "error",
          );
        });

      save.addEventListener("click", () => {
        const prefix = textarea.value.trim() || DEFAULT_PREFIX;
        ctx.storage
          .write(CONFIG_KEY, JSON.stringify({ prefix }))
          .then(() => {
            ctx.ui.showNotification("AI Summary settings saved.", "info");
          })
          .catch((err: unknown) => {
            ctx.ui.showNotification(
              `Failed to save settings: ${errorMessage(err)}`,
              "error",
            );
          });
      });
    },
  });
}

export function deactivate(): void {
  // Disposables (sidebar panel + settings tab) auto-clean on unload.
}
