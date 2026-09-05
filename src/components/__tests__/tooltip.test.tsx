// The hover label's timing is the whole feature. The native `title` attribute already put the
// right words on screen — it put them there about a second late, which on an icon-only rail is
// the same as not having them. So these tests pin WHEN the label appears, not that it exists.
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Tooltip } from "../Tooltip";

/**
 * The warm window lives in module scope, so one test's dismissal would otherwise leave the next
 * test warm and make its "waits for the delay" assertion vacuous. Jumping the clock past the
 * window is enough — and it does it without adding a test-only reset export to the component.
 *
 * ‼️ This only works because the fake clock is installed ONCE, below, rather than per test.
 * `vi.useFakeTimers()` resets the mocked now to the real system time, so calling it in
 * `beforeEach` sends the clock BACKWARDS past a stamp an earlier test left behind — and a
 * negative age reads as inside the window, which is warm. That silently turned a cold-path
 * assertion into a warm-path one.
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

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  goCold();
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

describe("only one pill at a time (§556 review M2)", () => {
  it("keeps the showing label up while the next one is still waiting out its delay", () => {
    // The eviction happens when the next pill APPEARS, not when its timer is armed. Evicting at
    // schedule time blanks the label the pointer is leaving 150ms before the next one arrives —
    // a flash of nothing on every cold move, which is what the warm window exists to remove.
    renderBar();
    fireEvent.focus(screen.getByText("files"));
    act(() => void vi.advanceTimersByTime(150));

    fireEvent.pointerOver(screen.getByText("search"));
    act(() => void vi.advanceTimersByTime(140));

    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Files");
  });

  it("evicts the previous one when the next appears, and keeps the RIGHT one", () => {
    // A keyboard-focused trigger receives neither blur nor pointerleave when the mouse goes
    // somewhere else, so nothing local to it can know it should stop. Asserting the count alone
    // would also pass a fix that hid the wrong pill.
    renderBar();
    fireEvent.focus(screen.getByText("files"));
    act(() => void vi.advanceTimersByTime(150));
    fireEvent.pointerOver(screen.getByText("search"));

    act(() => void vi.advanceTimersByTime(150));

    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Search");
  });

  it("hands the slot back when a trigger unmounts with its pill up", () => {
    // A trigger can vanish while showing — the settings modal closing, tasksEnabled switching
    // off. A dead entry left in the slot means the next show evicts nobody.
    const { rerender } = render(
      <>
        <Tooltip label="Files">
          <button type="button">files</button>
        </Tooltip>
        <Tooltip label="Search">
          <button type="button">search</button>
        </Tooltip>
      </>,
    );
    fireEvent.focus(screen.getByText("files"));
    act(() => void vi.advanceTimersByTime(150));

    rerender(
      <>
        <Tooltip label="Search">
          <button type="button">search</button>
        </Tooltip>
      </>,
    );
    goCold();
    fireEvent.pointerOver(screen.getByText("search"));
    act(() => void vi.advanceTimersByTime(150));

    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Search");
  });
});

describe("a label that goes empty (§556 review M1)", () => {
  function PathField({ value }: { value: string }) {
    return (
      <Tooltip label={value}>
        <input aria-label="Journal Directory" readOnly value={value} />
      </Tooltip>
    );
  }

  it("puts the pill away, and it does not come back when a value returns", () => {
    // The reported path: Tab into the field (pill shows), then click Clear with the MOUSE.
    // WKWebView does not focus a <button> on click, so the input keeps focus and the pointer
    // never entered it -- neither blur nor pointerleave fires. Suppressing the portal without
    // clearing `visible` left the next non-empty value painting a pill nobody hovered.
    const { rerender } = render(
      <PathField value="/Users/someone/Notes/journal" />,
    );
    fireEvent.focus(screen.getByLabelText("Journal Directory"));
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    rerender(<PathField value="" />);
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(<PathField value="/Users/someone/Notes/daily" />);
    act(() => void vi.advanceTimersByTime(1000));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("the press guard is one-shot (§556 review M3)", () => {
  it("lets a later focus open the label again", () => {
    // The guard exists for the focus a press delivers in that same task -- on an activity bar
    // icon, a label re-summoned that way would sit over the panel the press opened. Cleared only
    // by pointerleave, it outlived that purpose: on the read-only path field there is no panel,
    // and clicking the field to read a long path left no label even after tabbing away and back.
    renderBar();
    const files = screen.getByText("files");
    fireEvent.pointerDown(files);
    fireEvent.focus(files);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("tooltip")).toBeNull();

    goCold();
    fireEvent.blur(files);
    fireEvent.focus(files);
    act(() => void vi.advanceTimersByTime(150));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Files");
  });
});

describe("the shared slot survives a late hide from an evicted instance", () => {
  it("does not let it wipe the newer owner, which would put two pills back", () => {
    // A is focused with the keyboard, so it keeps DOM focus after the mouse moves to B and B
    // evicts it. A's blur therefore arrives LATE — after B owns the slot. Releasing
    // unconditionally there empties the slot, and the next show then evicts nobody.
    render(
      <>
        <Tooltip label="Files">
          <button type="button">files</button>
        </Tooltip>
        <Tooltip label="Search">
          <button type="button">search</button>
        </Tooltip>
        <Tooltip label="Graph View">
          <button type="button">graph</button>
        </Tooltip>
      </>,
    );

    fireEvent.focus(screen.getByText("files"));
    act(() => void vi.advanceTimersByTime(150));
    fireEvent.pointerOver(screen.getByText("search"));
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Search");

    // The late one, from the instance that was already evicted.
    fireEvent.blur(screen.getByText("files"));
    fireEvent.pointerOver(screen.getByText("graph"));
    act(() => void vi.advanceTimersByTime(150));

    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Graph View");
  });
});

describe("the warm window is stamped by a pill going away, not by any hide", () => {
  it("stays cold after a hover that left before the label ever appeared", () => {
    // `hide()` runs on plenty of paths where nothing was showing — a pointer that passes over an
    // icon and leaves inside the delay, an empty label on mount. Stamping the shared clock there
    // would hand the NEXT trigger the warm path, so a label the user never dismissed opens with
    // no delay at all.
    renderBar();
    const files = screen.getByText("files");
    fireEvent.pointerOver(files);
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.pointerOut(files);

    fireEvent.pointerOver(screen.getByText("search"));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
