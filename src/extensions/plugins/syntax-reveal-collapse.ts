// §5.1 + §3.3 Syntax Reveal — collapse logic (expanded range → marks/nodes)

import type { ExpandedRange } from "./syntax-reveal-state";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { classifyMediaSrc } from "../../utils/media-src";
import {
  INACTIVE,
  syntaxRevealKey,
  WIKILINK_REGEX,
} from "./syntax-reveal-state";

// ── Collapse expanded range ───────────────────────────────────────────

/**
 * Collapse expanded delimiters back to marks/nodes.
 * @param cursorTarget — if provided, place cursor here in the collapsed doc.
 *   Otherwise ProseMirror's default position mapping through the replace steps
 *   determines the final cursor position.
 */
export function collapseExpanded(
  view: EditorView,
  expanded: ExpandedRange,
  cursorTarget?: number,
): void {
  const { state } = view;
  const { tr } = state;
  const { from, to, kind, openCheck, closeCheck, markName } = expanded;

  // Validate open delimiter still exists
  try {
    const openText = state.doc.textBetween(from, from + openCheck.length);
    if (openText !== openCheck) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }
  } catch {
    tr.setMeta(syntaxRevealKey, INACTIVE);
    view.dispatch(tr);
    return;
  }

  if (kind === "mark" && markName) {
    const markType = state.schema.marks[markName];
    if (!markType || !closeCheck) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    try {
      const closeText = state.doc.textBetween(to - closeCheck.length, to);
      if (closeText !== closeCheck) {
        tr.setMeta(syntaxRevealKey, INACTIVE);
        view.dispatch(tr);
        return;
      }
    } catch {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const contentFrom = from + openCheck.length;
    const contentTo = to - closeCheck.length;
    const contentLen = contentTo - contentFrom;

    if (contentLen <= 0) {
      tr.delete(from, to);
    } else {
      const content = state.doc.slice(contentFrom, contentTo).content;
      tr.replaceWith(from, to, content);
      tr.addMark(from, from + contentLen, markType.create());
    }
  } else if (kind === "link") {
    const fullText = state.doc.textBetween(from, to);
    const linkMatch = fullText.match(
      /^\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
    );
    if (!linkMatch) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const [, , href, title] = linkMatch;
    const bracketIdx = fullText.indexOf("](");
    if (bracketIdx < 0) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const contentFrom = from + 1;
    const contentTo = from + bracketIdx;
    const contentLen = bracketIdx - 1;

    const linkMark = state.schema.marks.link.create({
      href,
      title: title || null,
    });

    if (contentLen <= 0) {
      tr.delete(from, to);
    } else {
      const content = state.doc.slice(contentFrom, contentTo).content;
      tr.replaceWith(from, to, content);
      tr.addMark(from, from + contentLen, linkMark);
    }
  } else if (kind === "image") {
    const fullText = state.doc.textBetween(from, to);
    const imgMatch = fullText.match(
      /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
    );
    if (!imgMatch) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const [, alt, src, title] = imgMatch;
    // §295 src가 노드 타입을 정한다 — syntax-reveal.ts의 appendTransaction
    // collapse 분기와 같은 결정. 이 함수(collapseExpanded)는 그와 별개의
    // 두 번째 collapse 구현이라 결정을 여기도 복제해야 한다.
    const attrs = { src, alt: alt || null, title: title || null };
    const useVideo =
      classifyMediaSrc(src) !== "image" && !!state.schema.nodes.video;
    const mediaNode = useVideo
      ? state.schema.nodes.video.create(attrs)
      : state.schema.nodes.image.create(attrs);
    const imgFrom = from - 1;
    const imgTo = to + 1;
    tr.replaceWith(imgFrom, imgTo, mediaNode);
  } else if (kind === "wikilink") {
    const fullText = state.doc.textBetween(from, to);
    const wlMatch = fullText.match(WIKILINK_REGEX);
    if (!wlMatch) {
      // Invalid syntax — just deactivate, keep as text (lenient)
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const [, wlAlias, wlTarget, wlHeading, wlBlockId, wlDisplay] = wlMatch;
    const wikilinkNode = state.schema.nodes.wikilink.create({
      vaultAlias: wlAlias || null,
      target: wlTarget,
      heading: wlHeading || null,
      blockId: wlBlockId || null,
      display: wlDisplay || null,
    });
    tr.replaceWith(from, to, wikilinkNode);
  }

  // Set explicit cursor position if requested
  if (cursorTarget !== undefined) {
    try {
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          Math.max(0, Math.min(cursorTarget, tr.doc.content.size)),
        ),
      );
    } catch {
      // fallback: let ProseMirror's default mapping handle it
    }
  }

  tr.setMeta(syntaxRevealKey, INACTIVE);
  view.dispatch(tr);
}
