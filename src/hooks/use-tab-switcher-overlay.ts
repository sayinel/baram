// §39 Tab switcher overlay state — open/index/MRU ref, and the Ctrl-keyup
// handler that commits the highlighted selection when the modifier is
// released.
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { EditorTab } from "../stores/editor/editor";

import { useEditorStore } from "../stores/editor/editor";

interface UseTabSwitcherOverlayReturn {
  setTabSwitcherIndex: Dispatch<SetStateAction<number>>;
  setTabSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  tabSwitcherIndex: number;
  tabSwitcherMruRef: React.MutableRefObject<EditorTab[]>;
  tabSwitcherOpen: boolean;
}

export function useTabSwitcherOverlay(): UseTabSwitcherOverlayReturn {
  // §39 Tab switcher state
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [tabSwitcherIndex, setTabSwitcherIndex] = useState(0);
  const tabSwitcherMruRef = useRef<EditorTab[]>([]);

  // §39 Ctrl keyup — commit tab switcher selection
  useEffect(() => {
    if (!tabSwitcherOpen) return;

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        const selectedTab = tabSwitcherMruRef.current[tabSwitcherIndex];
        if (selectedTab) {
          useEditorStore.getState().setActiveTab(selectedTab.id);
        }
        setTabSwitcherOpen(false);
      }
    };

    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  }, [tabSwitcherOpen, tabSwitcherIndex]);

  return {
    setTabSwitcherIndex,
    setTabSwitcherOpen,
    tabSwitcherIndex,
    tabSwitcherMruRef,
    tabSwitcherOpen,
  };
}
