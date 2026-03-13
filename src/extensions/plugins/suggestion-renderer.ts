import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";

import { ReactRenderer } from "@tiptap/react";

/** Shared ref interface that all suggestion menu components must implement */
export interface SuggestionMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** Options for creating a suggestion renderer */
export interface SuggestionRendererOptions<TItem> {
  /** React component to render inside the popup */
  component: React.ComponentType<{
    command: SuggestionProps["command"];
    items: TItem[];
  }>;
  /** Maximum height of the menu, used for above/below positioning */
  menuHeight: number;
  /**
   * Optional callback fired on every onStart/onUpdate with the latest items and range.
   * Useful for external state tracking (e.g. wikilink Tab completion).
   */
  onItemsUpdate?: (items: TItem[], range: { from: number; to: number }) => void;
  /**
   * Optional extra onKeyDown handler called before the default Escape/ref delegation.
   * Return `true` to indicate the key was handled (stop propagation).
   * Return `false` to fall through to default handling.
   */
  onKeyDown?: (
    props: SuggestionKeyDownProps,
    state: SuggestionRendererState<TItem>,
  ) => boolean | undefined;
  /** CSS class applied to the popup container div */
  popupClass: string;
}

/** Mutable state exposed to custom onKeyDown handlers */
export interface SuggestionRendererState<TItem> {
  component: null | ReactRenderer<SuggestionMenuRef>;
  items: TItem[];
  popup: HTMLDivElement | null;
  range: null | { from: number; to: number };
}

/** The object returned by the render() factory — matches Tiptap's Suggestion render API */
export interface SuggestionRenderReturn {
  onExit: () => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onStart: (props: SuggestionProps) => void;
  onUpdate: (props: SuggestionProps) => void;
}

/**
 * Factory that creates a Tiptap Suggestion `render()` return value.
 *
 * Encapsulates the shared lifecycle: popup creation, positioning,
 * Escape key handling, and cleanup. Per-plugin differences are
 * injected via `SuggestionRendererOptions`.
 */
export function createSuggestionRenderer<TItem>(
  options: SuggestionRendererOptions<TItem>,
): () => SuggestionRenderReturn {
  const {
    popupClass,
    menuHeight,
    component: MenuComponent,
    onKeyDown: customOnKeyDown,
    onItemsUpdate,
  } = options;

  return () => {
    const state: SuggestionRendererState<TItem> = {
      component: null,
      popup: null,
      items: [],
      range: null,
    };

    return {
      onStart: (props: SuggestionProps) => {
        state.items = props.items as TItem[];
        state.range = { from: props.range.from, to: props.range.to };
        onItemsUpdate?.(state.items, state.range);

        state.component = new ReactRenderer(MenuComponent, {
          props: {
            items: state.items,
            command: props.command,
          },
          editor: props.editor,
        }) as ReactRenderer<SuggestionMenuRef>;

        state.popup = document.createElement("div");
        state.popup.className = popupClass;
        document.body.appendChild(state.popup);
        state.popup.appendChild(state.component.element);

        const coords = props.clientRect?.();
        if (coords && state.popup) {
          positionPopup(state.popup, coords, menuHeight);
        }
      },
      onUpdate: (props: SuggestionProps) => {
        state.items = props.items as TItem[];
        state.range = { from: props.range.from, to: props.range.to };
        onItemsUpdate?.(state.items, state.range);

        state.component?.updateProps({
          items: state.items,
          command: props.command,
        });

        const coords = props.clientRect?.();
        if (coords && state.popup) {
          positionPopup(state.popup, coords, menuHeight);
        }
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === "Escape") {
          state.popup?.remove();
          state.component?.destroy();
          state.popup = null;
          state.component = null;
          return true;
        }

        // Delegate to custom handler if provided
        if (customOnKeyDown) {
          const handled = customOnKeyDown(props, state);
          if (handled === true) return true;
        }

        return state.component?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: () => {
        state.popup?.remove();
        state.component?.destroy();
        state.popup = null;
        state.component = null;
        state.items = [];
        state.range = null;
      },
    };
  };
}

/**
 * Position a popup element relative to cursor coordinates.
 * Places below if space permits, otherwise above.
 */
export function positionPopup(
  popup: HTMLDivElement,
  coords: DOMRect,
  menuHeight: number,
): void {
  const spaceBelow = window.innerHeight - coords.bottom - 4;
  popup.style.left = `${coords.left}px`;
  if (spaceBelow < menuHeight) {
    popup.style.top = `${coords.top - menuHeight - 4}px`;
  } else {
    popup.style.top = `${coords.bottom + 4}px`;
  }
}
