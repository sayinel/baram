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

interface FloatingToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  isActive: boolean;
  label: string;
  onClick: () => void;
  title: string;
}

function ToolbarButton({
  label,
  title,
  isActive,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      className={`floating-toolbar-btn ${isActive ? "floating-toolbar-btn-active" : ""}`}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
    >
      {label}
    </button>
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
        isActive={editor.isActive("bold")}
        label="B"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleBold().run()
        }
        title={commandLabel("formatting.bold")}
      />
      <ToolbarButton
        isActive={editor.isActive("italic")}
        label="I"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleItalic().run()
        }
        title={commandLabel("formatting.italic")}
      />
      <ToolbarButton
        isActive={editor.isActive("strike")}
        label="S"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleStrike().run()
        }
        title={commandLabel("formatting.strikethrough")}
      />
      <ToolbarButton
        isActive={editor.isActive("highlight")}
        label="H"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleHighlight().run()
        }
        title={commandLabel("formatting.highlight")}
      />
      <ToolbarButton
        isActive={editor.isActive("superscript")}
        label="X²"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleSuperscript().run()
        }
        title={t("menu.insert.superscript")}
      />
      <ToolbarButton
        isActive={editor.isActive("subscript")}
        label="X₂"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleSubscript().run()
        }
        title={t("menu.insert.subscript")}
      />
      <ToolbarButton
        isActive={editor.isActive("code")}
        label="<>"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleCode().run()
        }
        title={commandLabel("formatting.inlineCode")}
      />
      <ToolbarButton
        isActive={editor.isActive("link")}
        label="Lk"
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
        title={t("toolbar.link")}
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        isActive={editor.isActive("heading", { level: 1 })}
        label="H1"
        onClick={() =>
          chainWithVimExternalEdit(editor)
            .focus()
            .toggleHeading({ level: 1 })
            .run()
        }
        title={commandLabel("formatting.heading1")}
      />
      <ToolbarButton
        isActive={editor.isActive("heading", { level: 2 })}
        label="H2"
        onClick={() =>
          chainWithVimExternalEdit(editor)
            .focus()
            .toggleHeading({ level: 2 })
            .run()
        }
        title={commandLabel("formatting.heading2")}
      />
      <div className="floating-toolbar-separator" />
      <ToolbarButton
        isActive={editor.isActive("blockquote")}
        label="Q"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleBlockquote().run()
        }
        title={commandLabel("formatting.blockquote")}
      />
      <ToolbarButton
        isActive={editor.isActive("bulletList")}
        label="UL"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleBulletList().run()
        }
        title={commandLabel("formatting.bulletList")}
      />
      <ToolbarButton
        isActive={editor.isActive("orderedList")}
        label="OL"
        onClick={() =>
          chainWithVimExternalEdit(editor).focus().toggleOrderedList().run()
        }
        title={commandLabel("formatting.orderedList")}
      />
      <div className="floating-toolbar-separator" />
      <div className="floating-toolbar-ai-wrapper" ref={aiRef}>
        <button
          className={`floating-toolbar-btn ${aiOpen ? "floating-toolbar-btn-active" : ""}`}
          onClick={handleAIOpen}
          title={t("toolbar.ai.commands")}
        >
          <Sparkles size={14} />
        </button>
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
    </BubbleMenu>
  );
}
