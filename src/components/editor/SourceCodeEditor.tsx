// §5.1 Source Code Mode — CodeMirror 6 editor (markdown + non-MD languages)
import { useEffect, useImperativeHandle, useRef } from "react";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { getHighlightStyle } from "../../extensions/nodes/code-block-highlight";
import { getLanguageExtension } from "../../extensions/nodes/code-block-languages";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { textReplaceRange } from "../../utils/editor/text-replace-range";
import { logger } from "../../utils/logger";
import { createVimController } from "./vim-controller";

/**
 * §312 이 트랜잭션은 **바깥 버퍼를 화면에 반영한 것**이지 사용자의 편집이 아니다.
 *
 * 표시가 없으면 두 가지가 깨진다. onChange가 되쏘여 버퍼가 자기 값을 다시 받고
 * (리렌더 한 바퀴가 그냥 낭비된다), `userEditedRef`가 켜져 토글-백의 WebKit 아티팩트
 * 방어(`hasUserEdited`)가 "사용자가 쳤다"고 착각한다.
 */
const ExternalSync = Annotation.define<boolean>();

/**
 * §312 바깥 버퍼를 화면에 반영하는 트랜잭션이 달고 나가는 표시 한 벌.
 *
 * `ExternalSync`만으로는 부족하다. 그것은 `onChange` 되쏘기와 `userEditedRef`만 막고,
 * 트랜잭션은 여전히 **실행 취소 스택에 쌓인다**(`history()`가 아래 확장 목록에 있다).
 * 그러면 아젠다에서 지운 줄이 Cmd+Z 한 번에 되살아나고 — 그 undo 트랜잭션에는 표시가
 * 없으므로 — `onChange`가 되살아난 텍스트를 공유 버퍼에 그대로 써 넣는다. 태스크 스토어는
 * 그 항목을 이미 빼 놓았으므로 그 파일의 다음 조작은 한 줄 위에 쓴다.
 *
 * 실행 취소는 사용자 자신의 편집만 되돌려야 한다. 바깥에서 온 변경은 이 표면이 만든 것이
 * 아니므로 이 표면의 실행 취소 스택에 있을 자리가 없다.
 */
const EXTERNAL_SYNC_ANNOTATIONS = [
  ExternalSync.of(true),
  Transaction.addToHistory.of(false),
];

export interface SourceCodeEditorRef {
  getContent(): string;
  getCursorOffset(): number;
  /**
   * §291 CodeMirror의 실제 스크롤 요소.
   *
   * ‼️ 바깥 래퍼 div가 아니다. CM6는 `.cm-scroller`가 스크롤하고 `view.scrollDOM`이 그것을
   * 가리킨다. 래퍼에 리스너를 달면 scroll 이벤트가 오지 않는다.
   */
  getScrollElement(): HTMLElement | null;
  getScrollTop(): number;
  hasUserEdited(): boolean;
  setScrollTop(n: number): void;
}

interface SourceCodeEditorProps {
  content: string;
  /**
   * §312 **effect 시점의** 권위 있는 텍스트를 읽는다. `content`는 렌더 시점의 스냅샷이라
   * 트리거로만 쓴다.
   *
   * ‼️ 둘을 나누는 이유는 경합 하나 때문이다. 렌더가 버퍼를 읽은 뒤 effect가 돌기 전에
   * 사용자가 한 글자를 치면, 그 스냅샷은 이미 **뷰보다 낡았다**. 스냅샷을 그대로 밀어
   * 넣으면 방금 친 글자를 지우고 캐럿까지 옮긴다. 접근자로 다시 물으면 그 순간의 버퍼가
   * 나오고, 그것이 뷰와 같으면 아무 일도 일어나지 않는다.
   *
   * ‼️ optional이 아니다. 없을 때 `content`로 폴백하면 **바로 그 결함**이 조용히 돌아온다 —
   * 배선을 하나 빠뜨린 새 호출자가 아무 신호 없이 사용자의 타이핑을 지우게 된다. 컴파일러가
   * 대신 잡게 둔다.
   */
  getLatestContent: () => string;
  initialCursorOffset?: number;
  /** CodeMirror language name (e.g. "json", "python"). Omit or "markdown" for markdown. */
  language?: string;
  onChange: (content: string) => void;
  ref?: React.Ref<SourceCodeEditorRef>;
}

