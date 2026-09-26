// §4.2 — icons.css 의 mask 이미지는 lucide 아이콘의 경로를 손으로 옮긴 것이다. 옮긴 원본
// (lucide-react 가 렌더하는 svg)과 모양을 비교한다 — 경로를 고치거나 lucide 를 올려 경로가
// 달라지면 red 다. 그리고 스타일시트가 쓰는 `var(--icon-*)` 가 전부 정의돼 있는지 본다:
// 정의 없는 변수를 가리키는 `mask` 는 계산값 시점에 무효가 되어 배경색만 칠한다(사각형).
import type { LucideIcon } from "lucide-react";

import { render } from "@testing-library/react";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

const MASKS: [string, LucideIcon][] = [
  ["--icon-chevron-left", ChevronLeft],
  ["--icon-chevron-right", ChevronRight],
  ["--icon-ellipsis", Ellipsis],
];

/** svg 루트에서 모양을 정하는 속성. 색(`stroke`)·크기·클래스는 mask 와 컴포넌트가 다르다. */
const ROOT_ATTRS = [
  "fill",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-width",
  "viewBox",
];

function iconDeclarations(): { prop: string; value: string }[] {
  const root = cssRules().find(
    (r) => r.file.endsWith("/styles/icons.css") && r.selector === ":root",
  );
  return cssDeclarations(root?.body ?? "");
}

function maskSvg(prop: string): Element | null {
  const value = iconDeclarations().find((d) => d.prop === prop)?.value ?? "";
  const encoded = /^url\("data:image\/svg\+xml,(.*)"\)$/u.exec(value)?.[1];
  if (encoded === undefined) return null;
  return new DOMParser().parseFromString(
    decodeURIComponent(encoded),
    "image/svg+xml",
  ).documentElement;
}

function shape(svg: Element): string[] {
  const own = ROOT_ATTRS.map((name) => `${name}=${svg.getAttribute(name)}`);
  const children = [...svg.children].map(
    (child) =>
      `${child.tagName} ${[...child.attributes]
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join(" ")}`,
  );
  return [...own, ...children];
}

describe("mask icons (icons.css)", () => {
  it.each(MASKS)("%s draws the lucide icon it is named after", (prop, Icon) => {
    const mask = maskSvg(prop);
    expect(mask, `${prop} is not a data: svg url`).not.toBeNull();
    const { container } = render(<Icon />);
    const lucide = container.querySelector("svg");
    expect(lucide).not.toBeNull();
    // 비-공허성: 도형이 하나 이상이어야 비교가 모양을 본다.
    expect(mask?.children.length).toBeGreaterThan(0);
    expect(shape(mask!)).toEqual(shape(lucide!));
  });

  it("defines every mask icon a stylesheet uses", () => {
    const defined = new Set(iconDeclarations().map((d) => d.prop));
    const used = new Set(
      cssRules().flatMap((r) =>
        [...r.body.matchAll(/var\((--icon-[a-z-]+)\)/gu)].map((m) => m[1]),
      ),
    );
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
