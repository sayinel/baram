import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { BubbleMenu } from "@tiptap/react/menus";
import { Sparkles } from "lucide-react";

// §4.7 Floating Toolbar — BubbleMenu on text selection
import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import { useTranslation } from "../../i18n/useTranslation";
import { useCommandLabel } from "../../keybindings/use-command-label";
import { useFeatureFlags } from "../../stores/settings/features";
import {
  executeAICommand,
  getSelectedText,
  showPrompt,
} from "../../utils/ai-commands";
import {
  type ContentMode,
  detectContentType,
} from "../../utils/content-type-detector";
import {
  type AIAction,
  getActionsForMode,
} from "../../utils/contextual-ai-actions";
import {
  awaitBoundToEditor,
  registerEditorMutationTask,
} from "../../utils/editor/mutation-tasks";
import { showFieldDialog } from "../../utils/field-dialog";
import { extractActionItems } from "../../utils/tasks/extract-action-items";
import { Tooltip } from "../Tooltip";

interface FloatingToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  /** The glyph on the button — `B`, `H1`, `X²`. Deliberately not translated. */
  glyph: string;
  isActive: boolean;
  /**
   * The hover label, already translated. Named `label` rather than `title` because it is no
   * longer a `title` attribute — the app's pill shows it, and a leftover native `title` would
   * double up with the browser's own arriving a second later underneath.
   */
  label: string;
  onClick: () => void;
}

/**
 * ‼️ The pill, not `title`. These buttons are two-character glyphs — `Q`, `UL`, `X₂` — so the
 * label IS the affordance, and a ~1s WebKit delay on a bar that only exists while text is
 * selected means it arrived after the pointer had already committed to a guess.
 *
 * Above, because the bar itself sits above the selection: a pill below would cover the very
 * text the button is about to act on.
 */
function ToolbarButton({
  glyph,
  label,
  isActive,
  onClick,
}: ToolbarButtonProps) {
  return (
    <Tooltip label={label} placement="top">
      <button
        className={`floating-toolbar-btn ${isActive ? "floating-toolbar-btn-active" : ""}`}
        onClick={onClick}
        onMouseDown={(e) => e.preventDefault()}
      >
        {glyph}
      </button>
    </Tooltip>
  );
}

// §6.2 / §11.2.3 Selection-based contextual AI commands in FloatingToolbar dropdown
const AFTER_SEL = { afterSelection: true } as const;

/**
 * Contextual AI actions that ask for one value before running.
 *
 * `label` and `presetKeys` are i18n keys; `presets` are literals.
 *
 * ‼️ The distinction is not style. A preset is BOTH what the user reads and what gets
 * substituted into `token` and sent to the model, so translating one changes the prompt.
 * Tones and human languages are translated (a Korean user picking `한국어` should get
 * Korean); programming-language names are not — they are proper nouns, and `Python` is the
 * value the model needs either way.
 */
const CONTEXTUAL_PROMPTS: Record<
  string,
  { label: string; presetKeys?: string[]; presets?: string[]; token: string }
> = {
  "convert-lang": {
    label: "toolbar.ai.targetLanguage",
    presets: ["Python", "JavaScript", "TypeScript", "Rust"],
    token: "{language}",
  },
  tone: {
    label: "toolbar.ai.selectTone",
    presetKeys: [
      "toolbar.ai.tone.formal",
      "toolbar.ai.tone.casual",
      "toolbar.ai.tone.professional",
      "toolbar.ai.tone.friendly",
    ],
    token: "{tone}",
  },
  translate: {
    label: "toolbar.ai.targetLanguage",
    presetKeys: ["toolbar.lang.english", "toolbar.lang.korean"],
    token: "{language}",
  },
};

