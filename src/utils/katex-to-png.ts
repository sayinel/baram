// §5.3 KaTeX to PNG — copy math as image to clipboard

export async function copyMathToPNG(
  formula: string,
  displayMode: boolean,
): Promise<void> {
  const katex = (await import("katex")).default;
  // Render KaTeX to HTML string
  const html = katex.renderToString(formula, {
    throwOnError: false,
    displayMode,
  });

  // Create offscreen container
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-9999px;top:-9999px;padding:16px;background:white;";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    // Get rendered dimensions
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.ceil(rect.width * dpr);
    const height = Math.ceil(rect.height * dpr);

    // Serialize container to SVG foreignObject
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="transform:scale(${dpr});transform-origin:0 0;padding:16px;background:white;">
            <link rel="stylesheet" href="${getCSSUrl()}" />
            ${html}
          </div>
        </foreignObject>
      </svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    // Render SVG to canvas
    const img = new Image();
    img.width = width;
    img.height = height;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob(async (pngBlob) => {
          if (!pngBlob) {
            reject(new Error("Could not create PNG blob"));
            return;
          }
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": pngBlob }),
            ]);
            resolve();
          } catch (err) {
            reject(err);
          }
        }, "image/png");
      };
      img.onerror = () => reject(new Error("SVG rendering failed"));
      img.src = url;
    });

    URL.revokeObjectURL(url);
  } finally {
    document.body.removeChild(container);
  }
}

function getCSSUrl(): string {
  // Find KaTeX CSS link in the document
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (const link of links) {
    const href = (link as HTMLLinkElement).href;
    if (href.includes("katex")) return href;
  }
  return "";
}
