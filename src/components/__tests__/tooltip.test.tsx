// The hover label's timing is the whole feature. The native `title` attribute already put the
// right words on screen — it put them there about a second late, which on an icon-only rail is
// the same as not having them. So these tests pin WHEN the label appears, not that it exists.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tooltip } from "../Tooltip";

/**
 * The warm window lives in module scope, so one test's dismissal would otherwise leave the next
 * test warm and make its "waits for the delay" assertion vacuous. Jumping the clock past the
 * window is enough — and it does it without adding a test-only reset export to the component.
 */
function goCold() {
  vi.setSystemTime(Date.now() + 60_000);
}

function renderBar() {
  return render(
    <>
      <Tooltip label="Files">
        <button type="button">files</button>
      </Tooltip>
      <Tooltip label="Search">
        <button type="button">search</button>
      </Tooltip>
    </>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  goCold();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("show delay", () => {
  it("stays hidden while the pointer has not rested long enough", () => {
    renderBar();
    fireEvent.pointerOver(screen.getByText("files"));

    act(() => void vi.advanceTimersByTime(140));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("appears once the pointer has rested", () => {
    renderBar();
    fireEvent.pointerOver(screen.getByText("files"));

    act(() => void vi.advanceTimersByTime(150));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Files");
  });

  it("never appears when the pointer leaves before the delay elapses", () => {
    renderBar();
    const files = screen.getByText("files");
    fireEvent.pointerOver(files);

    act(() => void vi.advanceTimersByTime(100));
    fireEvent.pointerOut(files);
    act(() => void vi.advanceTimersByTime(1000));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("the warm window", () => {
  it("opens the next label with no delay at all", () => {
    // Moving along a rail of icons should read as one continuous label that re-titles itself,
    // the way it does in the editors this bar is modelled on. Re-paying the delay per icon is
    // what makes a bar of icons feel unresponsive even when each individual delay is short.
    renderBar();
    const files = screen.getByText("files");
    fireEvent.pointerOver(files);
    act(() => void vi.advanceTimersByTime(150));
    fireEvent.pointerOut(files);

    fireEvent.pointerOver(screen.getByText("search"));

    // No timer advance between the hover and the assertion.
    expect(screen.getByRole("tooltip")).toHaveTextContent("Search");
  });

  it("has cooled off by the time the pointer comes back much later", () => {
    renderBar();
    const files = screen.getByText("files");
    fireEvent.pointerOver(files);
    act(() => void vi.advanceTimersByTime(150));
    fireEvent.pointerOut(files);

    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.pointerOver(screen.getByText("search"));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("dismissal", () => {
  it("hides when the pointer leaves", () => {
    renderBar();
    const files = screen.getByText("files");
    fireEvent.pointerOver(files);
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.pointerOut(files);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on press, and the focus the press hands over does not bring it back", () => {
    // A press on an activity bar icon opens a panel. A label left hanging over that panel — or
    // one re-summoned by the focus the click itself delivers — is worse than no label.
    renderBar();
    const files = screen.getByText("files");
    fireEvent.pointerOver(files);
    act(() => void vi.advanceTimersByTime(150));

    fireEvent.pointerDown(files);
    fireEvent.focus(files);
    act(() => void vi.advanceTimersByTime(1000));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on Escape while it is showing", () => {
    // WCAG 1.4.13: content that appears on hover must be dismissible without moving the pointer.
    renderBar();
    fireEvent.pointerOver(screen.getByText("files"));
    act(() => void vi.advanceTimersByTime(150));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("keyboard reach", () => {
  it("shows the label for a trigger reached by Tab", () => {
    renderBar();

    fireEvent.focus(screen.getByText("files"));
    act(() => void vi.advanceTimersByTime(150));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Files");
  });

  it("hides again on blur", () => {
    renderBar();
    const files = screen.getByText("files");
    fireEvent.focus(files);
    act(() => void vi.advanceTimersByTime(150));

    fireEvent.blur(files);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("the trigger it wraps", () => {
  it("keeps the child's own handlers and names it for assistive tech", () => {
    // cloneElement overwrites props it sets. An icon-only button carries an onClick and nothing
    // else today, so a tooltip that quietly ate one would look like it worked.
    const onClick = vi.fn();
    const onPointerEnter = vi.fn();
    render(
      <Tooltip label="Files">
        <button onClick={onClick} onPointerEnter={onPointerEnter} type="button">
          files
        </button>
      </Tooltip>,
    );

    const files = screen.getByText("files");
    fireEvent.pointerOver(files);
    fireEvent.click(files);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
    expect(files).toHaveAccessibleName("Files");
  });
});

describe("a trigger with nothing to say", () => {
  it("shows no pill at all for an empty label", () => {
    // Callers pass a value that is only sometimes there — a settings field holding a path that
    // has not been chosen yet. Without the bypass this renders a small empty rectangle after
    // the delay, which reads as a rendering glitch rather than as "nothing is set".
    render(
      <Tooltip label="">
        <button type="button">browse</button>
      </Tooltip>,
    );

    fireEvent.pointerOver(screen.getByText("browse"));
    act(() => void vi.advanceTimersByTime(1000));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("leaves the trigger's own accessible name alone", () => {
    render(
      <Tooltip label="">
        <button aria-label="Browse for a folder" type="button">
          browse
        </button>
      </Tooltip>,
    );

    expect(screen.getByText("browse")).toHaveAccessibleName(
      "Browse for a folder",
    );
  });
});
