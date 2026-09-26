// §356 갤러리 카드 — 두 열 격자의 세로 카드: 위 미리보기, 아래 정보 칸(이름 · 출처 배지 ·
// 모드 · 설치 테마의 작성자 · 버전 · 설명).
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../ipc/plugin-invoke", () => ({
  pluginFetchRegistry: vi.fn(() => Promise.resolve({ plugins: [] })),
}));

import type { InstalledTheme } from "../../../../themes/theme-install";

import { useSettingsStore } from "../../../../stores/settings/store";
import { DEFAULT_DARK_PALETTE } from "../../../../types/generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "../../../../types/generated/palette-light";
import { ThemeGallery } from "../theme-gallery";

/** jsdom 이 인라인 색을 직렬화하는 모양으로 — hex 를 그대로 비교하면 형식 차이로 틀린다. */
function cssColor(value: string): string {
  const probe = document.createElement("div");
  probe.style.backgroundColor = value;
  return probe.style.backgroundColor;
}

function gallery() {
  return <ThemeGallery onBrowseThemes={() => {}} onCustomize={() => {}} />;
}

function pairedInstalled(): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.2.0",
    id: "dusk",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/u/.baram/themes/dusk",
    manifest: {
      author: "Rin",
      description: "A calm pair for long reading.",
      engines: { baram: ">=0.7.0" },
      id: "dusk",
      license: "MIT",
      modes: {
        dark: { tokens: "dark/tokens.json" },
        light: { tokens: "light/tokens.json" },
      },
      name: "Dusk",
      version: "1.2.0",
    },
    modes: {
      dark: { colors: DEFAULT_DARK_PALETTE, css: false },
      light: { colors: DEFAULT_LIGHT_PALETTE, css: false },
    },
  };
}

function paneBackground(card: HTMLElement, mode: "dark" | "light"): string {
  const pane = card.querySelector<HTMLElement>(`[data-mode="${mode}"]`);
  if (pane === null) throw new Error(`no ${mode} pane`);
  const editor = pane.querySelector<HTMLElement>(".theme-preview-editor");
  if (editor === null) throw new Error("no editor");
  return editor.style.backgroundColor;
}

beforeEach(() => {
  useSettingsStore.setState({
    activeThemeId: "system",
    customThemes: [],
    installedThemes: {},
  });
});

describe("시스템 카드", () => {
  // 무엇이 이것을 실패시키는가: 하드코딩한 색(`#ffffff` · `#1a1a2e`)으로 돌아가면 — 그 값은
  // 기본 다크 팔레트의 편집기 배경과 다르다. 시스템 테마는 cascade 의 기본값을 입으므로 그
  // 기본값의 출처인 생성 팔레트로 그려야 입었을 때와 같다.
  it("기본 라이트 · 다크 팔레트로 두 칸을 그린다", () => {
    render(gallery());
    const card = screen.getByRole("button", { name: /System \(Auto\)|시스템/ });
    expect(paneBackground(card, "light")).toBe(
      cssColor(DEFAULT_LIGHT_PALETTE["--color-editor-bg"]),
    );
    expect(paneBackground(card, "dark")).toBe(
      cssColor(DEFAULT_DARK_PALETTE["--color-editor-bg"]),
    );
  });
});

describe("설치 테마 카드", () => {
  beforeEach(() => {
    useSettingsStore.setState({ installedThemes: { dusk: pairedInstalled() } });
  });

  it("짝 테마는 라이트 · 다크 두 칸을 그리고 모드를 적는다", () => {
    render(gallery());
    const card = screen.getByRole("button", { name: "Dusk" });
    expect(card.querySelectorAll("[data-mode]")).toHaveLength(2);
    expect(within(card).getByText(/Light · Dark|라이트 · 다크/)).toBeTruthy();
  });

  it("작성자 · 버전과 설명을 보인다", () => {
    render(gallery());
    const card = screen.getByRole("button", { name: "Dusk" });
    expect(within(card).getByText(/Rin · v1\.2\.0/)).toBeTruthy();
    expect(
      within(card).getByText("A calm pair for long reading."),
    ).toBeTruthy();
  });

  // 카드 버튼의 이름은 테마 이름이다 — 모드 · 작성자 · 설명까지 이름에 섞이면 보조기기가
  // 카드마다 긴 문장을 읽고, 이름으로 카드를 찾던 쪽이 전부 어긋난다. 그 글은 설명으로 간다.
  it("버튼 이름은 테마 이름이고, 작성자 · 설명은 버튼의 설명이다", () => {
    render(gallery());
    const card = screen.getByRole("button", { name: "Dusk" });
    expect(card).toHaveAccessibleDescription(/Rin · v1\.2\.0/);
    expect(card).toHaveAccessibleDescription(/A calm pair for long reading\./);
  });
});

describe("내장 테마 카드", () => {
  it("모드를 적고, 작성자 줄은 없다", () => {
    render(gallery());
    const card = screen.getByRole("button", { name: "Nord" });
    expect(within(card).getByText(/^(Dark|다크)$/)).toBeTruthy();
    expect(card.querySelector(".theme-card-author")).toBeNull();
  });

  it("커스텀 배지는 버튼 이름에 남는다 — 눈으로 커스텀을 알아보던 표식", () => {
    useSettingsStore.setState({
      customThemes: [
        {
          id: "mine",
          modes: { light: { colors: DEFAULT_LIGHT_PALETTE } },
          name: "Mine",
          source: "custom",
        },
      ],
    });
    render(gallery());
    expect(
      screen.getByRole("button", { name: /^Mine (Custom|커스텀)$/ }),
    ).toBeTruthy();
  });
});

describe("CSS 만 싣는 테마", () => {
  it("미리보기는 없고 모드는 적는다", () => {
    useSettingsStore.setState({
      customThemes: [
        {
          id: "bare",
          modes: { dark: { css: ".x{}" } },
          name: "Bare",
          source: "custom",
        },
      ],
    });
    render(gallery());
    const card = screen.getByRole("button", { name: /^Bare/ });
    expect(card.querySelector(".theme-preview")).toBeNull();
    expect(within(card).getByText(/^(Dark|다크)$/)).toBeTruthy();
  });
});