export function SourceCodeEditor({
  content,
  getLatestContent,
  onChange,
  initialCursorOffset,
  language,
  ref,
}: SourceCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Guard: prevent onChange during destroy (React StrictMode double-invoke safety)
  const isDestroyingRef = useRef(false);
  // Track whether the user has genuinely edited (vs browser/IME artifacts)
  const userEditedRef = useRef(false);
  // §312 마운트 effect는 한 번만 돌므로 최신 접근자를 ref로 들고 간다. 렌더 중 대입은
  // "가장 최근 값" ref의 표준 패턴이다 — 이 값을 읽는 쪽은 전부 effect 안이다.
  const latestContentRef = useRef(getLatestContent);
  latestContentRef.current = getLatestContent;
  /** 지금 화면에 보여야 할 텍스트 — **호출 시점의** 진실원이다. */
  const readAuthoritative = () => latestContentRef.current();

  useImperativeHandle(ref, () => ({
    getCursorOffset(): number {
      if (!viewRef.current) return 0;
      return viewRef.current.state.selection.main.head;
    },
    getContent(): string {
      if (!viewRef.current) return "";
      return viewRef.current.state.doc.toString();
    },
    getScrollElement(): HTMLElement | null {
      return viewRef.current?.scrollDOM ?? null;
    },
    getScrollTop(): number {
      return viewRef.current?.scrollDOM.scrollTop ?? 0;
    },
    hasUserEdited(): boolean {
      return userEditedRef.current;
    },
    setScrollTop(n: number): void {
      if (viewRef.current) viewRef.current.scrollDOM.scrollTop = n;
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    isDestroyingRef.current = false;
    userEditedRef.current = false;

    // Guard: ignore spurious docChanged during initialization
    // WebKit injects "<!--  -->" into contenteditable on focus — must be cleaned up
    let initialized = false;

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || isDestroyingRef.current || !initialized) return;
      // §312 우리가 밀어 넣은 동기화는 사용자의 편집이 아니다(ExternalSync 주석 참조).
      if (update.transactions.some((tr) => tr.annotation(ExternalSync))) return;
      userEditedRef.current = true;
      onChange(update.state.doc.toString());
    });

    const cursorPos = Math.min(initialCursorOffset ?? 0, content.length);
    const currentTabSize = useSettingsStore.getState().tabSize;
    const showLineNumbers = useSettingsStore.getState().lineNumbers;
    const autoPair = useSettingsStore.getState().autoPairBrackets;

    // Dynamic language via Compartment — markdown (sync), others (async)
    const langCompartment = new Compartment();
    const isMarkdown = !language || language === "markdown";
    const initialLang = isMarkdown ? markdown() : [];
    // §298 vim slot — empty unless the setting is on; filled asynchronously so
    // users who never enable vim never download the module.
    const vimCompartment = new Compartment();
    // §298 3v mechanism — the controller removes the editing host
    // (editable=false) in normal/visual mode so WebKit's non-cancelable
    // composition path can never start. Empty = default (editable).
    const vimEditableCompartment = new Compartment();

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Swallow Mod-/ — handled by App's global shortcut. NOTE: this does
        // NOT sit "above" vim in DOM order — ALL keymaps run through a single
        // Prec.default DOM handler (@codemirror/view handleKeyEvents), so
        // vim's own Prec.highest ViewPlugin handler sees keys first. Mod-/
        // keeps working only because vim binds no <M-/>/<C-/>; the real
        // source-mode escape hatch is the window-level dispatcher (S3).
        Prec.highest(keymap.of([{ key: "Mod-/", run: () => true }])),
        // §298 diagnosis tripwire — when ANY view extension crashes (update
        // or measure phase), CodeMirror logs one console.error and silently
        // deactivates the plugin: vim would die with no visible symptom
        // except ghost cursors / dead keybindings. Route it through our
        // logger so the next occurrence leaves a durable, greppable stack.
        EditorView.exceptionSink.of((err) => {
          logger.error("[source-editor] CodeMirror extension crashed:", err);
        }),
        vimCompartment.of([]),
        vimEditableCompartment.of([]),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...(autoPair ? closeBracketsKeymap : []),
          indentWithTab,
        ]),
        history(),
        ...(showLineNumbers ? [lineNumbers()] : []),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(getHighlightStyle()),
        ...(autoPair ? [closeBrackets()] : []),
        langCompartment.of(initialLang),
        updateListener,
        EditorView.lineWrapping,
        EditorState.tabSize.of(currentTabSize),
        indentUnit.of(" ".repeat(currentTabSize)),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "14px",
          },
          ".cm-content": {
            fontFamily: "var(--font-family-mono)",
            padding: "1rem 2rem",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--color-editor-cursor)",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-bg-subtle)",
            borderRight: "1px solid var(--color-border-subtle)",
          },
        }),
      ],
      selection: EditorSelection.cursor(cursorPos),
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Async language loading for non-markdown languages
    if (!isMarkdown && language) {
      getLanguageExtension(language).then((ext) => {
        if (isDestroyingRef.current || !ext) return;
        view.dispatch({ effects: langCompartment.reconfigure(ext) });
      });
    }

    // §298 Vim keybindings (Phase 0a) — the load/toggle/race/guard lifecycle
    // lives in the controller, which is unit-tested with fakes. The editor
    // stays fully usable if the vim chunk fails to load (controller reports
    // here; the loader does not cache rejections, so the next toggle retries).
    const vimController = createVimController(view, vimCompartment, {
      editableCompartment: vimEditableCompartment,
      onError: (err) => logger.error("[vim] Failed to load vim:", err),
      // §298 S3 — StatusBar mode indicator. The controller emits null on
      // toggle-off and on dispose, so unmount resets the store too.
      onModeChange: (mode) =>
        useUIStore
          .getState()
          .setVimStatus(mode ? { mode, surface: "source" } : null),
    });
    vimController.apply(useSettingsStore.getState().vimMode);
    // Apply setting changes while the editor is open (mount-time read alone
    // would ignore a toggle until the next source-mode entry).
    const unsubscribeVim = useSettingsStore.subscribe((s, prev) => {
      if (s.vimMode !== prev.vimMode) vimController.apply(s.vimMode);
    });

    // Two-phase init: focus first (triggers WebKit artifacts), then clean up
    requestAnimationFrame(() => {
      if (isDestroyingRef.current) return;

      // Focus first — WebKit may inject content (e.g., "<!--  -->") on focus
      view.focus();

      // Second frame: clean up any browser-injected artifacts, then enable onChange
      requestAnimationFrame(() => {
        if (isDestroyingRef.current) return;

        // Reset document if browser injected content during focus.
        //
        // ‼️ §312 되돌릴 곳은 마운트 때의 스냅샷이 아니라 **지금의 버퍼**다. 소스 모드로
        // 들어간 직후 태스크 쓰기가 버퍼를 고치면 아래 동기화 effect가 그것을 뷰에 넣는데,
        // 여기서 옛 스냅샷으로 되돌리면 그 쓰기를 두 프레임 만에 지운다.
        const expected = readAuthoritative();
        const currentContent = view.state.doc.toString();
        if (currentContent !== expected) {
          view.dispatch({
            annotations: EXTERNAL_SYNC_ANNOTATIONS,
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: expected,
            },
            selection: EditorSelection.cursor(
              Math.min(cursorPos, expected.length),
            ),
          });
        }

        initialized = true;

        // Scroll cursor into view
        if (cursorPos > 0) {
          view.dispatch({
            effects: EditorView.scrollIntoView(cursorPos, { y: "center" }),
          });
        }
      });
    });

    return () => {
      isDestroyingRef.current = true;
      vimController.dispose();
      unsubscribeVim();
      view.destroy();
      viewRef.current = null;
    };
    // Only create once. 바깥에서 온 내용 변경은 아래 동기화 effect가 처리한다 —
    // `content`를 이 deps에 넣으면 타이핑 한 글자마다 view.destroy()가 돌아
    // 실행 취소 스택·커서·스크롤이 전부 날아가고, 두 단계 init이 문서를 되돌린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * §312 버퍼가 **밑에서** 바뀌면 마운트된 뷰에 밀어 넣는다.
   *
   * 뷰를 다시 만들지 않는다는 것이 요점이다 — 최소 구간 교체 트랜잭션 하나라서
   * 실행 취소 스택이 그대로 남고, 캐럿은 CM이 change로 옮겨 주며, 스크롤을 요청하지
   * 않으므로 화면도 움직이지 않는다.
   *
   * 관문은 두 겹이다. `content`는 언제 다시 볼지를 정하는 트리거일 뿐이고, 실제로
   * 비교하는 값은 effect 시점에 접근자로 다시 읽은 텍스트다. 그 값이 뷰의 doc과 같으면
   * (= 이 변경을 만든 게 뷰 자신이면) 아무 일도 하지 않는다.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = readAuthoritative();
    const change = textReplaceRange(view.state.doc.toString(), next);
    if (!change) return;
    view.dispatch({ annotations: EXTERNAL_SYNC_ANNOTATIONS, changes: change });
    // deps는 `content` 하나다. `readAuthoritative`는 ref만 닫고 있어 렌더마다 새로
    // 만들어도 결과가 같고, deps에 넣으면 렌더마다 effect가 돌면서 큰 문서의
    // doc.toString()을 반복한다.
  }, [content]);

  return (
    <div
      className="source-code-editor"
      ref={containerRef}
      style={{ height: "100%", overflow: "auto" }}
    />
  );
}
