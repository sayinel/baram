// §28 Wikilink NodeView — renders [[target]] as styled inline link
// §87 Cross-vault link rendering with vault color badge
import { useCallback, useMemo } from "react";

import type { WikilinkOptions } from "./wikilink";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

import { useContextStore } from "../../stores/context/context";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { isDateString } from "../../utils/journal/journal";
import {
  capNoteTitle,
  isZettelId,
} from "../../utils/zettelkasten/parse-note-title";

export function WikilinkView({ node, selected, extension }: NodeViewProps) {
  const { target, display, heading, vaultAlias } = node.attrs as {
    display: null | string;
    heading: null | string;
    target: string;
    vaultAlias: null | string;
  };

  // §95 Zettelkasten: bare [[id]] links show the live note title from the
  // zettel index — GATED so display text, headings, vault aliases, and date
  // links keep their existing rendering untouched.
  const zettelTitle = useZettelIndexStore((s) =>
    !display && !heading && !vaultAlias && isZettelId(target)
      ? s.byId[target]?.title
      : undefined,
  );

  // Display text priority: index title (zettel id only) > display > heading > target
  // §87 Cross-vault: include alias:: prefix in display text
  //
  // §99 인덱스 제목만 캡을 받는다. fleeting 노트의 제목은 사용자가 정한 이름이
  // 아니라 캡처 본문 첫 줄이라 문단 길이일 수 있고, `.wikilink`에는 CSS 절단이
  // 없어(max-width를 주려면 display:inline-block이 필요한데 그러면 **모든**
  // 위키링크의 줄바꿈이 바뀐다) 그대로 두면 점선 밑줄 달린 문단이 된다.
  // `display`/`heading`/`target` 경로는 사용자가 적은 것이라 손대지 않는다.
  const cappedZettelTitle =
    zettelTitle === undefined ? undefined : capNoteTitle(zettelTitle);
  const baseText =
    cappedZettelTitle ??
    (display || (heading ? `${target} > ${heading}` : target));
  const text = vaultAlias ? `${vaultAlias}::${baseText}` : baseText;

  const isDate = isDateString(target);

  // §87 Cross-vault: resolve vault context for color badge and dangling state
  const vaultInfo = useMemo(() => {
    if (!vaultAlias) return null;
    const contexts = useContextStore.getState().contexts;
    const aliasLower = vaultAlias.toLowerCase();
    const ctx = contexts.find((c) => c.alias?.toLowerCase() === aliasLower);
    return {
      color: ctx?.color ?? null,
      open: !!ctx,
    };
  }, [vaultAlias]);

  // §28 Cmd+Click navigates to target document
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // §56 Date wikilinks navigate on single click
      if (isDate || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const onNavigate = (extension.options as WikilinkOptions).onNavigate;
        onNavigate(target, heading, vaultAlias);
      }
    },
    [extension, target, heading, vaultAlias, isDate],
  );

  const isDangling = vaultAlias != null && vaultInfo != null && !vaultInfo.open;

  return (
    <NodeViewWrapper
      as="span"
      className={`wikilink ${selected ? "wikilink-selected" : ""} ${isDate ? "wikilink-date" : ""} ${isDangling ? "wikilink--dangling" : ""}`}
      data-target={target}
      onClick={handleClick}
      // §99 캡이 실제로 잘랐을 때만 전문을 툴팁으로 남긴다 — 자르지 않았다면
      // 툴팁이 화면의 글자를 그대로 반복할 뿐이다.
      title={
        cappedZettelTitle !== zettelTitle && zettelTitle !== undefined
          ? zettelTitle
          : undefined
      }
    >
      {vaultAlias && vaultInfo && (
        <span
          className={`wikilink-vault-badge ${isDangling ? "wikilink-vault-badge--dangling" : ""}`}
          style={
            vaultInfo.color ? { backgroundColor: vaultInfo.color } : undefined
          }
          title={
            vaultInfo.open
              ? `${vaultAlias} vault`
              : `'${vaultAlias}' vault is not open`
          }
        />
      )}
      {isDate && <span className="wikilink-date-icon">📅</span>}
      {text}
    </NodeViewWrapper>
  );
}
