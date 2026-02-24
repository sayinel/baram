// §5.5 Table Grid Picker — 10×10 hover grid for selecting table dimensions
// DOM-based popup following the field-dialog.ts pattern

const GRID_SIZE = 10;

/**
 * Show a 10×10 grid picker popup for selecting table dimensions.
 * Returns { rows, cols } on selection, or null on cancel (Escape / click outside).
 */
export function showTableGridPicker(
  x: number,
  y: number,
): Promise<{ rows: number; cols: number } | null> {
  return new Promise((resolve) => {
    let hoverRows = 0;
    let hoverCols = 0;

    // Overlay to capture clicks outside
    const overlay = document.createElement("div");
    overlay.className = "table-grid-overlay";

    // Picker container
    const picker = document.createElement("div");
    picker.className = "table-grid-picker";

    // Clamp position to viewport
    const pickerWidth = GRID_SIZE * 24 + 16;
    const pickerHeight = GRID_SIZE * 24 + 40;
    let posX = x;
    let posY = y;
    if (posX + pickerWidth > window.innerWidth) {
      posX = window.innerWidth - pickerWidth - 8;
    }
    if (posY + pickerHeight > window.innerHeight) {
      posY = window.innerHeight - pickerHeight - 8;
    }
    picker.style.left = `${posX}px`;
    picker.style.top = `${posY}px`;

    // Label
    const label = document.createElement("div");
    label.className = "table-grid-label";
    label.textContent = "Select table size";
    picker.appendChild(label);

    // Grid container
    const gridContainer = document.createElement("div");
    gridContainer.className = "table-grid-container";

    const cells: HTMLDivElement[] = [];

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "table-grid-cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        gridContainer.appendChild(cell);
        cells.push(cell);
      }
    }

    picker.appendChild(gridContainer);
    overlay.appendChild(picker);
    document.body.appendChild(overlay);

    const updateHighlight = (row: number, col: number) => {
      hoverRows = row + 1;
      hoverCols = col + 1;
      label.textContent = `${hoverRows} × ${hoverCols} table`;
      for (const cell of cells) {
        const cr = Number(cell.dataset.row);
        const cc = Number(cell.dataset.col);
        if (cr <= row && cc <= col) {
          cell.classList.add("table-grid-cell-active");
        } else {
          cell.classList.remove("table-grid-cell-active");
        }
      }
    };

    const cleanup = (result: { rows: number; cols: number } | null) => {
      overlay.remove();
      resolve(result);
    };

    gridContainer.addEventListener("mouseover", (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.row !== undefined && target.dataset.col !== undefined) {
        updateHighlight(Number(target.dataset.row), Number(target.dataset.col));
      }
    });

    gridContainer.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.row !== undefined && target.dataset.col !== undefined) {
        cleanup({ rows: hoverRows, cols: hoverCols });
      }
    });

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        cleanup(null);
      }
    });

    document.addEventListener(
      "keydown",
      function onKey(e: KeyboardEvent) {
        if (e.key === "Escape") {
          e.preventDefault();
          document.removeEventListener("keydown", onKey, true);
          cleanup(null);
        }
      },
      true,
    );
  });
}