export function FloatingToolbar({ editor }: FloatingToolbarProps) {
  const { t } = useTranslation();
  const commandLabel = useCommandLabel();
  const { ai: aiEnabled } = useFeatureFlags();
  const [aiOpen, setAiOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [dropReady, setDropReady] = useState(false);
  const [contentMode, setContentMode] = useState<ContentMode>("text");
  const aiRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!aiOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (aiRef.current && !aiRef.current.contains(e.target as Node)) {
        setAiOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [aiOpen]);

  // Measure dropdown after render, decide direction, then reveal
  useEffect(() => {
    if (!aiOpen) {
      setDropUp(false);
      setDropReady(false);
      return;
    }
    // Wait one frame so DOM layout (including tippy) is settled
    const raf = requestAnimationFrame(() => {
      if (!dropdownRef.current || !aiRef.current) return;
      const btnRect = aiRef.current.getBoundingClientRect();
      const ddRect = dropdownRef.current.getBoundingClientRect();
      const gap = 4;
      const margin = 8;
      const spaceBelow = window.innerHeight - btnRect.bottom - gap - margin;
      setDropUp(ddRect.height > spaceBelow);
      setDropReady(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [aiOpen]);

  const handleAIOpen = useCallback(() => {
    const { from, to } = editor.state.selection;
    const nodeTypes: { type: string }[] = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isBlock) {
        nodeTypes.push({ type: node.type.name });
      }
    });
    setContentMode(detectContentType(nodeTypes));
    setAiOpen((v) => !v);
  }, [editor]);

  const handleContextualAction = useCallback(
    (action: AIAction) => {
      const selection = getSelectedText(editor);
      if (!selection) {
        setAiOpen(false);
        return;
      }
      setAiOpen(false);

      // §314 추출은 자기 흐름을 갖는다 — 프롬프트도, 삽입 방식도 다르다. 무엇보다
      // 결과가 문서로 곧장 가지 않고 diff 미리보기를 지난다(§18.20 위험 8).
      if (action.mode === "tasks") {
        void extractActionItems(editor);
        return;
      }

      const spec = CONTEXTUAL_PROMPTS[action.id];
      if (!spec) {
        executeAICommand(editor, selection, action.systemPrompt, AFTER_SEL);
        return;
      }
      // §12-9d (design §5c): the selection was captured from THIS document,
      // so the prompt must be held by a task bound to it — otherwise a state
      // install while the prompt is open would send the old selection and
      // insert the answer into the replacing document.
      void awaitBoundToEditor(
        editor.view,
        showPrompt(t(spec.label), "", {
          // ‼️ `presetKeys` 는 번역하고 `presets` 는 그대로 쓴다 — 프리셋은 사용자가 읽는
          //    글자이면서 `token` 에 치환돼 모델로 가는 값이다(위 CONTEXTUAL_PROMPTS 주석).
          presets: spec.presetKeys
            ? spec.presetKeys.map((k) => t(k))
            : spec.presets,
        }),
      ).then((value) => {
        if (!value) return; // cancelled, or the document was replaced
        executeAICommand(
          editor,
          selection,
          action.systemPrompt.replace(spec.token, value),
          AFTER_SEL,
        );
      });
    },
    [editor, t],
  );

  const shouldShow = useCallback(() => {
    const { selection } = editor.state;
    // Hide for CellSelection — TableToolbar handles table multi-cell selection
    if (selection instanceof CellSelection) return false;
    // Hide for NodeSelection — atom NodeViews (math, mermaid, image) have their own UI
    if (selection instanceof NodeSelection) return false;
    // Default BubbleMenu behavior for text selections
    const { from, to } = selection;
    return from !== to;
  }, [editor]);

  return (
    <BubbleMenu
      className="floating-toolbar"
      editor={editor}
      shouldShow={shouldShow}
    >
      <ToolbarButton
        glyph="B"
        isActive={editor.isActive("bold")}
        label={commandLabel("formatting.bold")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleBold().run()
        }
      />
      <ToolbarButton
        glyph="I"
        isActive={editor.isActive("italic")}
        label={commandLabel("formatting.italic")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleItalic().run()
        }
      />
      <ToolbarButton
        glyph="S"
        isActive={editor.isActive("strike")}
        label={commandLabel("formatting.strikethrough")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleStrike().run()
        }
      />
      <ToolbarButton
        glyph="H"
        isActive={editor.isActive("highlight")}
        label={commandLabel("formatting.highlight")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleHighlight().run()
        }
      />
      <ToolbarButton
        glyph="X²"
        isActive={editor.isActive("superscript")}
        label={t("menu.insert.superscript")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleSuperscript().run()
        }
      />
      <ToolbarButton
        glyph="X₂"
        isActive={editor.isActive("subscript")}
        label={t("menu.insert.subscript")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleSubscript().run()
        }
      />
      <ToolbarButton
        glyph="<>"
        isActive={editor.isActive("code")}
        label={commandLabel("formatting.inlineCode")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleCode().run()
        }
      />
      <ToolbarButton
        glyph="Lk"
        isActive={editor.isActive("link")}
        label={t("toolbar.link")}
        onClick={async () => {
          if (editor.isActive("link")) {
            chainWithVimExternalEdit(editor).focus().unsetLink().run();
            return;
          }
          // §12-9b: dialog resolution is an async gap (design §5c)
          const task = registerEditorMutationTask(editor.view);
          const result = await showFieldDialog({
            title: t("toolbar.link.insert"),
            fields: [
              {
                key: "url",
                label: t("toolbar.link.url"),
                placeholder: "https://...",
              },
            ],
          });
          const live = task.isLive();
          task.finish();
          if (!result?.url || !live) {
            if (live) editor.commands.focus();
            return;
          }
          chainWithVimExternalEdit(editor)
            .focus()
            .setLink({ href: result.url })
            .run();
        }}
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        glyph="H1"
        isActive={editor.isActive("heading", { level: 1 })}
        label={commandLabel("formatting.heading1")}
        onClick={() =>
          chainWithVimExternalEdit(editor)
            .focus()
            .toggleHeading({ level: 1 })
            .run()
        }
      />
      <ToolbarButton
        glyph="H2"
        isActive={editor.isActive("heading", { level: 2 })}
        label={commandLabel("formatting.heading2")}
        onClick={() =>
          chainWithVimExternalEdit(editor)
            .focus()
            .toggleHeading({ level: 2 })
            .run()
        }
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        glyph="Q"
        isActive={editor.isActive("blockquote")}
        label={commandLabel("formatting.blockquote")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleBlockquote().run()
        }
      />
      <ToolbarButton
        glyph="UL"
        isActive={editor.isActive("bulletList")}
        label={commandLabel("formatting.bulletList")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleBulletList().run()
        }
      />
      <ToolbarButton
        glyph="OL"
        isActive={editor.isActive("orderedList")}
        label={commandLabel("formatting.orderedList")}
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleOrderedList().run()
        }
      />
      {aiEnabled && (
        <>
          {/* §338 구분자를 버튼과 같은 조건 안에 둔다 — 버튼만 숨기면 구분자가
              허공에 남는다. */}
          <div className="floating-toolbar-separator" />
          <div className="floating-toolbar-ai-wrapper" ref={aiRef}>
            <Tooltip label={t("toolbar.ai.commands")} placement="top">
              <button
                className={`floating-toolbar-btn ${aiOpen ? "floating-toolbar-btn-active" : ""}`}
                onClick={handleAIOpen}
              >
                <Sparkles size={14} />
              </button>
            </Tooltip>
            {aiOpen && (
              <div
                className={`floating-toolbar-ai-dropdown ${dropUp ? "floating-toolbar-ai-dropdown-up" : ""}`}
                ref={dropdownRef}
                style={dropReady ? undefined : { visibility: "hidden" }}
              >
                {getActionsForMode(contentMode).map((action) => (
                  <button
                    className="floating-toolbar-ai-item"
                    key={action.id}
                    onClick={() => handleContextualAction(action)}
                  >
                    {t(action.label)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </BubbleMenu>
  );
}
