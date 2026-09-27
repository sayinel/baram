// §385 jsdom lays nothing out, and `src/test-setup.ts` polyfills `elementFromPoint` to return
// null — so the occlusion check (spec 0061 D9) would refuse every prompt. This gives elements a
// box and makes the prompt input the topmost element, or `cover()`'s element instead.
import { vi } from "vitest";

export function stubPromptLayout(cover?: () => Element | null): () => void {
  // A plain object, not `DOMRect.fromRect`: which geometry classes jsdom ships is not ours to assume.
  const box = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      bottom: 40,
      height: 20,
      left: 10,
      right: 110,
      toJSON: () => ({}),
      top: 20,
      width: 100,
      x: 10,
      y: 20,
    } as DOMRect);
  const hit = vi
    .spyOn(document, "elementFromPoint")
    .mockImplementation(() =>
      cover ? cover() : document.querySelector(".plugin-prompt-input"),
    );
  return () => {
    box.mockRestore();
    hit.mockRestore();
  };
}
