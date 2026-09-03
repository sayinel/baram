// §99 A Quick Capture 태그 칸 — 인덱스 스캔 + `#` 자동완성.
//
// 다이얼로그에서 떼어낸 이유는 길이 하나뿐이다: 태그 상태 6개와 핸들러 3개가
// 다이얼로그의 절반을 차지해, 저장 분기를 읽으려면 그것들을 먼저 넘겨야 했다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getVaultTags } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { filterTags } from "../../utils/journal/journal-tags";
import { logger } from "../../utils/logger";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";

interface CaptureTags {
  activeIndex: number;
  index: Map<string, number>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** `#` 없는 태그 목록 — fleeting note의 프론트매터와 태스크 줄이 함께 쓴다. */
  list: string[];
  onBlur: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (tag: string) => void;
  query: string;
  value: string;
  visible: boolean;
}

export function useCaptureTags(open: boolean): CaptureTags {
  const [index, setIndex] = useState<Map<string, number>>(() => new Map());
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<null | string>(null);
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 다이얼로그가 열릴 때마다 칸을 비우고 Zettel 공간을 다시 훑는다 — 캡처가
  // 그곳에 쌓이므로 제안의 출처도 그곳이다.
  useEffect(() => {
    if (!open) return;

    setValue("");
    setVisible(false);
    setQuery(null);
    setActiveIndex(0);

    (async () => {
      try {
        const { rootPath } = useFileStore.getState();
        const { zettelkastenDirectory } = useSettingsStore.getState();
        const scanDir = resolveZettelDir(rootPath, zettelkastenDirectory);
        if (!scanDir) return;

        const entries = await getVaultTags(scanDir);
        setIndex(new Map(entries.map((e) => [e.tag, e.count])));
      } catch (err) {
        logger.error("[QuickCapture] Tag index build failed:", err);
      }
    })();
  }, [open]);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setValue(next);

      const cursor = e.target.selectionStart ?? next.length;
      const typed = currentTagQuery(next, cursor);
      if (typed !== null) {
        setQuery(typed);
        setVisible(filterTags(typed, index).length > 0);
        setActiveIndex(0);
      } else {
        setVisible(false);
        setQuery(null);
      }
    },
    [index],
  );

  // 고른 태그로 커서 위치의 부분 `#prefix`를 갈아끼운다.
  const onSelect = useCallback(
    (tag: string) => {
      const input = inputRef.current;
      if (!input) return;

      const cursor = input.selectionStart ?? value.length;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);

      // ‼️ 하이픈이 태그 이름의 일부다 — Rust `is_tag_char`가 그렇게 판정한다
      // (`src-tauri/src/md/mod.rs:25-27`). 여기서 빼면 §320의 `#Baram-Dev-Note` 별칭이
      // 자동완성으로 닿지 않고, `onSelect`가 접두를 절반만 갈아끼워
      // `#Baram-#baram-dev-note`를 만든다. 문자 클래스 **끝**의 `-`는 리터럴이다.
      const prefix = before.match(/#[\w가-힣-]*$/);
      const newBefore = prefix
        ? before.slice(0, before.length - prefix[0].length) + `#${tag}`
        : before + `#${tag}`;

      setValue(
        (newBefore + (after.startsWith(" ") ? after : " " + after)).trimEnd() +
          " ",
      );
      setVisible(false);
      setQuery(null);
      setActiveIndex(0);

      setTimeout(() => {
        const pos = newBefore.length + 1;
        inputRef.current?.setSelectionRange(pos, pos);
        inputRef.current?.focus();
      }, 0);
    },
    [value],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!visible) return;

      const suggestions = filterTags(query ?? "", index);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (suggestions[activeIndex]) {
          e.preventDefault();
          e.stopPropagation(); // 다이얼로그의 Enter 저장이 겹쳐 발화하지 않게
          onSelect(suggestions[activeIndex]);
        }
      } else if (e.key === "Escape") {
        e.stopPropagation(); // 다이얼로그가 닫히지 않게
        setVisible(false);
      }
    },
    [visible, query, index, activeIndex, onSelect],
  );

  const onBlur = useCallback(() => {
    // 제안의 onMouseDown이 먼저 발화하도록 숨김을 늦춘다.
    setTimeout(() => setVisible(false), 150);
  }, []);

  const list = useMemo(
    () =>
      value
        .split(/\s+/)
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean),
    [value],
  );

  return {
    activeIndex,
    index,
    inputRef,
    list,
    onBlur,
    onChange,
    onKeyDown,
    onSelect,
    query: query ?? "",
    value,
    visible,
  };
}

/** 커서 위치에서 입력 중인 `#tag` 접두를 뽑는다. */
function currentTagQuery(value: string, cursor: number): null | string {
  // ‼️ `-`가 없으면 `#Baram-`을 입력하는 중간에 쿼리가 끊겨 하이픈 뒤의 타이핑이
  // 자동완성 드롭다운에 반영되지 않는다 — `onSelect`의 같은 함정 참조.
  const match = value.slice(0, cursor).match(/#([\w가-힣-]*)$/);
  return match ? match[1] : null;
}
